import api from './api';

export interface BannerItem {
  id: string;
  title: string;
  image_url: string;
  link_url: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const bannerApi = {
  /** 获取资源位列表 */
  list: () =>
    api.get<BannerItem[]>('/banners'),

  /** 获取单个资源位 */
  get: (id: string) =>
    api.get<BannerItem>(`/banners/${id}`),

  /** 创建资源位 */
  create: (data: { title: string; image_url: string; link_url?: string; sort_order?: number; is_active?: boolean }) =>
    api.post<BannerItem>('/banners', data),

  /** 更新资源位 */
  update: (id: string, data: { title?: string; image_url?: string; link_url?: string; sort_order?: number; is_active?: boolean }) =>
    api.put<BannerItem>(`/banners/${id}`, data),

  /** 删除资源位 */
  delete: (id: string) =>
    api.delete(`/banners/${id}`),
};