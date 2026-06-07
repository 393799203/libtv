import api from './api';
import type { WorkflowExecution } from '@/types/workflow';
import type { ApiResponse } from '@/types/api';

export const workflowApi = {
  // 执行工作流
  execute: (projectId: string) =>
    api.post<ApiResponse<WorkflowExecution>>(`/projects/${projectId}/workflows/execute`),

  // 停止执行
  stop: (projectId: string, executionId: string) =>
    api.post<ApiResponse<void>>(`/projects/${projectId}/workflows/${executionId}/stop`),

  // 获取执行状态
  getStatus: (projectId: string, executionId: string) =>
    api.get<ApiResponse<WorkflowExecution>>(`/projects/${projectId}/workflows/${executionId}`),
};
