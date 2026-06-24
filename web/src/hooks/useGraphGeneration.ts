import { useCallback, useState } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { useExecutionStore } from '@/stores/executionStore';
import { useExecutionStream } from '@/hooks/useExecutionStream';
import { workflowApi } from '@/services/workflowApi';
import { canvasApi } from '@/services/canvasApi';
import { clearAllStale } from '@/utils/topology';
import type { LibTVNodeData } from '@/types/canvas';

export interface UseGraphGenerationResult {
  /** 当前 execution id */
  executionId: string | number | null;
  /** 是否正在生成 */
  isExecuting: boolean;
  /** 错误信息 */
  error: string | null;
  /** 全图执行（画布右上角"一键生成"按钮用） */
  generateAll: () => Promise<void>;
  /** 停止执行 */
  stop: () => Promise<void>;
}

/**
 * 全图生成 hook — 画布右上角"一键生成"按钮的统一入口
 *
 * 行为：
 * - 调用前清掉全画布所有 stale 标
 * - 调后端 mode=''（不传 startNodeId）跑全图
 * - 订阅 SSE，由 useExecutionStream 自动把 node_completed 的 output 写回画布
 */
export function useGraphGeneration(): UseGraphGenerationResult {
  const projectId = useCanvasStore((s) => s.projectId);
  const nodes = useCanvasStore((s) => s.nodes);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const updateNodeStatus = useCanvasStore((s) => s.updateNodeStatus);

  const isExecuting = useExecutionStore((s) => s.isExecuting);
  const lastError = useExecutionStore((s) => s.lastError);
  const setExecutionStatus = useExecutionStore((s) => s.setExecutionStatus);
  const resetExecution = useExecutionStore((s) => s.resetExecution);
  const setLastError = useExecutionStore((s) => s.setLastError);

  const [localExecId, setLocalExecId] = useState<string | number | null>(null);
  const executionId = localExecId;
  useExecutionStream(projectId, executionId);

  const generateAll: UseGraphGenerationResult['generateAll'] = useCallback(async () => {
    if (!projectId) return;
    setLastError(null);

    // 失败时保存最终状态（确保不保存 pending/running）
    const persistFinalCanvas = async () => {
      const store = useCanvasStore.getState();
      if (store.projectId) {
        const viewport = store._cache.get(store.projectId)?.savedViewport || { x: 0, y: 0, zoom: 1 };
        await canvasApi.saveCanvas(store.projectId, {
          nodes: clearAllStale(store.nodes),
          edges: store.edges,
          viewport,
        });
      }
    };

    // 1) 清掉全画布 stale 标
    const cleanNodes = clearAllStale(nodes);
    cleanNodes.forEach((n) => {
      if (n.data.stale !== false) {
        // 写回画布（用 updateNodeData 会触发 history，这里直接用底层的 marks）
        updateNodeData(n.id, { stale: false } as Partial<LibTVNodeData>);
      }
    });

    // 2) 持久化（清掉 stale，此时节点状态还是 idle/之前的值）
    const fresh = useCanvasStore.getState();
    await canvasApi.saveCanvas(projectId, {
      nodes: clearAllStale(fresh.nodes),
      edges: fresh.edges,
      viewport: { x: 0, y: 0, zoom: 1 },
    });

    // 3) 把所有节点状态置为 pending（视觉提示）— 在保存之后才设置
    fresh.nodes.forEach((n) => {
      updateNodeStatus(n.id, 'pending');
    });
    setExecutionStatus('running');

    // 4) 调后端
  try {
    const resp = await workflowApi.execute(projectId);
    if (resp?.executionId != null) {
      setLocalExecId(resp.executionId);
    } else {
      // 启动失败：先设 failed，再保存（确保不保存 pending）
      setExecutionStatus('failed');
      setLastError('启动工作流执行失败');
      await persistFinalCanvas();
    }
  } catch (e) {
    console.error('[useGraphGeneration] execute failed:', e);
    // 调用失败：先设 failed，再保存（确保不保存 pending）
    setExecutionStatus('failed');
    setLastError((e as Error).message || '启动工作流执行失败');
    await persistFinalCanvas();
  }
  }, [projectId, nodes, updateNodeData, updateNodeStatus, setExecutionStatus, setLastError]);

  const stop: UseGraphGenerationResult['stop'] = useCallback(async () => {
    if (!projectId || !executionId) return;
    try {
      await workflowApi.stop(projectId, String(executionId));
      resetExecution();
    } catch (e) {
      console.error('[useGraphGeneration] stop failed:', e);
    }
  }, [projectId, executionId, resetExecution]);

  return {
    executionId,
    isExecuting,
    error: lastError,
    generateAll,
    stop,
  };
}
