import api from './api';

export interface BannerItem {
  id: string;
  title: string;
  description?: string;
  image_url: string;
  link_url?: string;
  sort_order: number;
  is_active: boolean;
  start_time?: string;
  end_time?: string;
  created_at: string;
  updated_at: string;
}

export const bannerApi = {
  /** 获取所有Banner列表 */
  list: (params?: { is_active?: boolean }) => {
    const query = new URLSearchParams();
    if (params?.is_active !== undefined) {
      query.append('is_active', String(params.is_active));
    }
    const queryString = query.toString();
    return api.get<BannerItem[]>(`/banners${queryString ? `?${queryString}` : ''}`);
  },

  /** 获取单个Banner详情 */
  get: (id: string) =>
    api.get<BannerItem>(`/banners/${id}`),

  /** 上传Banner图片 */
  uploadImage: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post<{ url: string }>('/banners/images', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  /** 创建Banner */
  create: (data: {
    title: string;
    description?: string;
    image_url?: string;
    link_url?: string;
    sort_order?: number;
    is_active?: boolean;
    start_time?: string;
    end_time?: string;
  }) =>
    api.post<BannerItem>('/banners', data),

  /** 更新Banner信息 */
  update: (id: string, data: {
    title?: string;
    description?: string;
    image_url?: string;
    link_url?: string;
    sort_order?: number;
    is_active?: boolean;
    start_time?: string;
    end_time?: string;
  }) =>
    api.put<BannerItem>(`/banners/${id}`, data),

  /** 删除Banner */
  delete: (id: string) =>
    api.delete(`/banners/${id}`),
};