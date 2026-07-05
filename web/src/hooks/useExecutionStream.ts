import { useEffect, useRef, useCallback } from 'react';
import { message } from 'antd';
import { useExecutionStore } from '@/stores/executionStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useAuthStore } from '@/stores/authStore';
import { workflowApi } from '@/services/workflowApi';
import { canvasApi } from '@/services/canvasApi';
import type { WSEvent } from '@/types/workflow';

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
          const exec = (resp?.data as unknown) as
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

            // 如果后端返回了节点数据，直接更新该节点
            if (nodeId && exec.node_data) {
              store.updateNodeData(nodeId, {
                ...exec.node_data,
                status: finalStatus,
                progressMessage: undefined,
              } as never);
            }

            // 收尾所有还在 running/pending 的节点
            store.nodes.forEach((n) => {
              const s = n.data.status;
              if (s === 'running' || s === 'pending') {
                store.updateNodeData(n.id, {
                  status: finalStatus,
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
            videoUrl?: string;
            audioUrl?: string;
          };
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
          if (data.videoUrl !== undefined) updates.videoUrl = data.videoUrl;
          if (data.audioUrl !== undefined) updates.audioUrl = data.audioUrl;
          updates.stale = false;
          updates.status = 'success';
          if (Object.keys(updates).length > 0) {
            useCanvasStore.getState().updateNodeData(event.nodeId, updates as never);
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
