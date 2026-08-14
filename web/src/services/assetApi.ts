import api from './api';

export type UserAssetType = 'image' | 'video';

export interface UserAsset {
  id: string;
  user_id: string;
  type: UserAssetType;
  url: string;
  name: string;
  created_at: string;
}

export const assetApi = {
  /** 列出当前用户的个人资产（按类型过滤） */
  list: (type: UserAssetType) =>
    api.get<UserAsset[]>(`/user-assets?type=${type}`),

  /** 保存资产到个人资产库（图片/视频 URL 引用）；silentError 时拦截器不弹错误提示，由调用方处理 */
  create: (data: { type: UserAssetType; url: string; name?: string }, config?: { silentError?: boolean }) =>
    api.post<UserAsset>('/user-assets', data, config),

  /** 删除资产（仅限本人） */
  delete: (id: string) =>
    api.delete(`/user-assets/${id}`),
};
