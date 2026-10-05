import { useEffect, useRef, useCallback } from 'react';
import { message } from 'antd';
import { useExecutionStore } from '@/stores/executionStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useAuthStore } from '@/stores/authStore';
import { refreshCredits } from '@/utils/refreshCredits';
import { workflowApi } from '@/services/workflowApi';
import { reconcileNodesOnTerminal, pendingNodeIdsOf } from '@/utils/executionTerminal';
import { canvasApi } from '@/services/canvasApi';
import { createNode } from '@/utils/nodeFactory';
import { mediaFieldsFor } from '@/utils/mediaNode';
import type { WSEvent } from '@/types/workflow';
import type { ImageNodeData, LibTVEdge } from '@/types/canvas';

/**
 * 为多图生成结果创建兄弟图片节点
 * - 第一个 URL 已用于更新原节点，这里处理 urls[1..n-1]
 * - 新节点 ID：{原节点ID}-{index}（index 从 2 开始）
 * - 新节点位置：原节点下方，每个间隔 320px
 * - 复制原节点的关键属性（prompt/model/mentions/resolution/aspectRatio 等）
 * - 复制原节点的上游边
 */
function createSiblingImageNodes(
  originalNodeId: string,
  imageUrls: string[],
  width?: number,
  height?: number,
): void {
  const store = useCanvasStore.getState();
  const originalNode = store.nodes.find((n) => n.id === originalNodeId);
  if (!originalNode || originalNode.type !== 'image') {
    return;
  }

  const originalData = originalNode.data as ImageNodeData;
  const originalPos = originalNode.position;

  // 找到原节点的上游边（target = originalNodeId），用于复制到新节点
  const upstreamEdges = store.edges.filter((e) => e.target === originalNodeId);

  // 为 urls[1..n-1] 创建新节点（urls[0] 已用于更新原节点）
  for (let i = 1; i < imageUrls.length; i++) {
    const url = imageUrls[i];
    if (!url) continue;
    const index = i + 1; // 2, 3, 4, ...
    const newNodeId = `${originalNodeId}-${index}`;

    // 计算新节点 label
    const originalLabel = originalData.label || '';
    let newLabel: string;
    if (originalLabel.endsWith('参考图')) {
      // 原 label 是"分镜1-参考图" → 新节点"分镜1-参考图2"、"分镜1-参考图3"
      newLabel = `${originalLabel}${index}`;
    } else {
      // 其他情况 → "{原label}-{index}"
      newLabel = `${originalLabel}-${index}`;
    }

    // 如果节点已存在（重复执行场景），只更新 imageUrl
    if (store.nodes.some((n) => n.id === newNodeId)) {
      store.updateNodeData(newNodeId, {
        ...mediaFieldsFor('image', { url, width, height }),
        status: 'success' as const,
        stale: false,
        error: undefined,
        progressMessage: undefined,
      } as never);
      continue;
    }

    // 计算新节点位置：原节点下方，每个间隔 320px
    const newPos = {
      x: originalPos.x,
      y: originalPos.y + 320 * i,
    };

    // 创建新节点（复制原节点 data，但 imageUrl / label / status 不同）
    const newNode = createNode('image', newPos, {
      id: newNodeId,
      data: {
        ...originalData,
        ...mediaFieldsFor('image', { url, width, height }),
        label: newLabel,
        status: 'success' as const,
        stale: false,
        error: undefined,
        progressMessage: undefined,
      } as Partial<ImageNodeData>,
    });

    store.addNode(newNode);

    // 复制原节点的上游边到新节点
    for (const edge of upstreamEdges) {
      const newEdgeId = `e-${edge.source}-${newNodeId}`;
      if (!store.edges.some((e) => e.id === newEdgeId)) {
        const newEdge: LibTVEdge = {
          id: newEdgeId,
          source: edge.source,
          target: newNodeId,
          type: edge.type || 'dataFlow',
        };
        store.addEdge(newEdge);
      }
    }

    // eslint-disable-next-line no-console
    console.log('[SSE] 创建兄弟图片节点:', { newNodeId, url, label: newLabel });
  }
}

