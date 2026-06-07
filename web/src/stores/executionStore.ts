import { create } from 'zustand';
import type { WorkflowExecution, NodeExecution, WSEvent, WorkflowStatus } from '@/types/workflow';

interface ExecutionState {
  // 当前执行
  currentExecution: WorkflowExecution | null;
  status: WorkflowStatus;
  isExecuting: boolean;

  // Actions
  setCurrentExecution: (execution: WorkflowExecution | null) => void;
  setExecutionStatus: (status: WorkflowStatus) => void;
  updateNodeExecution: (nodeId: string, updates: Partial<NodeExecution>) => void;
  handleWSEvent: (event: WSEvent) => void;
  resetExecution: () => void;
}

export const useExecutionStore = create<ExecutionState>((set, get) => ({
  currentExecution: null,
  status: 'idle',
  isExecuting: false,

  setCurrentExecution: (execution) =>
    set({
      currentExecution: execution,
      status: execution?.status ?? 'idle',
      isExecuting: execution?.status === 'running',
    }),

  setExecutionStatus: (status) => set({ status, isExecuting: status === 'running' }),

  updateNodeExecution: (nodeId, updates) => {
    const { currentExecution } = get();
    if (!currentExecution) return;

    set({
      currentExecution: {
        ...currentExecution,
        nodes: currentExecution.nodes.map((n) =>
          n.nodeId === nodeId ? { ...n, ...updates } : n
        ),
      },
    });
  },

  handleWSEvent: (event: WSEvent) => {
    const { updateNodeExecution, setExecutionStatus } = get();

    switch (event.type) {
      case 'execution_started':
        setExecutionStatus('running');
        break;
      case 'node_started':
        updateNodeExecution(event.nodeId!, { status: 'running', progress: 0 });
        break;
      case 'node_progress':
        updateNodeExecution(event.nodeId!, {
          status: 'running',
          progress: (event.data?.progress as number) ?? 0,
        });
        break;
      case 'node_completed':
        updateNodeExecution(event.nodeId!, {
          status: 'success',
          progress: 100,
          output: event.data?.output as Record<string, unknown>,
        });
        break;
      case 'node_failed':
        updateNodeExecution(event.nodeId!, {
          status: 'failed',
          error: event.data?.error as string,
        });
        break;
      case 'execution_completed':
        setExecutionStatus('completed');
        break;
      case 'execution_failed':
        setExecutionStatus('failed');
        break;
    }
  },

  resetExecution: () =>
    set({
      currentExecution: null,
      status: 'idle',
      isExecuting: false,
    }),
}));
