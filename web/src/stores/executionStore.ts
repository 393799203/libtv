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

  // 活跃 SSE 订阅列表（支持多执行并行，每个 executionId 一个订阅）
  activeStreams: ActiveStream[];

  // Actions
  setCurrentExecution: (execution: WorkflowExecution | null) => void;
  setExecutionStatus: (status: WorkflowStatus) => void;
  updateNodeExecution: (nodeId: string, updates: Partial<NodeExecution>) => void;
  handleWSEvent: (event: WSEvent) => void;
  setGeneratingNodeId: (id: string | null) => void;
  setLastError: (msg: string | null) => void;
  setNodeError: (nodeId: string, msg: string | null) => void;
  resetExecution: () => void;
  addActiveStream: (stream: ActiveStream) => void;
  removeActiveStream: (executionId: string | number) => void;
}

export const useExecutionStore = create<ExecutionState>((set, get) => ({
  currentExecution: null,
  status: 'idle',
  isExecuting: false,
  generatingNodeId: null,
  lastError: null,
  nodeErrors: {},
  activeStreams: [],

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
        // ✅ 兼容多种字段位置：
        // - errorMsg在顶层（SSE直接返回）: event.errorMsg
        // - errorMsg在data里面（标准格式）: event.data?.errorMsg
        // - error在data里面（WorkflowEvent格式）: event.data?.error
        const errMsg =
          (event as { errorMsg?: string }).errorMsg ||  // ✅ SSE直接返回的errorMsg在顶层
          (event.data?.error as string) ||              // WorkflowEvent格式的error
          (event.data?.errorMsg as string) ||           // 标准格式的errorMsg在data里
          '工作流执行失败';
        setExecutionStatus('failed');
        set({ lastError: errMsg });

        // ✅ 更新currentExecution中所有正在运行/等待中的节点状态为failed（确保按钮状态正确恢复）
        const { currentExecution } = get();
        if (currentExecution?.nodes) {
          const updatedNodes = currentExecution.nodes.map((node) => {
            if (node.status === 'running' || node.status === 'pending') {
              return {
                ...node,
                status: 'failed' as const,
                error: errMsg,
              };
            }
            return node;
          });
          set({
            currentExecution: {
              ...currentExecution,
              nodes: updatedNodes,
              status: 'failed',
              error: errMsg,
            },
          });
        }

        // ✅ 不再此处显示错误提示，由 useExecutionStream.ts 统一处理错误显示，避免重复弹窗
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
      activeStreams: [],
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
  addActiveStream: (stream) =>
    set((s) => {
      // 同 executionId 不重复添加
      if (s.activeStreams.some((x) => x.executionId === stream.executionId)) {
        return s;
      }
      return { activeStreams: [...s.activeStreams, stream] };
    }),
  removeActiveStream: (executionId) =>
    set((s) => ({
      activeStreams: s.activeStreams.filter((x) => x.executionId !== executionId),
    })),
}));
