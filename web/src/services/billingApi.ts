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
  /**
   * 调用的模型 ID（非模型调用时为空）—— **纯模型 ID**，不含渠道前缀。
   * 历史账单里渠道曾被拼进这个字段（wasu-cdance2.5-0807），后端读取时会拆开，
   * 所以这个字段永远是纯模型 ID，渠道看下面的 channel。
   */
  model: string;
  /**
   * 实际调用的渠道（wasu=华数 / dianxin=电信），界面用标签展示。
   * 更早的历史账单没有记录渠道（返回空串）→ 不显示标签，不猜。
   */
  channel?: string;
  /** 扣费场景（如 图片生成 / 视频生成 / 提示词生成） */
  scene: string;
  /**
   * 视频节点的分辨率（480p / 720p / 1080p / 4k），非视频节点为空字符串。
   * 视频按「分辨率档位」定价，明细里要能看出这笔是按哪一档算的。
   * 注意：本次改动之前产生的历史账单没有这一项（返回空），页面显示为「-」。
   */
  resolution?: string;
  /**
   * 视频节点的**计费时长**（秒），非视频节点、按次计费为 0；历史账单同样为 0。
   * 带参考视频输入时，计费时长 = 输出视频时长 + 参考视频时长（见 ref_video_duration）
   */
  duration?: number;
  /**
   * 计费时长中「参考视频（输入视频）」那一部分（秒）：duration - ref_video_duration 即输出视频时长。
   * 无参考视频输入、非视频节点与历史账单为 0。扣费与退费记录口径一致（退费记录也带这两项）
   */
  ref_video_duration?: number;
  /** 描述文案 */
  remark: string;
  /**
   * 充值的商户订单号（payment_orders.order_no / 支付宝 out_trade_no）。
   * 仅支付宝充值有；后台手工充值为空字符串。对账时靠它和支付宝流水对上。
   */
  order_no?: string;
  /** 支付宝交易号（trade_no）：仅支付宝充值有，退款/对账的唯一凭据 */
  alipay_trade_no?: string;
  /** 本次变动后的剩余积分 */
  balance_after: number;
  created_at: string;
}

/** 费用明细查询参数 */
export interface BillingListParams {
  page?: number;
  page_size?: number;
  user_id?: string; // 管理员查看其他用户的账单
  type?: BillingType | '';
  scene?: string;
  model?: string;
  start_time?: string; // YYYY-MM-DD
  end_time?: string; // YYYY-MM-DD
}

/** 费用明细分页响应 */
export interface BillingListResponse {
  items: BillingRecord[];
  total: number;
  page: number;
  page_size: number;
}

export const billingApi = {
  /** 当前用户的费用明细（分页 + 筛选，按时间倒序） */
  list: (params?: BillingListParams) =>
    api.get<BillingListResponse>('/billing/records', { params }),
};
