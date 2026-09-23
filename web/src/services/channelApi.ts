import api from './api';

/** AI 渠道名：wasu=华数 / dianxin=电信 */
export type ChannelName = 'wasu' | 'dianxin';

/** 全局渠道策略：all_wasu=全华数 / all_dianxin=全电信 / per_user=按各自渠道 */
export type ChannelPolicy = 'all_wasu' | 'all_dianxin' | 'per_user';

export const channelApi = {
  /** 查询当前全局渠道策略（后台管理） */
  getPolicy: () =>
    api.get<{ policy: ChannelPolicy }>('/channel/policy').then((res: any) => res),

  /** 切换全局渠道策略（管理员）：全A / 全B / 按各自渠道 */
  setPolicy: (policy: ChannelPolicy) =>
    api.put('/channel/policy', { policy }),

  /** 查询当前登录用户的渠道 */
  getMyChannel: () =>
    api.get<{ channel: ChannelName }>('/channel/my').then((res: any) => res),

  /** 管理员修改指定用户的渠道 */
  updateUserChannel: (id: string, channel: ChannelName) =>
    api.put(`/users/${id}/channel`, { channel }),
};