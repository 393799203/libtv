import { useCallback, useMemo } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { useExecutionStore } from '@/stores/executionStore';
import { workflowApi } from '@/services/workflowApi';
import { canvasApi } from '@/services/canvasApi';
import { getDownstreamOf, clearAllStale } from '@/utils/topology';
import type { LibTVNodeData } from '@/types/canvas';

export interface UseNodeGenerationOptions {
  /** 节点 ID */
  nodeId: string;
}

export interface UseNodeGenerationResult {
  /** 当前节点的执行 ID（订阅 SSE 用） */
  executionId: string | number | null;
  /** 节点下游 ID 列表（用于 stale 标记） */
  downstreamIds: string[];
  /** 是否正在生成 */
  isGenerating: boolean;
  /** 进度 0-100 */
  progress: number;
  /** 错误信息 */
  error: string | null;
  /** 单节点生成（不影响下游执行，但会标 stale） */
  generate: (params?: { mode?: 'single' | 'downstream' }) => Promise<void>;
  /** 重新生成下游（用 downstream 模式：startNode + 后代） */
  regenerateDownstream: () => Promise<void>;
  /** 手动清掉错误 */
  clearError: () => void;
}

/**
 * 单节点生成 hook — 统一入口
 *
 * 行为：
 * - generate() 默认调后端 mode='single'，只跑当前节点
 * - 调用前自动把所有下游节点打 stale 标
 * - 调后端前先 saveCanvas（清掉 stale 避免脏标入盘）
 * - 订阅 SSE 接收 node_completed 事件，由 useExecutionStream 自动写回画布
 * - 暴露 regenerateDownstream() 给"重新生成下游"按钮用
 */
export function useNodeGeneration(
  options: UseNodeGenerationOptions,
): UseNodeGenerationResult {
  const { nodeId } = options;

  const projectId = useCanvasStore((s) => s.projectId);
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const updateNodeStatus = useCanvasStore((s) => s.updateNodeStatus);

  const currentExecution = useExecutionStore((s) => s.currentExecution);
  const nodeExec = currentExecution?.nodes?.find((n) => n.nodeId === nodeId);
  const setGeneratingNodeId = useExecutionStore((s) => s.setGeneratingNodeId);
  const lastError = useExecutionStore((s) => s.lastError);
  const activeStreams = useExecutionStore((s) => s.activeStreams);
  const addActiveStream = useExecutionStore((s) => s.addActiveStream);

  // 查找当前节点的活跃流（支持多节点并行执行）
  const myStream = activeStreams.find((s) => s.nodeId === nodeId);
  const executionId = myStream?.executionId ?? null;

  const downstreamIds = useMemo(
    () => getDownstreamOf(nodeId, nodes, edges),
    [nodeId, nodes, edges],
  );

  const isGenerating = !!executionId && (nodeExec?.status === 'running' || nodeExec?.status === 'pending');
  const progress = nodeExec?.progress ?? 0;
  const error = lastError || nodeExec?.error || null;

  const persistCanvas = useCallback(async () => {
    if (!projectId) return;
    // 存盘前清掉所有 stale 标（脏标不进持久化）
    const cleanNodes = clearAllStale(useCanvasStore.getState().nodes);
    // 直接调 saveCanvas（用最新 nodes）
    const fresh = useCanvasStore.getState();
    await canvasApi.saveCanvas(projectId, {
      nodes: cleanNodes.length === fresh.nodes.length ? fresh.nodes : cleanNodes,
      edges: fresh.edges,
      viewport: { x: 0, y: 0, zoom: 1 },
    });
  }, [projectId]);

  const generate: UseNodeGenerationResult['generate'] = useCallback(
    async (params) => {
      if (!projectId) return;
      const mode = params?.mode ?? 'single';

      // 1) 准备标记（只设 stale，不改变当前节点状态为 running/pending）
      const downstream = getDownstreamOf(nodeId, nodes, edges);
      if (mode === 'downstream') {
        // downstream 模式：只跑下游节点，当前节点不动
        downstream.forEach((id) => {
          updateNodeData(id, { stale: true } as Partial<LibTVNodeData>);
        });
      } else {
        // single 模式：只跑当前节点
        downstream.forEach((id) => {
          updateNodeData(id, { stale: true } as Partial<LibTVNodeData>);
        });
        // 注意：这里不设置当前节点为 running！等保存后再设
      }

      // 2) 【关键】先持久化（此时状态还是 idle/之前的值，不保存 running）
      await persistCanvas();

      // 3) 保存完成后，再设置运行状态（显示骨架屏）
      if (mode === 'downstream') {
        downstream.forEach((id) => {
          updateNodeStatus(id, 'pending');
        });
      } else {
        updateNodeData(nodeId, { stale: false, status: 'running', progressMessage: undefined } as Partial<LibTVNodeData>);
        updateNodeStatus(nodeId, 'running');
        setGeneratingNodeId(nodeId);
      }

      // 4) 调后端
      try {
        const resp = await workflowApi.execute(projectId, {
          startNodeId: nodeId,
          mode,
        });
        if (resp?.executionId != null) {
          // 写入全局 store，由 WorkspacePage 顶层订阅 SSE
          // （与节点选中状态解耦：节点失焦不会卸载 SSE 订阅）
          // 支持多节点并行：每个 executionId 独立订阅
          addActiveStream({ projectId, executionId: resp.executionId, nodeId });
        } else {
          // 启动失败：先设 failed，再保存（确保不保存 running）
          updateNodeStatus(nodeId, 'failed');
          setGeneratingNodeId(null);
          await persistCanvas();
        }
      } catch (e) {
        console.error('[useNodeGeneration] execute failed:', e);
        // 调用失败：先设 failed，再保存（确保不保存 running）
        updateNodeStatus(nodeId, 'failed');
        setGeneratingNodeId(null);
        await persistCanvas();
      }
    },
    [projectId, nodeId, nodes, edges, updateNodeData, updateNodeStatus, setGeneratingNodeId, persistCanvas, addActiveStream],
  );

  const regenerateDownstream: UseNodeGenerationResult['regenerateDownstream'] =
    useCallback(async () => {
      // 用 downstream 模式重跑 startNode + 所有后代
      await generate({ mode: 'downstream' });
    }, [generate]);

  const clearError = useCallback(() => {
    useExecutionStore.getState().setLastError(null);
  }, []);

  return {
    executionId,
    downstreamIds,
    isGenerating,
    progress,
    error,
    generate,
    regenerateDownstream,
    clearError,
  };
}
