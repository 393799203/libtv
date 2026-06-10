import api from './api';

export interface ShowItem {
  id: string;
  category_id: string;
  title: string;
  description: string;
  thumbnail_url: string;
  video_url: string;
  duration: number;
  author: string;
  author_avatar: string;
  tags: string[];
  sort_order: number;
  views: number;
  likes: number;
  category?: {
    id: string;
    name: string;
    sort_order: number;
  };
  created_at: string;
  updated_at: string;
}

export interface ShowCategoryItem {
  id: string;
  name: string;
  sort_order: number;
  show_count: number;
  created_at: string;
  updated_at: string;
}

export const showApi = {
  // ========== 公开接口 ==========

  /** 获取所有分类（公开） */
  categories: () =>
    api.get<ShowCategoryItem[]>('/shows/categories'),

  /** 获取视频列表（公开，支持按分类筛选） */
  list: (params?: { category_id?: string; page?: number; page_size?: number }) =>
    api.get<{ items: ShowItem[]; total: number; page: number; page_size: number }>('/shows', { params }),

  /** 获取视频详情（公开） */
  get: (id: string) =>
    api.get<ShowItem>(`/shows/${id}`),

  // ========== 需登录接口 ==========

  /** 创建分类（需登录） */
  createCategory: (data: { name: string; sort_order?: number }) =>
    api.post<ShowCategoryItem>('/shows/categories', data),

  /** 更新分类（需登录） */
  updateCategory: (id: string, data: { name?: string; sort_order?: number }) =>
    api.put<ShowCategoryItem>(`/shows/categories/${id}`, data),

  /** 删除分类（需登录） */
  deleteCategory: (id: string) =>
    api.delete(`/shows/categories/${id}`),

  /** 创建视频（需登录） */
  create: (data: {
    category_id: string;
    title: string;
    description?: string;
    video_url: string;
    duration?: number;
    author?: string;
    author_avatar?: string;
    tags?: string[];
    sort_order?: number;
  }) =>
    api.post<ShowItem>('/shows', data),

  /** 上传封面图（需登录） */
  uploadThumbnail: (showId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post<{ url: string }>(`/shows/${showId}/thumbnail`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  /** 上传视频文件（需登录） */
  uploadVideo: (showId: string, file: File, onProgress?: (percent: number) => void) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post<{ url: string }>(`/shows/${showId}/video`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (e.total && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      },
    });
  },

  /** 更新视频信息（需登录） */
  update: (id: string, data: {
    title?: string;
    description?: string;
    video_url?: string;
    duration?: number;
    author?: string;
    author_avatar?: string;
    tags?: string[];
    sort_order?: number;
    category_id?: string;
  }) =>
    api.put<ShowItem>(`/shows/${id}`, data),

  /** 删除视频（需登录） */
  delete: (id: string) =>
    api.delete(`/shows/${id}`),
};
