/**
 * 图片节点操作层的设计令牌。
 *
 * 配色**跟随 App 全局主题**（App.tsx 里是 antd darkAlgorithm）：
 *   colorPrimary #22d3ee（青）· colorBgBase #121316 · colorText #f6f6f7
 * 画布与弹层都是近黑底，所以这条横条也必须是**暗底 + 白字**。
 *
 * 之前踩过的坑：横条曾做成"白底 + 深灰字"，但整站是暗色主题、画布近乎纯黑，
 * 深色文字在黑底上根本看不见（hover 到浅底才露出来）；而且主色用了蓝色，
 * 跟全站青色主色也不是一家。现在：底 = 暗面，字 = 近白，唯一强调色 = 青。
 *
 * 另外两条：
 * 1. 画布上的操作层用屏幕空间尺寸（见 screenPx），缩放画布时线条/把手粗细不变，
 *    否则 zoom 0.3 时分割线细到看不见、把手小到点不中。
 * 2. 画在图片上的东西必须"任何底色都能看清"：分割线用**白色 + 暗色描边兜底**，
 *    不用彩色线（彩线压在彩色照片上又脏又难认）；只有"正在拖动"和"已选中的格子"才上青色。
 */
export const OPS = {
  /**
   * 高亮色 = **中性白**（不再用任何色相）。
   *
   * 试过两轮彩色高亮都不行：先是 antd 默认蓝，后是全局青色主色 —— 用户明确说
   * "高亮的青色系我不喜欢"。深色界面里其实不需要色相来表意：**亮 = 选中/激活，
   * 暗 = 未选中**（Lightroom / Figma 这类工具都是这么做的），
   * 而且中性高亮永远不会和"警告琥珀 / 成功绿"这类语义色打架。
   */
  accent: '#f6f6f7',
  accentHover: '#ffffff',
  /** 破坏性动作（删除）的 hover 色：与 antd danger 同一个红，别自己再挑一个 */
  danger: '#ff4d4f',
  /** 白底上的文字色（深近黑，对比度约 15:1） */
  accentText: '#1c1d21',
  /** 白的高亮淡染（选中格子、激活按钮） */
  accentSoft: 'rgba(255, 255, 255, 0.16)',
  accentRing: 'rgba(255, 255, 255, 0.4)',

  /** 横条底：比画布(#121316)亮一档，与 antd 弹层同族 */
  surface: '#1c1d21',
  surfaceBorder: 'rgba(255, 255, 255, 0.10)',
  hoverBg: 'rgba(255, 255, 255, 0.08)',

  /** 主文字（= antd colorText）· 次级 · 更次（暗底约 15:1 / 7.5:1 / 5.5:1） */
  ink: '#f6f6f7',
  muted: '#aaacb1',
  faint: '#8b8d93',
  hairline: 'rgba(255, 255, 255, 0.14)',

  /**
   * 画在图片上的分割线：未选中是"暗一档的白"、正在拖动/已选中的格子是全白。
   * 用**明度**区分状态而不是颜色 —— 白线压在任意照片上都看得清，
   * 而彩色线（之前的蓝）在彩色照片上又脏又难认。
   */
  lineOnImage: 'rgba(255, 255, 255, 0.72)',
  lineOnImageActive: '#ffffff',
  lineHalo: 'rgba(15, 23, 42, 0.5)',
  /** 会被裁掉/内缩掉的区域：暗色蒙版（暗 = 不要） */
  scrim: 'rgba(15, 23, 42, 0.45)',
  /** 未选中格子的描边（更淡的白） */
  keptEdge: 'rgba(255, 255, 255, 0.32)',
  badge: 'rgba(15, 23, 42, 0.72)',

  warn: '#f59e0b',
  warnSoft: 'rgba(245, 158, 11, 0.16)',
} as const;

/**
 * 屏幕像素 → 画布节点内像素。
 *
 * 覆盖层渲染在节点内部，会跟着画布 zoom 一起缩放。想让"线宽 1.5px、把手 20×10"
 * 这些在屏幕上恒定，就得除以 zoom。zoom 很小时钳到 0.5，避免操作层在缩略视图里
 * 胀成一团遮住图片。
 */
export function screenPx(v: number, zoom: number): number {
  return v / Math.max(zoom, 0.5);
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}