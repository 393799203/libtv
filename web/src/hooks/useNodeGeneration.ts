import { useCallback, useMemo, useEffect } from 'react';
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
  const generatingNodeId = useExecutionStore((s) => s.generatingNodeId);
  const setGeneratingNodeId = useExecutionStore((s) => s.setGeneratingNodeId);
  const setCurrentExecution = useExecutionStore((s) => s.setCurrentExecution);
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

  // 简化逻辑：只要当前节点是 generatingNodeId，就显示生成中
  const isGenerating = generatingNodeId === nodeId || (!!executionId && (nodeExec?.status === 'running' || nodeExec?.status === 'pending'));
  const progress = nodeExec?.progress ?? 0;
  const error = lastError || nodeExec?.error || null;

  // 监听节点状态：完成后清除 generatingNodeId
  useEffect(() => {
    if (nodeExec?.status === 'success' || nodeExec?.status === 'failed') {
      if (generatingNodeId === nodeId) {
        setGeneratingNodeId(null);
      }
    }
  }, [nodeExec?.status, generatingNodeId, nodeId, setGeneratingNodeId]);

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

      // 防重复点击：如果已经在生成中，直接返回
      if (generatingNodeId === nodeId) {
        console.log('[useNodeGeneration] 当前节点正在生成，忽略重复点击');
        return;
      }

      const mode = params?.mode ?? 'single';

      // 1) 立即设置为生成中（按钮马上显示状态）
      setGeneratingNodeId(nodeId);

      // 2) 标记下游节点为 stale
      const downstream = getDownstreamOf(nodeId, nodes, edges);
      downstream.forEach((id) => {
        updateNodeData(id, { stale: true } as Partial<LibTVNodeData>);
      });

      // 3) 持久化画布（不保存 running 状态）
      await persistCanvas();

      // 4) 设置节点运行状态
      if (mode !== 'downstream') {
        updateNodeData(nodeId, { stale: false, status: 'running' } as Partial<LibTVNodeData>);
        updateNodeStatus(nodeId, 'running');
      }

      // 5) 调后端 API
      try {
        const resp = await workflowApi.execute(projectId, {
          startNodeId: nodeId,
          mode,
        });
        if (resp?.executionId != null) {
          // 设置 currentExecution，让 SSE 能正常更新节点状态
          setCurrentExecution({
            id: resp.executionId,
            status: 'running',
            nodes: [{ nodeId, status: 'running', progress: 0 }],
          } as never);
          addActiveStream({ projectId, executionId: resp.executionId, nodeId });
        } else {
          // API 返回但没有 executionId，说明失败
          updateNodeStatus(nodeId, 'failed');
          setGeneratingNodeId(null);
          await persistCanvas();
        }
      } catch (e) {
        console.error('[useNodeGeneration] execute failed:', e);
        updateNodeStatus(nodeId, 'failed');
        setGeneratingNodeId(null);
        await persistCanvas();
      }
    },
    [projectId, nodeId, nodes, edges, generatingNodeId, updateNodeData, updateNodeStatus, setGeneratingNodeId, setCurrentExecution, persistCanvas, addActiveStream],
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
