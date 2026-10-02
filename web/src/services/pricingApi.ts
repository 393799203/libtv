import api from './api';

// 计费类型：per_call=按次（积分/次），per_second=按秒（积分/秒）
export type BillingType = 'per_call' | 'per_second' | 'per_char';

// 单个模型的价格条目
export interface PriceModelItem {
  model_id: string;
  model_name: string;
  description?: string;
  resolution?: string; // 分辨率（视频节点：480p/720p/1080p/4k，其他节点为空）
  price: number; // 未配置时为 0
  /** 该模型是否支持「带参考视频输入」单独定价（models.yaml 的 ref_video_billing，目前仅 3 个 Seedance 模型） */
  ref_video_billing?: boolean;
  /** 带参考视频输入的单价（积分/秒，仅视频节点）：未单独配置时为「无参考视频单价 6 折」的预设值 */
  ref_video_price?: number;
  /** 是否已在后台单独配置「带参考视频」单价（false = 当前用 6 折预设兜底） */
  ref_video_price_configured?: boolean;
}

// 节点维度的价格分组（文本/剧本/图片按次，视频/语音按秒）
export interface NodePriceGroup {
  node_type: string;   // text / script / image / video / audio
  node_name: string;
  billing_type: BillingType;
  models: PriceModelItem[];
  /** 带参考视频输入的预设折扣（仅视频节点返回，0.6 = 6 折）：未配置时按无参考视频单价 × 该折扣计费 */
  ref_video_discount?: number;
}

// 价格管理列表响应
export interface PricingListResponse {
  nodes: NodePriceGroup[];
}

// 保存价格请求条目
export interface PriceSaveItem {
  node_type: string;
  model_id: string;
  resolution?: string; // 分辨率（视频节点必填，其他节点留空）
  price: number;
  /**
   * 带参考视频输入的单价（积分/秒，仅支持 ref_video_billing 的视频模型）。
   * 不传 = 不改动该档（保持 6 折预设或已配置的值）；传值则连同常规单价一起保存
   */
  ref_video_price?: number;
  /** 清除该档已单独配置的单价、回到 6 折预设（后台「恢复默认」按钮）；与 ref_video_price 同时传时以清除为准 */
  clear_ref_video_price?: boolean;
}

export const pricingApi = {
  /** 获取各节点下模型的价格配置；channel 指定渠道（wasu/dianxin），缺省 wasu */
  list(channel?: string): Promise<PricingListResponse> {
    return api.get<PricingListResponse>('/pricing', { params: channel ? { channel } : undefined });
  },

  /** 批量保存价格配置（仅管理员）；价格按渠道独立存储，channel 指定保存到哪个渠道 */
  save(channel: string, items: PriceSaveItem[]): Promise<void> {
    return api.put('/pricing', { channel, items });
  },
};
