import { useId } from 'react';

/**
 * 漫蛙品牌标 = 「蛙眼镜头」。
 *
 * 为什么是这个形状：蛙的眼 = 镜头。开口圆环是镜筒/眼白，偏移的实心圆是瞳孔，
 * 同时也是镜头上的高光点 —— 一个图形同时说清"蛙"和"做视频"，而且两笔就说完，
 * 缩到 16px 也不糊、放大也不空。这是四个候选里最抽象的一版，不像表情、不像插画。
 *
 * 另外三个候选（涟漪漩涡 / 抽象蛙头 / 三滴水墨）连同各自 16–96px 的真实尺寸预览，
 * 都在 web/public/logo-lab.html 里；想换风格就从那里拷几何过来替换下面的 path。
 *
 * 几何按 32×32 网格量化：圆环 r=9.6、描边 3.3、瞳孔 r=4.3 且上移 1.1 —— 线宽与留白
 * 都是整数比，任意尺寸缩放不会出现半像素毛边。
 */
const RING_D = 'M11.49 24.88A9.6 9.6 0 1 1 21.09 24.54';

export function BrandMark({
  size = 28,
  className = '',
  /** 单色模式：走 currentColor（用在必须单色的场合，比如单色 logo 墙） */
  mono = false,
  /** 小尺寸加粗：favicon 或 16–20px 场合，细线会虚掉 */
  bold = false,
}: {
  size?: number;
  className?: string;
  mono?: boolean;
  bold?: boolean;
}) {
  // useId 形如 ":r1:"，冒号在 url(#id) 里要转义，去掉更省事
  const uid = useId().replace(/:/g, '');
  const gradId = `bmg-${uid}`;
  const paint = mono ? 'currentColor' : `url(#${gradId})`;

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
      {!mono && (
        <defs>
          {/* 青 → 蓝 → 紫。青色是站内主强调色 #22d3ee、紫色是既有强调色，不新造色；
              userSpaceOnUse 保证同一枚标里多处 fill 用同一条连续渐变，接缝不可见 */}
          <linearGradient id={gradId} x1="4" y1="3" x2="28" y2="29" gradientUnits="userSpaceOnUse">
            <stop stopColor="#5eead4" />
            <stop offset="0.35" stopColor="#22d3ee" />
            <stop offset="0.7" stopColor="#6366f1" />
            <stop offset="1" stopColor="#c026d3" />
          </linearGradient>
        </defs>
      )}
      <path
        d={RING_D}
        stroke={paint}
        strokeWidth={bold ? 4.4 : 3.3}
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="16" cy="15.3" r={bold ? 5.2 : 4.3} fill={paint} />
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
  mono = false,
  className = '',
  markClass = '',
}: {
  size?: number;
  textClass?: string;
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
      <BrandMark size={size} mono={mono} className={`shrink-0 ${markClass}`} />
      {/* 字距放宽 0.06em：中文两字标默认贴着显闷，拉开后像"标"而不像正文 */}
      <span className={`font-extrabold leading-none tracking-[0.06em] ${textClass} ${wordClass}`}>
        漫蛙
      </span>
    </span>
  );
}