import api from './api';
import type { WorkflowExecution } from '@/types/workflow';
import type { ApiResponse } from '@/types/api';

export interface ExecuteResponse {
  executionId: number;
}

/** 项目进行中的执行（重进项目时恢复"生成中"状态用） */
export interface ActiveExecutionItem {
  executionId: number;
  status: string;
  startedAt?: string;
  /** 本次执行涉及的节点 ID（后端 plan 裁剪后的真实执行集合） */
  nodeIds: string[];
}

export const workflowApi = {
  /**
   * 执行单个节点。
   *
   * startNodeId 必填：后端只支持单节点执行 —— 全图执行与"重新生成下游"已下线
   * （产品里没有入口，API 留着只会被误用：一次不带 startNodeId 的请求会把画布上
   * 所有节点都生成一遍并逐个扣费）。留空后端会直接 400。
   */
  execute: (projectId: string, startNodeId: string) =>
    api.post<ExecuteResponse>(`/projects/${projectId}/workflows/execute`, { startNodeId }),

  // 停止执行
  stop: (projectId: string, executionId: string) =>
    api.post<ApiResponse<void>>(`/projects/${projectId}/workflows/${executionId}/stop`),

  // 查询项目进行中的执行（pending/running）。
  // 页面刷新/关闭会丢掉内存里的 executionId，导致无法重连 SSE；
  // 进项目时调这个接口即可恢复"生成中"显示，避免用户误以为没在生成而重复点击。
  getActive: (projectId: string) =>
    api.get<ApiResponse<{ executions: ActiveExecutionItem[] }>>(
      `/projects/${projectId}/active-executions`,
    ),

  // 获取执行状态（可传入 nodeId 获取该节点最新数据）
  getStatus: (projectId: string, executionId: string, nodeId?: string) => {
    const url = nodeId
      ? `/projects/${projectId}/workflows/${executionId}?nodeId=${nodeId}`
      : `/projects/${projectId}/workflows/${executionId}`;
    return api.get<ApiResponse<WorkflowExecution>>(url);
  },
};
