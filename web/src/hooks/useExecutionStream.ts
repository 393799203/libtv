import { useEffect, useRef, useCallback } from 'react';
import { useExecutionStore } from '@/stores/executionStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useAuthStore } from '@/stores/authStore';
import type { WSEvent } from '@/types/workflow';

export interface UseExecutionStreamResult {
  /** 主动关闭当前 SSE（执行完成时由调用方调用） */
  close: () => void;
}

/**
 * 订阅单个 execution 的 SSE 流
 * - 鉴权走 query（EventSource 不支持自定义 header）
 * - 收到 node_completed 时把 output 写回到画布节点 data
 * - 收到 execution_completed / execution_failed 时自动关闭
 * - 错误处理：SSE 协议层 onerror 写入 lastError；业务失败由 handleWSEvent 写入 lastError / nodeErrors
 *   不做自动重试/轮询，失败时把错误信息展示给用户
 */
export function useExecutionStream(
  projectId: string | null,
  executionId: string | number | null,
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

    es.addEventListener('open', () => {
      console.log('[SSE] connected:', { projectId, executionId });
    });

    const handleEvent = (raw: MessageEvent) => {
      try {
        const event: WSEvent = JSON.parse(raw.data);
        useExecutionStore.getState().handleWSEvent(event);

        if (event.type === 'node_completed' && event.nodeId && event.data) {
          const data = event.data as { content?: string; scriptContent?: string };
          const updates: Record<string, unknown> = {};
          if (data.content !== undefined) updates.content = data.content;
          if (data.scriptContent !== undefined) updates.scriptContent = data.scriptContent;
          if (Object.keys(updates).length > 0) {
            useCanvasStore.getState().updateNodeData(event.nodeId, updates as never);
          }
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
    ];
    eventTypes.forEach((t) => es.addEventListener(t, handleEvent as EventListener));

    es.onerror = () => {
      // SSE 协议层错误：连接中断 / 服务器关流 / 鉴权失败
      // readyState: 0=CONNECTING, 1=OPEN, 2=CLOSED
      const state = es.readyState;
      const msg =
        state === EventSource.CLOSED
          ? 'SSE 连接已断开'
          : 'SSE 连接异常';
      console.warn(`[SSE] error (readyState=${state})`);
      useExecutionStore.getState().setLastError(msg);
    };

    // 终态事件：自动关闭
    const onFinal = (raw: MessageEvent) => {
      try {
        const event: WSEvent = JSON.parse(raw.data);
        if (event.type === 'execution_completed' || event.type === 'execution_failed') {
          setTimeout(() => close(), 100);
        }
      } catch {
        /* noop */
      }
    };
    es.addEventListener('execution_completed', onFinal as EventListener);
    es.addEventListener('execution_failed', onFinal as EventListener);

    return () => {
      eventTypes.forEach((t) => es.removeEventListener(t, handleEvent as EventListener));
      es.removeEventListener('execution_completed', onFinal as EventListener);
      es.removeEventListener('execution_failed', onFinal as EventListener);
      close();
    };
  }, [projectId, executionId, close]);

  return { close };
}
