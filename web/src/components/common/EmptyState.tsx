import type { ReactNode } from 'react';

/**
 * 统一的空状态组件（视觉第二梯队第 8 项）
 *
 * 为什么要有这个组件：此前各页面/弹窗都用 antd 默认的 <Empty>，它带一张浅色灰调插画，
 * 在暗色主题里是"一块白"；而且文案格式各处不一（有的只有一句、有的加了操作提示）。
 * 统一成「圆角底衬图标 + 主文案 + 可选副文案 + 可选操作」四件套：
 *   - 图标放进冷色面底衬里，和全站面板同一套语言，不再依赖插画；
 *   - size="sm" 供面板/弹窗内的紧凑场景使用（默认 ml 用于整页）。
 */
export function EmptyState({
  icon,
  title,
  hint,
  action,
  size = 'md',
  className = '',
}: {
  icon: ReactNode;
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const sm = size === 'sm';
  return (
    <div className={`flex flex-col items-center justify-center text-center ${sm ? 'gap-2 py-6' : 'gap-3 py-10'} ${className}`}>
      <div
        className={`flex items-center justify-center rounded-2xl bg-[var(--dv-surface-2)] text-[var(--dv-text-3)] ring-1 ring-white/5 ${
          sm ? 'h-10 w-10' : 'h-14 w-14'
        }`}
      >
        <span className={sm ? 'text-[16px]' : 'text-[22px]'}>{icon}</span>
      </div>
      <div className={`${sm ? 'text-[12px]' : 'text-[14px]'} text-[var(--dv-text-2)]`}>{title}</div>
      {hint && <div className="max-w-[320px] text-[12px] leading-relaxed text-[var(--dv-text-3)]">{hint}</div>}
      {action}
    </div>
  );
}
