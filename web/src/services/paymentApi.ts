import api from './api';

/** 支付订单（积分超市支付宝充值） */
export interface PaymentOrderResult {
  order_no: string;
  /** 支付宝收银台支付 URL（新窗口打开） */
  pay_url: string;
  /** 到账积分 */
  points: number;
  /** 支付金额（分） */
  amount_fen: number;
  /** pending / paid / closed */
  status: string;
  package_name?: string;
}

export const paymentApi = {
  /** 创建充值订单，返回支付宝收银台地址 */
  createOrder: (packageId: number) => api.post('/payment/orders', { package_id: packageId }) as Promise<PaymentOrderResult>,
  /** 查询订单状态（支付后轮询） */
  getOrder: (orderNo: string) => api.get(`/payment/orders/${orderNo}`) as Promise<PaymentOrderResult>,
};