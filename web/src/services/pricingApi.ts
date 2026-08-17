import api from './api';

// 计费类型：per_call=按次（积分/次），per_second=按秒（积分/秒）
export type BillingType = 'per_call' | 'per_second';

// 单个模型的价格条目
export interface PriceModelItem {
  model_id: string;
  model_name: string;
  description?: string;
  price: number; // 未配置时为 0
}

// 节点维度的价格分组（文本/剧本/图片按次，视频/语音按秒）
export interface NodePriceGroup {
  node_type: string;   // text / script / image / video / audio
  node_name: string;
  billing_type: BillingType;
  models: PriceModelItem[];
}

// 价格管理列表响应
export interface PricingListResponse {
  nodes: NodePriceGroup[];
}

// 保存价格请求条目
export interface PriceSaveItem {
  node_type: string;
  model_id: string;
  price: number;
}

export const pricingApi = {
  /** 获取各节点下模型的价格配置 */
  list(): Promise<PricingListResponse> {
    return api.get<PricingListResponse>('/pricing');
  },

  /** 批量保存价格配置（仅管理员） */
  save(items: PriceSaveItem[]): Promise<void> {
    return api.put('/pricing', { items });
  },
};
