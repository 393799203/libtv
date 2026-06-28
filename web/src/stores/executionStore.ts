import { create } from 'zustand';
import type { WorkflowExecution, NodeExecution, WSEvent, WorkflowStatus } from '@/types/workflow';

// 活跃 SSE 订阅信息（与组件生命周期解耦，避免节点失焦导致 SSE 被关闭）
export interface ActiveStream {
  projectId: string;
  executionId: string | number;
  nodeId?: string;
}

interface ExecutionState {
  // 当前执行
  currentExecution: WorkflowExecution | null;
  status: WorkflowStatus;
  isExecuting: boolean;

  // 正在生成的节点 id（用于节点内部骨架屏）
  generatingNodeId: string | null;

  // 当前执行级别的错误信息（来自 execution_failed 或 SSE 异常）
  lastError: string | null;
  // 节点级错误映射：nodeId -> 错误信息
  nodeErrors: Record<string, string>;

  // 活跃 SSE 订阅（WorkspacePage 顶层读取，订阅 /stream）
  activeStream: ActiveStream | null;

  // Actions
  setCurrentExecution: (execution: WorkflowExecution | null) => void;
  setExecutionStatus: (status: WorkflowStatus) => void;
  updateNodeExecution: (nodeId: string, updates: Partial<NodeExecution>) => void;
  handleWSEvent: (event: WSEvent) => void;
  setGeneratingNodeId: (id: string | null) => void;
  setLastError: (msg: string | null) => void;
  setNodeError: (nodeId: string, msg: string | null) => void;
  resetExecution: () => void;
  setActiveStream: (stream: ActiveStream | null) => void;
}

export const useExecutionStore = create<ExecutionState>((set, get) => ({
  currentExecution: null,
  status: 'idle',
  isExecuting: false,
  generatingNodeId: null,
  lastError: null,
  nodeErrors: {},
  activeStream: null,

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
        set({ lastError: null });
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
        // 清掉该节点的错误
        set((s) => {
          if (!s.nodeErrors[event.nodeId!]) return s;
          const next = { ...s.nodeErrors };
          delete next[event.nodeId!];
          return { nodeErrors: next };
        });
        break;
      case 'node_failed': {
        const errMsg = (event.data?.error as string) || '节点执行失败';
        updateNodeExecution(event.nodeId!, {
          status: 'failed',
          error: errMsg,
        });
        set((s) => ({ nodeErrors: { ...s.nodeErrors, [event.nodeId!]: errMsg } }));
        break;
      }
      case 'execution_completed':
        setExecutionStatus('completed');
        set({ lastError: null });
        break;
      case 'execution_failed': {
        const errMsg = (event.data?.error as string) || '工作流执行失败';
        setExecutionStatus('failed');
        set({ lastError: errMsg });
        break;
      }
    }
  },

  resetExecution: () =>
    set({
      currentExecution: null,
      status: 'idle',
      isExecuting: false,
      generatingNodeId: null,
      lastError: null,
      nodeErrors: {},
      activeStream: null,
    }),

  setGeneratingNodeId: (id) => set({ generatingNodeId: id }),
  setLastError: (msg) => set({ lastError: msg }),
  setNodeError: (nodeId, msg) =>
    set((s) => {
      const next = { ...s.nodeErrors };
      if (msg) next[nodeId] = msg;
      else delete next[nodeId];
      return { nodeErrors: next };
    }),
  setActiveStream: (stream) => set({ activeStream: stream }),
}));
