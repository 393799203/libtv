import api from './api';

/** 支付渠道：alipay=支付宝（默认）/ wechat=微信支付 */
export type PayChannel = 'alipay' | 'wechat';
/** 终端形态：pc=电脑（微信走 Native 扫码）/ h5=手机（微信走 H5 支付） */
export type PayClient = 'pc' | 'h5';
/** 下单方式：page=支付宝电脑网站支付 / native=微信扫码 / h5=微信 H5 跳转 */
export type PayMode = 'page' | 'native' | 'h5';

/** 支付订单（积分超市充值：支付宝 / 微信支付共用同一张订单表） */
export interface PaymentOrderResult {
  order_no: string;
  /** 下单渠道（老接口不返回时按支付宝处理） */
  channel?: PayChannel;
  /** 下单方式 */
  pay_mode?: PayMode;
  /** 支付宝收银台地址 / 微信 H5 跳转地址 / 微信 Native 二维码内容 */
  pay_url: string;
  /** 微信 Native（PC 扫码）二维码内容：weixin://wxpay/bizpayurl?... */
  code_url?: string;
  /** 微信 H5 支付跳转地址 */
  h5_url?: string;
  /** 到账积分 */
  points: number;
  /** 支付金额（分） */
  amount_fen: number;
  /** pending / paid / closed */
  status: string;
  package_name?: string;
  /** 查单时返回的实际支付渠道（历史订单为空=支付宝） */
  pay_channel?: string;
}

/** 单个支付方式的能力（是否可用 + 不可用原因） */
export interface PaymentMethodInfo {
  available: boolean;
  name: string;
  reason: string;
}

/** 微信支付能力：H5 需商户平台单独申请开通，未开通时 h5_available=false，前端回落扫码 */
export interface WechatMethodInfo extends PaymentMethodInfo {
  native_available: boolean;
  h5_available: boolean;
  h5_reason: string;
}

/** 收银台支付方式能力清单（公开接口，不含敏感信息） */
export interface PaymentMethods {
  alipay: PaymentMethodInfo;
  wechat: WechatMethodInfo;
}

export const paymentApi = {
  /** 创建充值订单：支付宝返回收银台地址；微信 PC 返回 code_url、手机返回 h5_url */
  createOrder: (packageId: number, opts?: { channel?: PayChannel; client?: PayClient }) =>
    api.post('/payment/orders', { package_id: packageId, ...(opts || {}) }) as Promise<PaymentOrderResult>,

  /** 查询订单状态（支付后轮询；微信 pending 订单会顺带主动查一次微信兜底） */
  getOrder: (orderNo: string) => api.get(`/payment/orders/${orderNo}`) as Promise<PaymentOrderResult>,

  /** 支付方式能力清单（微信是否可用、H5 是否可用） */
  methods: () => api.get('/payment/methods') as Promise<PaymentMethods>,
};