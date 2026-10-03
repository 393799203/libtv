import api from './api';

/** 上游任务的一次下发记录（后台「对账」页） */
export interface ProviderTask {
  id: number;
  /** 上游任务号（跟渠道对账的唯一凭据） */
  task_id: string;
  /** 渠道：wasu=华数 / dianxin=电信 */
  provider: string;
  model: string;
  exec_id: number;
  node_id: string;
  user_id: string;
  project_id: string;
  /**
   * submitted 进行中 / delivered 已交付 /
   * pending_review 待人工退费（上游没明确拒绝，不自动退）/ refunding 退费中 /
   * refunded 已退费 / failed 旧值（保留兼容）
   */
  status: 'submitted' | 'delivered' | 'pending_review' | 'refunding' | 'refunded' | 'failed';
  /** 下发该任务时扣掉的积分 */
  charged_amount: number;
  /** 已退还给用户的积分 */
  refunded_amount: number;
  /** 当初扣费的计费口径（分辨率 / 计费总时长 / 其中参考视频时长） */
  charge_resolution: string;
  charge_seconds: number;
  charge_ref_seconds: number;
  /** 项目名（查询时补齐，改名后不会回写这条历史记录） */
  project_name?: string;
  /** 用户昵称（可能为空）与邮箱 */
  user_name?: string;
  user_email?: string;
  /** 项目名（实时查询；项目已删除时为空） */
  /** 项目名快照（写入对账行时记下的名字）：项目被删掉后仍能认出是哪个项目 */
  project_name_snapshot?: string;
  /** 一致性自检发现的异常代码（空=正常）：no_result / no_history / stuck / refund_delivered / amount_mismatch / no_user / orphan_exec */
  alert?: string;
  /** 被标记为异常的时间（异常排除后清空） */
  alert_at?: string | null;
  /** 真·上游任务号（同步调用没有，后端留空） */
  upstream_task_id?: string;
  /** 任务类型（取值同计费动作：ai.video / ai.image / ai.story …） */
  task_kind?: string;
  /** 退费来源：auto=上游明确拒绝后自动退（上游不计费）/ manual=人工退（可能已计费） */
  refund_source?: 'auto' | 'manual' | '';
  /** 交付给用户的产物地址（我们自己的存储/CDN），未交付为空 */
  result_url?: string;
  /** 上游返回的原始产物地址（转存失败时仍然有效，可人工捞回） */
  provider_url?: string;
  /** 失败原因或处理说明 */
  note: string;
  created_at: string;
  updated_at: string;
}

/** 当前筛选条件下的汇总 */
export interface ProviderTaskStats {
  total: number;
  delivered: number;
  failed: number;
  refunded: number;
  auto_refunded: number;
  manual_refunded: number;
  submitted: number;
  pending_review: number;
  charged_credits: number;
  refunded_credits: number;
  /** 一致性自检标记出来的异常行数 */
  alerted?: number;
}

export interface ProviderTaskQuery {
  /** 任务类型筛选（ai.video / ai.image / …） */
  task_kind?: string;
  status?: string;
  project_id?: string;
  user_id?: string;
  task_id?: string;
  /** 只看一致性自检标记出来的异常行 */
  only_alert?: string;
  page?: number;
  page_size?: number;
}

export interface ProviderTaskListResult {
  items: ProviderTask[];
  total: number;
  stats: ProviderTaskStats;
}

/** 上游任务对账（仅管理员） */
export const providerTaskApi = {
  list: (query: ProviderTaskQuery = {}) =>
    api.get<ProviderTaskListResult>('/admin/provider-tasks', { params: query }),

  /**
   * 手动退费：退款规则是「只有上游明确拒绝才自动退，其余（超时/没拿到结果/转存失败）
   * 一律不自动退」，所以这些记录要靠管理员在这里判断后退。
   */
  refund: (id: number, reason?: string) =>
    api.post<{ task: ProviderTask }>(`/admin/provider-tasks/${id}/refund`, { reason }),

  /**
   * 立即跑一次一致性自检（只读+标记，不动钱）。
   * 返回本次结果：新标记 / 恢复 / 无主问题清单。
   */
  runAudit: () => api.post<AuditReport>('/admin/provider-tasks/audit'),
};

export interface AuditFinding {
  row_id: number;
  alert: string;
  reason: string;
}

export interface AuditReport {
  started_at: string;
  duration: string;
  marked: number;
  cleared: number;
  findings: AuditFinding[] | null;
  /** 没有对应行、只能靠日志提示的问题（如「有扣费流水但找不到对账行」） */
  orphans: string[] | null;
}
