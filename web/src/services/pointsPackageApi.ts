import api from './api';

/** 积分套餐（积分超市卡片，运营后台「套餐管理」维护） */
export interface PointsPackage {
  id: number;
  /** 套餐名称，如「尝鲜包」 */
  name: string;
  /** 售价（元） */
  price: number;
  /** 积分数量 */
  points: number;
  /** 角标文案（空表示无角标） */
  badge: string;
  /** 是否推荐（卡片高亮展示） */
  recommended: boolean;
  /** 套餐特点，每行一条 */
  features: string;
  /** 排序，越小越靠前 */
  sort_order: number;
  /** 是否在积分超市展示 */
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

/** 新建 / 更新套餐的请求体 */
export interface PointsPackagePayload {
  name: string;
  price: number;
  points: number;
  badge?: string;
  recommended?: boolean;
  features?: string;
  sort_order?: number;
  enabled?: boolean;
}

export const pointsPackageApi = {
  /** 积分超市展示：启用中的套餐（无需登录） */
  list: () => api.get<{ items: PointsPackage[] }>('/points-packages'),

  /** 全部套餐（仅管理员） */
  listAll: () => api.get<{ items: PointsPackage[] }>('/admin/points-packages'),

  /** 新建套餐（仅管理员） */
  create: (payload: PointsPackagePayload) => api.post<PointsPackage>('/admin/points-packages', payload),

  /** 更新套餐（仅管理员） */
  update: (id: number, payload: PointsPackagePayload) => api.put<PointsPackage>(`/admin/points-packages/${id}`, payload),

  /** 删除套餐（仅管理员） */
  remove: (id: number) => api.delete(`/admin/points-packages/${id}`),
};
