import api from './api';

// 评论条目（后端 snake_case 原样返回）
export interface CommentItem {
  id: string;
  show_id: string;
  user_id: string;
  content: string;
  /** 空=顶级评论；非空=回复，指向顶级评论 ID */
  parent_id: string;
  /** 回复某条回复时的被回复人昵称（「回复 @xxx」展示用） */
  reply_to_nickname: string;
  /** 顶级评论的回复数 */
  reply_count: number;
  nickname: string;
  avatar_url: string;
  created_at: string;
}

export interface CommentListResult {
  items: CommentItem[];
  total: number;
  page: number;
  page_size: number;
}

export const commentApi = {
  /** 分页列出视频顶级评论（公开） */
  list: (showId: string, page = 1, pageSize = 20) =>
    api.get(`/shows/${showId}/comments`, { params: { page, page_size: pageSize } }) as Promise<CommentListResult>,

  /** 分页列出某顶级评论的回复（公开） */
  listReplies: (commentId: string, page = 1, pageSize = 50) =>
    api.get(`/shows/comments/${commentId}/replies`, { params: { page, page_size: pageSize } }) as Promise<CommentListResult>,

  /** 发表评论或回复（需登录，parentId 为被回复评论 ID） */
  create: (showId: string, content: string, parentId?: string) =>
    api.post(`/shows/${showId}/comments`, { content, parent_id: parentId || undefined }) as Promise<CommentItem>,

  /** 删除评论（本人或管理员；删顶级评论会连带删其回复） */
  remove: (commentId: string) =>
    api.delete(`/shows/comments/${commentId}`),
};
