export const recordCount = (value?: number) => Number(value || 0).toLocaleString('zh-CN');
export const recordMoney = (value?: number) => `¥${(Number(value || 0) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function recordTime(value?: string | null, full = false): string {
  if (!value || Number.isNaN(Date.parse(value))) return '—';
  return new Date(value).toLocaleString('zh-CN', {
    ...(full ? { year: 'numeric' as const } : {}),
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}
