import api from './api';
import type { WorkflowExecution } from '@/types/workflow';
import type { ApiResponse } from '@/types/api';

export interface ExecuteResponse {
  executionId: number;
}

export const workflowApi = {
  // 执行工作流
  // options.startNodeId：只跑该节点 + 上游依赖（不传就跑全画布）
  execute: (projectId: string, options?: { startNodeId?: string }) =>
    api.post<ExecuteResponse>(`/projects/${projectId}/workflows/execute`, {
      startNodeId: options?.startNodeId,
    }),

  // 停止执行
  stop: (projectId: string, executionId: string) =>
    api.post<ApiResponse<void>>(`/projects/${projectId}/workflows/${executionId}/stop`),

  // 获取执行状态
  getStatus: (projectId: string, executionId: string) =>
    api.get<ApiResponse<WorkflowExecution>>(`/projects/${projectId}/workflows/${executionId}`),
};
