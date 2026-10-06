import api from './api';

export interface UserItem {
  id: string;
  email: string;
  nickname: string;
  role: string; // 'admin' | 'user'
  /** AI 渠道：wasu=华数 / dianxin=电信 */
  channel?: string;
  created_at: string;
  /** 最后一次登录成功时间；为空=从未登录过（改版前的历史用户不回填） */
  /** 最后一次操作时间（带 token 调任意接口）；与"最后登录"不同，天天在用的用户也可能几天才登录一次 */
  last_active_at?: string | null;
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

  /** 获取所有用户列表（管理员，全量，供作者选择器等场景） */
  list: () =>
    api.get('/users').then((res: any) => res),

  /** 分页获取用户列表（管理员，管理员排前，同角色按注册时间倒序）；
   *  keyword 模糊匹配昵称/邮箱，role（user/admin）与 channel（wasu/dianxin）为可选筛选，空值表示不限 */
  listPaged: (page: number, pageSize: number, keyword?: string, role?: string, channel?: string) =>
    api.get('/users', {
      params: {
        page,
        page_size: pageSize,
        keyword: keyword || undefined,
        role: role || undefined,
        channel: channel || undefined,
      },
    }).then((res: any) => res),

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
