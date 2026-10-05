// 工作流执行状态
export type WorkflowStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed';

// 单个节点执行记录
export interface NodeExecution {
  nodeId: string;
  nodeType: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  progress: number;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  output?: Record<string, unknown>;
}

// 工作流执行记录
export interface WorkflowExecution {
  id: string;
  projectId: string;
  status: WorkflowStatus;
  nodes: NodeExecution[];
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

// WebSocket 事件类型
export type WSEventType =
  | 'execution_started'
  | 'node_started'
  | 'node_progress'
  | 'node_completed'
  | 'node_failed'
  | 'execution_completed'
  | 'execution_failed'
  // 余额变动（后端扣费/退费那一刻推过来）：不属于节点生命周期，但是画布右上角要立刻反应的
  | 'credits_changed';

// WebSocket 事件
export interface WSEvent {
  type: WSEventType;
  executionId: string;
  nodeId?: string;
  data?: Record<string, unknown>;
}
