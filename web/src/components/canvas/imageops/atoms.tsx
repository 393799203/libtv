import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ConfigProvider, Select, theme } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import { OPS } from './tokens';

/**
 * 图片节点工具条/配置条的小组件。
 *
 * 三条硬规则：
 * 1. **工具条和配置条是同一个东西**：同高（36px）、同底色、同圆角，选中工具后配置
 *    直接替换工具条的内容 —— 用户视线不用挪地方，也不会多出一块面板。
 * 2. **暗底 + 近白文字**：整站是暗色主题（画布近乎纯黑），横条也是暗面；颜色一律
 *    写死在 style 里，不依赖全局 CSS 或主题变量 —— 之前做白底时依赖了主题与工具类，
 *    结果真实页面里变成"黑底深色字"，看不见。
 * 3. 配色只有一条线：中性白灰 + **青色**（= App 的 colorPrimary）；选中/激活才上青色。
 *    尺寸按"能塞进 36px 横条"定：按钮高 26、下拉框 24、字号 12。
 */

export const BAR_BUTTON =
  'flex h-[26px] items-center gap-1 whitespace-nowrap rounded-md px-2 text-[12px] transition-colors disabled:opacity-40';

/**
 * 横条内 antd 控件的主题：**显式钉成暗色**，与横条自身一致。
 * 不显式指定就会继承全局主题 —— 哪天全局主题或横条底色一改，就会重演
 * "控件与文字颜色对不上、读不出来"的问题。
 */
const BAR_THEME = {
  algorithm: theme.darkAlgorithm,
  token: {
    // 白的高亮：只影响横条内这些控件（下拉聚焦边框、弹层选中项），不动全站主题
    colorPrimary: OPS.accent,
    colorText: OPS.ink,
    colorTextPlaceholder: OPS.muted,
    colorTextDescription: OPS.muted,
    colorIcon: OPS.muted,
    colorBorder: OPS.hairline,
    colorBgContainer: '#26272c',
    colorBgElevated: '#26272c',
    colorBgBase: OPS.surface,
    colorPrimaryBg: OPS.accentSoft,
    controlItemBgActive: OPS.accentSoft,
    controlItemBgHover: OPS.hoverBg,
    fontSize: 12,
    borderRadius: 6,
    controlHeightSM: 24,
  },
} as const;

