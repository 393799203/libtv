import { useCallback, useEffect } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { useExecutionStore } from '@/stores/executionStore';
import { workflowApi } from '@/services/workflowApi';
import { canvasApi } from '@/services/canvasApi';
import { clearAllStale } from '@/utils/topology';
import type { LibTVNodeData } from '@/types/canvas';

export interface UseNodeGenerationOptions {
  /** 节点 ID */
  nodeId: string;
}

export interface UseNodeGenerationResult {
  /** 当前节点的执行 ID（订阅 SSE 用） */
  executionId: string | number | null;
  /** 是否正在生成 */
  isGenerating: boolean;
  /** 进度 0-100 */
  progress: number;
  /** 错误信息 */
  error: string | null;
  /** 单节点生成 */
  generate: (params?: { mode?: 'single' | 'downstream' }) => Promise<void>;
  /** 暂存画布（只保存不生成） */
  saveCanvas: () => Promise<void>;
  /** 手动清掉错误 */
  clearError: () => void;
}

/**
 * 单节点生成 hook — 统一入口
 *
 * 行为：
 * - generate() 默认调后端 mode='single'，只跑当前节点
 * - 调后端前先 saveCanvas
 * - 订阅 SSE 接收 node_completed 事件，由 useExecutionStream 自动写回画布
 */
export function useNodeGeneration(
  options: UseNodeGenerationOptions,
): UseNodeGenerationResult {
  const { nodeId } = options;

  const projectId = useCanvasStore((s) => s.projectId);
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
    const fresh = useCanvasStore.getState();
    await canvasApi.saveCanvas(projectId, {
      nodes: clearAllStale(fresh.nodes),
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

      // 2) 持久化画布
      await persistCanvas();

      // 3) 设置节点运行状态
      if (mode !== 'downstream') {
        updateNodeData(nodeId, { status: 'running' } as Partial<LibTVNodeData>);
        updateNodeStatus(nodeId, 'running');
      }

      // 4) 调后端 API
      try {
        const resp = await workflowApi.execute(projectId, {
          startNodeId: nodeId,
          mode,
        });
        if (resp?.executionId != null) {
          setCurrentExecution({
            id: resp.executionId,
            status: 'running',
            nodes: [{ nodeId, status: 'running', progress: 0 }],
          } as never);
          addActiveStream({ projectId, executionId: resp.executionId, nodeId });
        } else {
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
    [projectId, nodeId, generatingNodeId, updateNodeData, updateNodeStatus, setGeneratingNodeId, setCurrentExecution, persistCanvas, addActiveStream],
  );

  const clearError = useCallback(() => {
    useExecutionStore.getState().setLastError(null);
  }, []);

  return {
    executionId,
    isGenerating,
    progress,
    error,
    generate,
    saveCanvas: persistCanvas,
    clearError,
  };
}
