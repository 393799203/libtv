import { useCallback } from 'react';
import { useExecutionStore } from '@/stores/executionStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { workflowApi } from '@/services/workflowApi';

export function useWorkflow() {
  const projectId = useCanvasStore((s) => s.projectId);
  const setCurrentExecution = useExecutionStore((s) => s.setCurrentExecution);
  const handleWSEvent = useExecutionStore((s) => s.handleWSEvent);
  const resetExecution = useExecutionStore((s) => s.resetExecution);

  const execute = useCallback(async () => {
    if (!projectId) return;
    try {
      const execution = await workflowApi.execute(projectId);
      setCurrentExecution(execution as unknown as import('@/types/workflow').WorkflowExecution);
    } catch (error) {
      console.error('执行工作流失败:', error);
    }
  }, [projectId, setCurrentExecution]);

  const stop = useCallback(async () => {
    if (!projectId) return;
    const executionId = useExecutionStore.getState().currentExecution?.id;
    if (!executionId) return;
    try {
      await workflowApi.stop(projectId, executionId);
      resetExecution();
    } catch (error) {
      console.error('停止执行失败:', error);
    }
  }, [projectId, resetExecution]);

  return {
    execute,
    stop,
    handleWSEvent,
  };
}