/** 工具条上的工具按钮：图标 + 文字（纯图标没人看得懂） */
export function ToolButton({
  icon,
  label,
  hint,
  active = false,
  disabled = false,
  onClick,
}: {
  icon?: ReactNode;
  label: string;
  /** 这个工具做什么、要不要扣积分 —— 一律放 hover，不占横条中间 */
  hint?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={hint ? `${label} · ${hint}` : label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={BAR_BUTTON}
      style={{
        background: active ? OPS.accent : 'transparent',
        color: active ? OPS.accentText : OPS.ink,
        fontWeight: active ? 600 : 400,
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = OPS.hoverBg;
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent';
      }}
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * 工具条上的**纯图标**按钮（节点级动作：复制/删除/下载/存资产/看历史）。
 *
 * 为什么这组用纯图标、不给文字：工具按钮是"要打开某个模式"，看不懂就得有一个字；
 * 而这组是画布上人人熟悉的图标（复制/删除/下载…），且用户明确要求"显示这些图标"。
 * 每个都带 title（hover 说明）+ aria-label（读屏），不会真的只有一张图没有含义。
 */
export function IconActionButton({
  icon,
  label,
  hint,
  disabled = false,
  danger = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  /** hover 上的说明（一般同 label） */
  hint?: string;
  disabled?: boolean;
  /** 破坏性动作（删除）：hover 变红，与普通图标区分 */
  danger?: boolean;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      // 置灰时必须能问出"为什么不能点" —— 悬停说明优先用 hint
      title={hint || label}
      aria-label={label}
      disabled={disabled}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-[13px] transition-colors disabled:opacity-40"
      style={{
        color: danger && hover ? OPS.danger : OPS.ink,
        background: hover && !disabled ? OPS.hoverBg : 'transparent',
      }}
    >
      {icon}
    </button>
  );
}

/** 配置条里的动作按钮 */
export function BarButton({
  children,
  onClick,
  disabled = false,
  primary = false,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={BAR_BUTTON}
      style={
        primary
          ? { background: OPS.accent, color: OPS.accentText, fontWeight: 600 }
          : { background: 'transparent', color: OPS.ink, border: `1px solid ${OPS.hairline}` }
      }
      onMouseEnter={(e) => {
        e.currentTarget.style.background = primary ? OPS.accentHover : OPS.hoverBg;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = primary ? OPS.accent : 'transparent';
      }}
    >
      {children}
    </button>
  );
}

/** 配置条的关闭按钮：固定在最前面，点它退回工具条 */
export function CloseConfigButton({ onClick, toolName }: { onClick: () => void; toolName: string }) {
  return (
    <>
      <button
        type="button"
        data-ops-close
        aria-label={`关闭${toolName}配置`}
        title={`关闭${toolName}配置`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className="flex h-[24px] w-[24px] flex-none items-center justify-center rounded-md text-[13px] transition-colors"
        style={{ color: OPS.muted, background: 'transparent' }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = OPS.hoverBg;
          e.currentTarget.style.color = OPS.ink;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = OPS.muted;
        }}
      >
        <CloseOutlined />
      </button>
      <span className="whitespace-nowrap text-[12px] font-medium" style={{ color: OPS.ink }}>
        {toolName}
      </span>
    </>
  );
}

/** 配置条里的标签 */
export function ConfigLabel({ children }: { children: ReactNode }) {
  return (
    <span className="whitespace-nowrap text-[12px]" style={{ color: OPS.muted }}>
      {children}
    </span>
  );
}

/** 数值读数（等宽数字，避免拖动时宽度跳动） */
export function ConfigValue({ children }: { children: ReactNode }) {
  return (
    <span className="tabular-nums whitespace-nowrap text-[12px] font-medium" style={{ color: OPS.ink }}>
      {children}
    </span>
  );
}

export function BarDivider() {
  return <span className="mx-0.5 h-3.5 w-px flex-none" style={{ background: OPS.hairline }} />;
}

/** 下拉框：宫格、方式、目标尺寸这类"从几个里选一个"一律用它，省地方也一眼看懂 */
export function ConfigSelect<T extends string>({
  value,
  onChange,
  options,
  width = 120,
  ariaLabel,
  title,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  width?: number;
  ariaLabel?: string;
  /** hover 说明（说明性文案一律走 hover，不占横条中间） */
  title?: string;
}) {
  return (
    <span title={title} style={{ display: 'inline-flex' }}>
    <ConfigProvider theme={BAR_THEME}>
      <Select<T>
        size="small"
        value={value}
        onChange={(v) => onChange(v)}
        options={options}
        aria-label={ariaLabel}
        popupMatchSelectWidth={false}
        style={{ width, fontSize: 12 }}
        onMouseDown={(e) => e.stopPropagation()}
      />
    </ConfigProvider>
    </span>
  );
}

/** 紧凑滑杆：放在横条里，宽度固定不抢地方 */
export function MiniSlider({
  value,
  min,
  max,
  step = 1,
  onChange,
  width = 66,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  width?: number;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label="数值滑杆"
      onChange={(e) => onChange(Number(e.target.value))}
      onMouseDown={(e) => e.stopPropagation()}
      className="h-1 cursor-pointer appearance-none rounded-full"
      style={{
        width,
        accentColor: OPS.accent,
        background: `linear-gradient(to right, ${OPS.accent} ${pct}%, rgba(255,255,255,0.18) ${pct}%)`,
      }}
    />
  );
}

/** 两三个互斥选项的切换（画质提升的"放大/重生成"） */
export function MiniSegmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-none gap-0.5 rounded-md p-0.5" style={{ background: 'rgba(255,255,255,0.06)' }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            title={o.title}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onChange(o.value);
            }}
            className="rounded-[5px] px-2 py-0.5 text-[12px] transition-colors"
            style={{
              background: active ? OPS.accent : 'transparent',
              color: active ? OPS.accentText : OPS.muted,
              fontWeight: active ? 600 : 400,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** 宫格图标：按下拉框选项的行列画小方块 */
export function GridGlyph({
  rows,
  cols,
  size = 14,
  active = false,
}: {
  rows: number;
  cols: number;
  size?: number;
  active?: boolean;
}) {
  const color = active ? OPS.accent : OPS.muted;
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        display: 'grid',
        gridTemplateRows: `repeat(${Math.max(1, rows)}, 1fr)`,
        gridTemplateColumns: `repeat(${Math.max(1, cols)}, 1fr)`,
        gap: 1,
        flex: 'none',
      }}
    >
      {Array.from({ length: Math.max(1, rows) * Math.max(1, cols) }).map((_, i) => (
        <span key={i} style={{ background: color, borderRadius: 1, minWidth: 1, minHeight: 1 }} />
      ))}
    </span>
  );
}

/**
 * 横条的容器样式，工具条与配置条共用，保证两者完全同款。
 *
 * 底色写在 style 里而不是靠工具类：整站是暗色主题，横条要自己保证
 * "暗底 + 近白文字"成立，不能依赖外部样式是否生效。
 */
export const BAR_SURFACE: CSSProperties = {
  background: OPS.surface,
  borderColor: OPS.surfaceBorder,
  boxShadow: '0 10px 30px -10px rgba(0,0,0,0.7), 0 1px 3px rgba(0,0,0,0.5)',
};