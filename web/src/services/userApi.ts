import api from './api';

export interface UserItem {
  id: string;
  email: string;
  nickname: string;
  role: string; // 'admin' | 'user'
  created_at: string;
  /** 剩余积分（AI 调用扣费用） */
  credits?: number;
  /** 项目数（管理员列表接口返回） */
  project_count?: number;
  /** 图片资产数（管理员列表接口返回） */
  asset_image_count?: number;
  /** 视频资产数（管理员列表接口返回） */
  asset_video_count?: number;
}

export const userApi = {
  /** 更新当前用户个人资料（昵称/头像，字段可选，不传表示不修改） */
  updateProfile: (data: { nickname?: string; avatar_url?: string }) =>
    api.put<{ id: string; email: string; nickname: string; avatar_url: string; role: string }>('/auth/profile', data),

  /** 修改当前用户密码（需验证原密码） */
  changePassword: (oldPassword: string, newPassword: string) =>
    api.put('/auth/password', { old_password: oldPassword, new_password: newPassword }),

  /** 获取所有用户列表（管理员） */
  list: () =>
    api.get('/users').then((res: any) => res),

  /** 搜索用户 */
  search: (keyword: string) =>
    api.get(`/users?keyword=${encodeURIComponent(keyword)}`).then((res: any) => res),

  /** 更新用户角色（管理员） */
  updateRole: (id: number | string, role: 'user' | 'admin') =>
    api.put(`/users/${id}/role`, { role }),

  /** 删除用户（管理员） */
  delete: (id: number | string) =>
    api.delete(`/users/${id}`),

  /** 管理员为用户充值积分 */
  recharge: (id: number | string, data: { amount: number; remark?: string }) =>
    api.post(`/users/${id}/recharge`, data),
};
