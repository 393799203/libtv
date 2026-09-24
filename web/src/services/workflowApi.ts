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

/** 执行粒度（与后端 handler 的 mode 字段对齐） */
export type ExecuteMode = '' | 'single' | 'downstream';

export const workflowApi = {
  // 执行工作流
  // options.startNodeId: 指定起点节点
  // options.mode:
  //   ''         → 全图执行（默认）
  //   'single'   → 只跑 startNode 一个节点（节点内"生成"按钮）
  //   'downstream'→ 跑 startNode + 所有下游 BFS 后代（"重新生成下游"按钮）
  execute: (projectId: string, options?: { startNodeId?: string; mode?: ExecuteMode }) =>
    api.post<ExecuteResponse>(`/projects/${projectId}/workflows/execute`, {
      startNodeId: options?.startNodeId,
      mode: options?.mode ?? '',
    }),

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
