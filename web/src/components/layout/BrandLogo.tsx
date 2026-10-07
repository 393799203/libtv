import { useId } from 'react';

/**
 * 漫蛙品牌标。两版几何，用 variant 切换：
 *
 * - frog（默认）：可爱青蛙头。头部 = 左眼凸包 + 右眼凸包 + 圆角下颌三块取并集；
 *   四个造型要点是刻意做的：
 *     ① 右倾 → 整体 rotate(-8°)（左低右高），但真正决定观感的是**眼线**：
 *        右眼(cy 11.4)明显高于左眼(cy 15.6)，否则左眼凸包天生偏高，会看成"左高右低"；
 *     ② 左眼特别大 → 左眼凸包 r=7.2，右眼凸包只有 4.9，白眼 r=5.0 vs 2.85；
 *     ③ 右下角露半截舌头 → 张嘴是平顶圆底的深色块，舌头从里面垂到下颌之外
 *        （实测露出 3.1 个网格单位 ≈ 头部高度的 12%）；
 *     ④ 16–28px 仍可辨 → 只要大眼、瞳孔、舌头三件事还在就不会糊。
 *   配色：头部走青绿→青→靛的渐变（不是正绿，为了跟站内强调色同族），
 *   舌头用玫红做唯一的暖色跳点，瞳孔/嘴用近黑。
 *
 * - lens：蛙眼镜头（开口圆环 + 偏移实心圆）。更抽象、更安静的一版，留作备选。
 *
 * 另外三个候选（涟漪漩涡 / 抽象蛙头 / 三滴水墨）连同各自 16–96px 的真实尺寸预览，
 * 都在 web/public/logo-lab.html 里。
 */
const FROG_GRAD = (
  <>
    <stop stopColor="#5eead4" />
    <stop offset="0.42" stopColor="#22d3ee" />
    <stop offset="1" stopColor="#6366f1" />
  </>
);

/** 造型先在 32×32 网格里画正，再整体倾斜 + 缩放到留白（缩放比例由旋转后的包围盒算出） */
const FROG_TRANSFORM = 'rotate(-8 16 16.8) translate(-2.894 -5.658) scale(1.1624)';
const FROG_EYE_WHITE = '#ffffff';
const FROG_INK = '#101318';
const FROG_TONGUE = '#fb7185';

const LENS_RING_D = 'M11.49 24.88A9.6 9.6 0 1 1 21.09 24.54';

export type BrandMarkVariant = 'frog' | 'lens';

export function BrandMark({
  size = 28,
  className = '',
  variant = 'frog',
  /** 单色模式（仅 lens 有意义）：走 currentColor */
  mono = false,
  /** lens 小尺寸加粗：favicon 或 16–20px 场合，细线会虚掉 */
  bold = false,
}: {
  size?: number;
  className?: string;
  variant?: BrandMarkVariant;
  mono?: boolean;
  bold?: boolean;
}) {
  // useId 形如 ":r1:"，冒号在 url(#id) 里要转义，去掉更省事
  const uid = useId().replace(/:/g, '');
  const gradId = `bmg-${uid}`;
  const paint = mono && variant === 'lens' ? 'currentColor' : `url(#${gradId})`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {!(mono && variant === 'lens') && (
        <defs>
          {/* userSpaceOnUse：同一枚标里多处 fill 共用一条连续渐变，三块头形的接缝不可见 */}
          <linearGradient id={gradId} x1="4" y1="6" x2="28" y2="28" gradientUnits="userSpaceOnUse">
            {FROG_GRAD}
          </linearGradient>
        </defs>
      )}

      {variant === 'frog' ? (
        <g transform={FROG_TRANSFORM}>
          {/* 头：左眼凸包（大）+ 右眼凸包（小）+ 圆角下颌 */}
          <circle cx="10.4" cy="15.6" r="7.2" fill={paint} />
          <circle cx="23.8" cy="11.4" r="4.9" fill={paint} />
          <rect x="4" y="15" width="24.2" height="11.4" rx="5.7" fill={paint} />
          {/* 左眼：特别大，瞳孔偏右下（看向舌头），左上留高光 */}
          <circle cx="10.4" cy="15.6" r="5" fill={FROG_EYE_WHITE} />
          <circle cx="11.5" cy="16.7" r="2.5" fill={FROG_INK} />
          <circle cx="9.3" cy="13.5" r="1.25" fill={FROG_EYE_WHITE} />
          {/* 右眼：小一号，位置比左眼高（眼线左低右高 = 倾斜观感的主因） */}
          <circle cx="23.8" cy="11.4" r="2.85" fill={FROG_EYE_WHITE} />
          <circle cx="24.6" cy="12.1" r="1.45" fill={FROG_INK} />
          <circle cx="23.1" cy="10.5" r="0.7" fill={FROG_EYE_WHITE} />
          {/* 右下张嘴（平顶圆底）+ 垂到下颌之外的半截舌头 */}
          <path d="M18.6 20.2h8.4a4.3 4.3 0 0 1-4.2 5.1 4.3 4.3 0 0 1-4.2-5.1Z" fill={FROG_INK} />
          <path d="M21.6 22.4h7v3.6a3.5 3.5 0 0 1-7 0Z" fill={FROG_TONGUE} />
        </g>
      ) : (
        <>
          <path
            d={LENS_RING_D}
            stroke={paint}
            strokeWidth={bold ? 4.4 : 3.3}
            strokeLinecap="round"
            fill="none"
          />
          <circle cx="16" cy="15.3" r={bold ? 5.2 : 4.3} fill={paint} />
        </>
      )}
    </svg>
  );
}

/**
 * 品牌锁形（标 + 字标）。
 * 字标两个字形共用一条横向多色渐变（青→蓝→紫→品红），即"彩色有过渡"。
 * 这里用的是 W1；W2/W3/W4 见 logo-lab.html。
 *
 * 注意：渐变文字必须 bg-clip-text 与 text-transparent 一起写，而且不能加在 antd 组件上
 * —— antd 的 CSS-in-JS 是运行时注入的，同特异度下永远排在静态样式表之后。
 */
export function BrandLogo({
  size = 28,
  textClass = 'text-base',
  variant = 'frog',
  mono = false,
  className = '',
  markClass = '',
}: {
  size?: number;
  textClass?: string;
  variant?: BrandMarkVariant;
  mono?: boolean;
  className?: string;
  /** 标自身的类（响应式尺寸用，如 max-sm:h-6 max-sm:w-6） */
  markClass?: string;
}) {
  const wordClass = mono
    ? 'text-[var(--dv-text-1)]'
    : 'bg-[linear-gradient(100deg,#67e8f9_0%,#22d3ee_28%,#818cf8_58%,#c084fc_82%,#f0abfc_100%)] bg-clip-text text-transparent';

  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <BrandMark size={size} variant={variant} mono={mono} className={`shrink-0 ${markClass}`} />
      {/* 字距放宽 0.06em：中文两字标默认贴着显闷，拉开后像"标"而不像正文 */}
      <span className={`font-extrabold leading-none tracking-[0.06em] ${textClass} ${wordClass}`}>
        漫蛙
      </span>
    </span>
  );
}