// 静默超时：超过这个时长没收到任何 SSE 消息（心跳/progress/事件），认为连接已死，切 polling
const SSE_SILENT_TIMEOUT_MS = 45_000;
// polling 间隔
const POLL_INTERVAL_MS = 5_000;

export interface UseExecutionStreamResult {
  /** 主动关闭当前 SSE（执行完成时由调用方调用） */
  close: () => void;
}

/**
 * 订阅单个 execution 的 SSE 流
 * - 鉴权走 query（EventSource 不支持自定义 header）
 * - 收到 node_completed 时把 output 写回到画布节点 data
 * - 收到 execution_completed / execution_failed 时自动关闭
 * - 断连时自动切换 polling 兜底（每 5s 查状态）
 */
export function useExecutionStream(
  projectId: string | null,
  executionId: string | number | null,
  nodeId?: string, // 当前执行的节点 ID（用于轮询时获取该节点最新数据）
  nodeIds?: string[], // 本次执行涉及的节点（重新进入项目恢复订阅时由 getActive 带回）
): UseExecutionStreamResult {
  const esRef = useRef<EventSource | null>(null);

  const close = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!projectId || !executionId) return;
    close();

    const token = useAuthStore.getState().token || '';
    const url = `/api/projects/${projectId}/workflows/${executionId}/stream?t=${encodeURIComponent(token)}`;

    const es = new EventSource(url);

    esRef.current = es;

    console.log('[SSE] connecting:', { projectId, executionId });

    // ---- 断连检测 + polling 兜底 ----
    let pollingStarted = false;
    let closedIntentionally = false; // 主动关闭标志：正常完成时不启动轮询

    // 静默超时熔断：任何消息都会刷新这个时间戳；超时则视为连接死了，切 polling
    let lastMessageAt = Date.now();
    const noteMessage = () => {
      lastMessageAt = Date.now();
    };

    // 本执行「出现过」的节点集合：终态收尾只处理这些节点，不再扫全画布。
    // 之前 execution_failed / 轮询终态会把整张画布所有 running/pending 一起标成同一终态，
    // 而行内支持多执行并行（activeStreams 是数组）—— A 执行失败会把还在跑的 B 节点也标失败。
    const seenNodeIds = new Set<string>();
    if (nodeId) seenNodeIds.add(nodeId);
    // 恢复订阅（刷新后重连）时没有单个 nodeId，但有执行涉及的节点列表：
    // 必须种进 seenNodeIds，否则终态收口会「没有可收口的节点」，节点永久停在生成中
    nodeIds?.forEach((id) => seenNodeIds.add(id));

    // 「补齐漏掉的节点」的异步任务：execution_completed 时回查后端最新节点数据。
    // onFinal 会等它结束再存画布 —— 否则可能把「running」存进服务端，
    // 覆盖掉后端收尾写入的 success（画布写没有乐观锁，后写者赢），刷新后又变回「生成中」。
    let reconcilePromise: Promise<void> = Promise.resolve();

    const ensurePolling = (reason: string) => {
      if (closedIntentionally) return; // 主动关闭（正常完成），不启动轮询
      if (!pollingStarted) {
        pollingStarted = true;
        console.warn(`[SSE] fallback to polling (${reason})`);
        useExecutionStore.getState().setLastError('SSE 连接已断开，正在轮询检查状态…');
        startPollingFallback();
      }
    };

    es.onerror = () => {
      const state = es.readyState;
      console.warn('[SSE] onerror, readyState:', state);
      // CONNECTING：浏览器正在自动重连 → 启动 polling 兜底
      // CLOSED：多次重连失败 → 启动 polling 兜底
      if (state === EventSource.CLOSED || state === EventSource.CONNECTING) {
        ensurePolling('onerror');
      }
    };

    // 静默超时巡检：每 5s 一次，超过阈值且没主动关闭就切 polling
    const silentTimer = setInterval(() => {
      if (closedIntentionally) return;
      if (pollingStarted) return;
      const silent = Date.now() - lastMessageAt;
      if (silent >= SSE_SILENT_TIMEOUT_MS) {
        console.warn(`[SSE] silent for ${Math.round(silent / 1000)}s, switching to polling`);
        ensurePolling('silent-timeout');
      }
    }, 5_000);

    // ---- 轮询兜底 ----
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const startPollingFallback = () => {
      if (pollTimer) return;
      // polling 接管后主动关闭 SSE，避免浏览器空转重连
      close();
      // 切 polling 时立即把超时熔断器停掉
      clearInterval(silentTimer);

      const poll = async () => {
        if (!projectId || !executionId) return;
        try {
          const resp = await workflowApi.getStatus(projectId, String(executionId), nodeId);
          // 注意：axios 拦截器已解包 ApiResponse.data，resp 本身就是 {status, error_msg, node_data, ...}
          const exec = (resp as unknown) as
            | {
                status?: string;
                error_msg?: string;
                node_data?: Record<string, unknown>;
              }
            | undefined;
          if (!exec) return;

          console.log('[SSE] poll result:', exec.status);

          const store = useCanvasStore.getState();
          // normalize status（后端可能返回不同大小写）
          const status = (exec.status || '').toLowerCase();

          // 终态：写入最终数据并收尾
          if (status === 'done' || status === 'failed') {
            const finalStatus = status === 'done' ? ('success' as const) : ('failed' as const);

            // ✅ 提取错误消息（用于显示在节点上）
            const errorMsg = exec.error_msg;

            // 如果后端返回了节点数据，直接更新该节点
            if (nodeId && exec.node_data) {
              // ✅ 提取 imageUrls（如果存在），用于轮询兜底创建兄弟节点
              const pollNodeData = exec.node_data as Record<string, unknown> & {
                imageUrls?: unknown;
                width?: number;
                height?: number;
              };
              const pollImageUrls = pollNodeData.imageUrls;
              const pollWidth = pollNodeData.width;
              const pollHeight = pollNodeData.height;

              store.updateNodeData(nodeId, {
                ...exec.node_data,
                status: finalStatus,
                error: finalStatus === 'failed' ? errorMsg : undefined,  // ✅ 保存错误消息到节点error字段
                progressMessage: undefined,
              } as never);

              // ✅ 轮询兜底：如果 node_data 里有 imageUrls 数组且长度 > 1，同样创建兄弟节点
              if (
                finalStatus === 'success' &&
                Array.isArray(pollImageUrls) &&
                pollImageUrls.length > 1
              ) {
                createSiblingImageNodes(
                  nodeId,
                  pollImageUrls as string[],
                  pollWidth,
                  pollHeight,
                );
              }
            }

            // 收尾本执行见过的、还在 running/pending 的节点（不扫全画布，避免误伤并行执行的节点）。
            // 与 SSE 的 execution_completed 共用同一份收口实现：轮询兜底路径原来只写画布、
            // 不写 executionStore，于是 generatingNodeId 永不清除 —— 生成按钮永久停在
            // 「生成中…」且重试被拦（必须刷新页面）。
            // 轮询兜底这条路径原来只收节点状态、不刷新积分：
            // SSE 断线后走这里收尾，余额会一直停在旧值（刷新页面才更新）
            void refreshCredits();

            const pending = pendingNodeIdsOf(seenNodeIds);
            if (pending.length > 0) {
              await reconcileNodesOnTerminal(
                projectId,
                executionId,
                pending,
                finalStatus,
                finalStatus === 'failed' ? errorMsg : undefined,
              );
            } else {
              const es = useExecutionStore.getState();
              es.setGeneratingNodeId(null);
              es.removeActiveStream(executionId);
            }
            stopPolling();
            return;
          }

          // running 期间：把后端节点的最新 data 同步到画布
          // - 这样即使 SSE 断了，用户也能看到脚本/分镜内容陆续刷出来
          // - 设置 progressMessage 为"继续运行中"
          if (status === 'running' && nodeId && exec.node_data) {
            // node_data 里可能已经包含 scriptContent/shots/characters 等，
            // 合并到当前节点上，但不覆盖 status（保持 running）
            const { status: _ignored, progressMessage: _pm, ...rest } = exec.node_data as Record<string, unknown> & {
              status?: unknown;
              progressMessage?: unknown;
            };
            void _ignored;
            void _pm;
            store.updateNodeData(nodeId, {
              ...rest,
              progressMessage: '继续运行中',
            } as never);
          } else if (status === 'running' && nodeId) {
            // 没有 node_data 时，只更新 progressMessage
            store.updateNodeData(nodeId, {
              progressMessage: '继续运行中',
            } as never);
          }
        } catch (e) {
          console.warn('[SSE] polling getStatus failed:', e);
        }
      };

      // 立刻跑一次，再每 5s 跑
      void poll();
      pollTimer = setInterval(poll, POLL_INTERVAL_MS);
    };

    const stopPolling = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    // ---- 事件处理 ----
    const handleEvent = (raw: MessageEvent) => {
      noteMessage();
      try {
        const event: WSEvent = JSON.parse(raw.data);
        useExecutionStore.getState().handleWSEvent(event);

        // 余额变动：直接把服务端给的余额快照写进登录态（同一个扣费流程里读到的值，就是准的）。
        // 这是"后端一扣费、界面立刻变"的那一步 —— 不再等生成结束，也不用前端自己算加减。
        if (event.type === 'credits_changed') {
          const d = (event.data || {}) as { balance?: number };
          if (typeof d.balance === 'number') {
            useAuthStore.getState().setUser({ credits: d.balance });
          } else {
            void refreshCredits(true); // 兜底：没带余额快照就自己去拉一次
          }
        }

        if (event.nodeId) seenNodeIds.add(event.nodeId);

        if (event.type === 'node_completed' && event.nodeId && event.data) {
          const data = event.data as {
            content?: string;
            scriptContent?: string;
            shots?: unknown[];
            characters?: unknown[];
            scenes?: unknown[];
            props?: unknown[];
            imageUrl?: string;
            imageUrls?: string[];  // ✅ 多图 URL 数组（N>1 时后端返回）
            width?: number;    // ✅ 图片宽度
            height?: number;   // ✅ 图片高度
            videoUrl?: string;
            audioUrl?: string;
            error?: string;
            // 清晰化节点（enhance）的输出：原片地址 + 本次处理的档位/耗时/尺寸，
            // 用于节点上的「已清晰化」徽标与「原片/增强后」对比
            sourceUrl?: string;
            enhanceLevel?: string;
            enhanceElapsedMs?: number;
            enhanceSourceSize?: string;
            enhanceTargetSize?: string;
            enhanceProvider?: string;
            enhanceProviderLabel?: string;
            enhanceChannel?: string;
            enhanceChannelLabel?: string;
            enhanceRequestedMode?: string;
            enhanceModeLabel?: string;
            enhanceNote?: string;
            enhanceError?: string;
          };
          // ✅ executor 返回 Status=failed 但 err=nil 时，data 带 error 字段（图片/视频节点）
          if (data.error) {
            message.error(data.error);
            useCanvasStore.getState().updateNodeData(event.nodeId, {
              status: 'failed',
              error: data.error,
              stale: false,
            } as never);
            return;
          }
          const updates: Record<string, unknown> = {};
          if (data.content !== undefined) updates.content = data.content;
          if (data.scriptContent !== undefined) updates.scriptContent = data.scriptContent;
          if (data.shots !== undefined) {
            updates.shots = data.shots;
            updates.currentStep = 1;
          }
          if (data.characters !== undefined) updates.characters = data.characters;
          if (data.scenes !== undefined) updates.scenes = data.scenes;
          if (data.props !== undefined) updates.props = data.props;
          if (data.imageUrl !== undefined) updates.imageUrl = data.imageUrl;
          if (data.width !== undefined) updates.width = data.width;      // ✅ 保存图片宽度
          if (data.height !== undefined) updates.height = data.height;   // ✅ 保存图片高度
          if (data.videoUrl !== undefined) {
            updates.videoUrl = data.videoUrl;
            // ✅ 清除旧的视频尺寸，让 VideoNode useEffect 重新加载新视频的元数据
            updates.videoWidth = undefined;
            updates.videoHeight = undefined;
          }
          if (data.audioUrl !== undefined) updates.audioUrl = data.audioUrl;
          // 清晰化节点：把处理留痕一起写回节点，徽标与对比按钮全靠它们
          if (data.sourceUrl !== undefined) updates.sourceUrl = data.sourceUrl;
          if (data.enhanceLevel !== undefined) updates.enhanceLevel = data.enhanceLevel;
          if (data.enhanceElapsedMs !== undefined) updates.enhanceElapsedMs = data.enhanceElapsedMs;
          if (data.enhanceSourceSize !== undefined) updates.enhanceSourceSize = data.enhanceSourceSize;
          if (data.enhanceTargetSize !== undefined) updates.enhanceTargetSize = data.enhanceTargetSize;
          if (data.enhanceProvider !== undefined) updates.enhanceProvider = data.enhanceProvider;
          if (data.enhanceProviderLabel !== undefined) updates.enhanceProviderLabel = data.enhanceProviderLabel;
          if (data.enhanceNote !== undefined) updates.enhanceNote = data.enhanceNote;
          if (data.enhanceChannel !== undefined) updates.enhanceChannel = data.enhanceChannel;
          if (data.enhanceChannelLabel !== undefined) updates.enhanceChannelLabel = data.enhanceChannelLabel;
          if (data.enhanceRequestedMode !== undefined) updates.enhanceRequestedMode = data.enhanceRequestedMode;
          if (data.enhanceModeLabel !== undefined) updates.enhanceModeLabel = data.enhanceModeLabel;
          updates.stale = false;
          // ✅ 成功后必须清除残留的 error（先失败后重试成功时，旧报错会一直留在节点 data 里）
          updates.error = undefined;
          updates.status = 'success';
          if (Object.keys(updates).length > 0) {
            useCanvasStore.getState().updateNodeData(event.nodeId, updates as never);
          }

          // ✅ 多图生成：如果 imageUrls 是数组且长度 > 1，为其余 URL 创建新的图片节点
          // 第一个 URL 已用于更新当前节点，剩余 URL 创建兄弟节点
          if (Array.isArray(data.imageUrls) && data.imageUrls.length > 1) {
            createSiblingImageNodes(event.nodeId, data.imageUrls, data.width, data.height);
          }
        } else if (event.type === 'node_failed' && event.nodeId) {
          const errMsg =
            (event.data as { error?: string } | undefined)?.error ||
            (event.data as { message?: string } | undefined)?.message ||
            '节点执行失败';
          message.error(errMsg);
          useCanvasStore.getState().updateNodeData(event.nodeId, {
            status: 'failed',
            error: errMsg,
          } as never);
        } else if (event.type === 'execution_failed') {
          // ✅ 处理execution_failed事件（整体执行失败）
          // ✅ 兼容两种字段名：error（WorkflowEvent格式）和errorMsg（GetExecution API格式）
          const errMsg =
            (event.data as { error?: string } | undefined)?.error ||
            (event.data as { errorMsg?: string } | undefined)?.errorMsg ||
            '执行失败';
          // ✅ 更新本执行「见过的」running/pending 节点为failed（不扫全画布：
          // 并行执行时别的执行的节点不该被牵连标失败、更不该挂上本次的错误文案）
          const store = useCanvasStore.getState();
          store.nodes.forEach((n) => {
            if (!seenNodeIds.has(n.id)) return;
            const s = n.data.status;
            if (s === 'running' || s === 'pending') {
              store.updateNodeData(n.id, {
                status: 'failed',
                error: errMsg,
                progressMessage: undefined,
              } as never);
            }
          });
        } else if (event.type === 'execution_completed') {
          // ✅ 执行成功也必须兜底一次收尾。
          //
          // 原来这个分支不存在：成功路径完全依赖每个节点的 node_completed 事件。
          // 事件确实可能收不到（连接建立时执行刚好结束、引擎订阅缓冲满被丢弃、断线期间发生），
          // 漏一次的节点就会永久停在 running —— 更糟的是 onFinal 会立刻把这个 running
          // 存进服务端画布，刷新后也回不到正确状态（节点永远「生成中」）。
          // 这里对仍处于 running/pending 的节点逐个回查后端最新节点数据补齐。
          const pending = pendingNodeIdsOf(seenNodeIds);
          if (pending.length > 0 && projectId) {
            reconcilePromise = reconcileNodesOnTerminal(projectId, executionId, pending, 'success');
          }
        } else if (event.type === 'node_started' && event.nodeId) {
          useCanvasStore.getState().updateNodeData(event.nodeId, {
            status: 'running',
            error: undefined,
            progressMessage: undefined,
          } as never);
        } else if (event.type === 'node_progress' && event.nodeId) {
          const pd = event.data as { elapsed?: number; elapsedMs?: number; message?: string } | undefined;
          // 高频进度更新走专用通道：只写 progressMessage（"已运行 10s"），不进历史、不置脏标记
          useCanvasStore.getState().updateNodeProgress(event.nodeId, pd?.message);
        }
      } catch (e) {
        console.error('[SSE] parse error:', e);
      }
    };

    const eventTypes = [
      'connected',
      'execution_started',
      'node_started',
      'node_progress',
      'node_completed',
      'node_failed',
      'execution_completed',
      'execution_failed',
      'heartbeat', // 后端 15s 心跳事件，用于刷新前端超时熔断器
      'credits_changed', // 后端扣费/退费那一刻推送的余额变动
    ];
    eventTypes.forEach((t) => es.addEventListener(t, handleEvent as EventListener));

    // ---- 终态处理 ----
    const onFinal = () => {
      closedIntentionally = true; // 标记为主动关闭，防止 onerror 误启动轮询

      // 从 activeStreams 中移除本执行（让下次同节点再生成能重新订阅）
      useExecutionStore.getState().removeActiveStream(executionId);

      // 执行完成后刷新积分（扣费后同步余额）
      void refreshCredits();

      // 执行完成后自动保存画布。
      // 必须等 reconcilePromise（漏掉的节点回查补齐）结束：先把状态修正到终态再存盘，
      // 否则会把 running 写进服务端画布，与该执行已经结束的事实矛盾（刷新后节点又转圈）。
      void reconcilePromise.finally(() => {
        const store = useCanvasStore.getState();
        const pid = store.projectId;
        if (pid) {
          const viewport = store._cache.get(pid)?.savedViewport || { x: 0, y: 0, zoom: 1 };
          canvasApi.saveCanvas(pid, {
            nodes: store.nodes,
            edges: store.edges,
            viewport,
          }).catch((e) => console.warn('[SSE] execution final auto-save failed:', e));
        }
        setTimeout(() => close(), 100);
      });
    };

    es.addEventListener('execution_completed', onFinal as EventListener);
    es.addEventListener('execution_failed', onFinal as EventListener);

    // ---- 清理 ----
    return () => {
      eventTypes.forEach((t) => es.removeEventListener(t, handleEvent as EventListener));
      es.removeEventListener('execution_completed', onFinal as EventListener);
      es.removeEventListener('execution_failed', onFinal as EventListener);
      clearInterval(silentTimer);
      stopPolling();
      close();
    };
  }, [projectId, executionId, nodeId, close]);

  return { close };
}
