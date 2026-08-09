import { useEffect, useRef, useCallback } from 'react';
import { message } from 'antd';
import { useExecutionStore } from '@/stores/executionStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useAuthStore } from '@/stores/authStore';
import { workflowApi } from '@/services/workflowApi';
import { canvasApi } from '@/services/canvasApi';
import { createNode } from '@/utils/nodeFactory';
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
        imageUrl: url,
        width,
        height,
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
        label: newLabel,
        imageUrl: url,
        width,
        height,
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

            // 收尾所有还在 running/pending 的节点
            store.nodes.forEach((n) => {
              const s = n.data.status;
              if (s === 'running' || s === 'pending') {
                store.updateNodeData(n.id, {
                  status: finalStatus,
                  error: finalStatus === 'failed' ? errorMsg : undefined,  // ✅ 保存错误消息到节点error字段
                  progressMessage: undefined,
                } as never);
              }
            });
            useExecutionStore.getState().setLastError(null);
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
          if (data.videoUrl !== undefined) updates.videoUrl = data.videoUrl;
          if (data.audioUrl !== undefined) updates.audioUrl = data.audioUrl;
          updates.stale = false;
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
          // ✅ 更新所有running/pending状态的节点为failed
          const store = useCanvasStore.getState();
          store.nodes.forEach((n) => {
            const s = n.data.status;
            if (s === 'running' || s === 'pending') {
              store.updateNodeData(n.id, {
                status: 'failed',
                error: errMsg,
                progressMessage: undefined,
              } as never);
            }
          });
        } else if (event.type === 'node_started' && event.nodeId) {
          useCanvasStore.getState().updateNodeData(event.nodeId, {
            status: 'running',
            error: undefined,
            progressMessage: undefined,
          } as never);
        } else if (event.type === 'node_progress' && event.nodeId) {
          const pd = event.data as { elapsed?: number; elapsedMs?: number; message?: string } | undefined;
          useCanvasStore.getState().updateNodeData(event.nodeId, {
            progressMessage: pd?.message, // 只保留progressMessage（"已运行 10s"）
          } as never);
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
    ];
    eventTypes.forEach((t) => es.addEventListener(t, handleEvent as EventListener));

    // ---- 终态处理 ----
    const onFinal = () => {
      closedIntentionally = true; // 标记为主动关闭，防止 onerror 误启动轮询

      // 从 activeStreams 中移除本执行（让下次同节点再生成能重新订阅）
      useExecutionStore.getState().removeActiveStream(executionId);

      // 执行完成后自动保存画布
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
