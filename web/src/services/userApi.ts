import api from './api';

export interface UserItem {
  id: string;
  email: string;
  nickname: string;
  role: string; // 'admin' | 'user'
  created_at: string;
}

export const userApi = {
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
};
