import api from './api';

export interface StyleItem {
  id: string;
  name: string;
  author: string;
  image_url: string;
  likes: number;
  category: string;
  tags: string[];
}

export interface CategoryItem {
  category: string;
  count: number;
}

export const styleApi = {
  /** 获取风格列表（公开） */
  list: (params?: { category?: string; keyword?: string; page?: number; page_size?: number }) =>
    api.get<{ items: StyleItem[]; total: number; page: number; page_size: number }>('/styles', { params }),

  /** 获取所有分类（公开） */
  categories: () =>
    api.get<CategoryItem[]>('/styles/categories'),

  /** 创建风格（需登录） */
  create: (data: { name: string; author?: string; category?: string; tags?: string[] }) =>
    api.post<StyleItem>('/styles', data),

  /** 上传风格图片（需登录） */
  uploadImage: (styleId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post<{ url: string }>(`/styles/${styleId}/image`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  /** 更新风格信息（需登录） */
  update: (id: string, data: { name?: string; author?: string; category?: string; tags?: string[] }) =>
    api.put<StyleItem>(`/styles/${id}`, data),

  /** 删除风格（需登录） */
  delete: (id: string) =>
    api.delete(`/styles/${id}`),

  /** 切换收藏（需登录） */
  toggleFavorite: (styleId: string) =>
    api.post<{ favorited: boolean }>(`/styles/${styleId}/favorite`),

  /** 获取我的收藏列表（需登录） */
  listFavorites: () =>
    api.get<{ items: StyleItem[]; total: number; page: number }>('/styles/favorites'),

  /** 批量检查收藏状态（需登录） */
  checkFavorited: (ids: string[]) =>
    api.post<Record<string, boolean>>('/styles/favorites/check', ids),
};
