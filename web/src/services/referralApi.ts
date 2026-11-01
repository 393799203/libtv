import api from './api';

export interface ReferralMetrics {
  invited_users: number;
  paying_users: number;
  paid_orders: number;
  amount_fen: number;
  paid_points: number;
  bonus_points: number;
  consumed_points: number;
  refunded_points: number;
  net_consumed_points: number;
}
export interface ReferralRow extends ReferralMetrics {
  id: string;
  nickname: string;
  email: string;
  referral_code: string;
  credits: number;
  created_at: string;
}
export interface ReferralDashboard {
  summary: ReferralMetrics & { platform_users: number; inviters: number };
  items: ReferralRow[];
  total: number;
  page: number;
  page_size: number;
}
export const referralApi = {
  mine: () => api.get<{ code: string; invited_users: number }>('/auth/referral'),
  myStats: () => api.get<MyReferralStats>('/auth/referral/stats'),
  dashboard: (page = 1, keyword = '') =>
    api.get<ReferralDashboard>('/admin/referrals', { params: { page, page_size: 20, keyword } }),
  invitees: (id: string, page = 1) =>
    api.get<ReferralDashboard>(`/admin/referrals/${encodeURIComponent(id)}/users`, { params: { page, page_size: 20 } }),
};
export interface MyReferralStats extends ReferralMetrics {
  last_7_days: number;
  last_30_days: number;
  days: { date: string; users: number }[];
}
