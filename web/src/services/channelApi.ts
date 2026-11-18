import api from './api';

/** 唯一启用的 AI 渠道。历史账单仍保留原渠道。 */
export type ChannelName = 'dianxin';

/** 兼容旧接口，策略固定为电信。 */
export type ChannelPolicy = 'all_dianxin';

export const channelApi = {
  /** 查询当前全局渠道策略（后台管理） */
  getPolicy: () =>
    api.get<{ policy: ChannelPolicy }>('/channel/policy'),

  /** 切换全局渠道策略（管理员）：全A / 全B / 按各自渠道 */
  setPolicy: (policy: ChannelPolicy) =>
    api.put('/channel/policy', { policy }),

  /** 查询当前登录用户的渠道 */
  getMyChannel: () =>
    api.get<{ channel: ChannelName }>('/channel/my'),

  /** 管理员修改指定用户的渠道 */
  updateUserChannel: (id: string, channel: ChannelName) =>
    api.put(`/users/${id}/channel`, { channel }),
};
