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

  /** 保存资产到个人资产库（图片/视频 URL 引用） */
  create: (data: { type: UserAssetType; url: string; name?: string }) =>
    api.post<UserAsset>('/user-assets', data),

  /** 删除资产（仅限本人） */
  delete: (id: string) =>
    api.delete(`/user-assets/${id}`),
};
