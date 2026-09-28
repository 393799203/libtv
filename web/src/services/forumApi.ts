import api from './api';

/** 论坛帖子 */
export interface ForumPostItem {
  id: string;
  user_id: string;
  title: string;
  /** 富文本正文（HTML）。服务端已用 bluemonday 白名单清洗过，可安全渲染。 */
  content: string;
  view_count: number;
  reply_count: number;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
  /** 作者昵称/头像（后端补的展示字段） */
  nickname?: string;
  avatar_url?: string;
}

/** 论坛回复 */
export interface ForumReplyItem {
  id: string;
  post_id: string;
  user_id: string;
  /** 富文本回复（HTML，同样已清洗） */
  content: string;
  /** 回复某条回复时被回复人昵称；直接回复帖子时为空 */
  reply_to_nickname?: string;
  created_at: string;
  nickname?: string;
  avatar_url?: string;
}

export interface ForumPaged<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export const forumApi = {
  /** 帖子列表（公开，未登录可读） */
  listPosts: (params: { page?: number; page_size?: number; keyword?: string } = {}) =>
    api.get<ForumPaged<ForumPostItem>>('/forum/posts', { params }),

  /** 帖子详情（公开，浏览量 +1） */
  getPost: (id: string) => api.get<ForumPostItem>(`/forum/posts/${id}`),

  /** 帖子回复列表（公开） */
  listReplies: (id: string, params: { page?: number; page_size?: number } = {}) =>
    api.get<ForumPaged<ForumReplyItem>>(`/forum/posts/${id}/replies`, { params }),

  /** 发帖（需登录） */
  createPost: (data: { title: string; content: string }) =>
    api.post<ForumPostItem>('/forum/posts', data),

  /** 回复帖子（需登录） */
  createReply: (id: string, data: { content: string; reply_to_nickname?: string }) =>
    api.post<ForumReplyItem>(`/forum/posts/${id}/replies`, data),

  /** 删帖（本人或管理员） */
  deletePost: (id: string) => api.delete(`/forum/posts/${id}`),

  /** 删回复（本人或管理员） */
  deleteReply: (id: string) => api.delete(`/forum/replies/${id}`),

  /** 置顶/取消置顶（仅管理员） */
  setPinned: (id: string, pinned: boolean) =>
    api.put(`/forum/posts/${id}/pin`, { pinned }),
};