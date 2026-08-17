import api from './api';

/** 账单类型：deduct 扣费 / refund 退款 / recharge 充值 */
export type BillingType = 'deduct' | 'refund' | 'recharge';

export interface BillingRecord {
  id: number;
  user_id: string;
  type: BillingType;
  /** 变动积分数（正数，方向由 type 决定） */
  amount: number;
  /** 计费动作（充值时为空） */
  action: string;
  /** 调用的模型 ID（非模型调用时为空） */
  model: string;
  /** 扣费场景（如 图片生成 / 视频生成 / 提示词生成） */
  scene: string;
  /** 描述文案 */
  remark: string;
  /** 本次变动后的剩余积分 */
  balance_after: number;
  created_at: string;
}

export const billingApi = {
  /** 当前用户的费用明细（按时间倒序） */
  list: () => api.get<BillingRecord[]>('/billing/records'),
};
