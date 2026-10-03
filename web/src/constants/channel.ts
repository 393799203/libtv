/**
 * AI 渠道的展示口径（华数 / 电信）。
 *
 * 后端账单与价格配置里渠道是独立字段（wasu / dianxin）；界面上统一用这个映射转成中文，
 * 避免各处自己写一份、各写各的（曾经渠道是拼在模型名里的「wasu-cdance2.5-0807」，
 * 全靠字符串前缀猜，现在渠道是独立字段，模型名只放纯模型 ID）。
 */
export const CHANNEL_LABEL: Record<string, string> = {
  wasu: '华数',
  dianxin: '电信',
};

/** 渠道标签配色：华数=蓝、电信=橙，与渠道管理页的策略描述保持一致 */
export const CHANNEL_TAG_COLOR: Record<string, string> = {
  wasu: 'blue',
  dianxin: 'orange',
};

/** 渠道中文名；未知/为空渠道返回空串（调用方决定是否显示标签） */
export function channelLabel(channel?: string): string {
  if (!channel) return '';
  return CHANNEL_LABEL[channel] ?? channel;
}

/** 渠道标签颜色；未知渠道退回默认灰（不给错误颜色，避免误解成某种状态） */
export function channelTagColor(channel?: string): string {
  if (!channel) return 'default';
  return CHANNEL_TAG_COLOR[channel] ?? 'default';
}