/**
 * 宫格切分的纯几何计算。抽出来是为了让"弹层预览"和"节点上的覆盖层"用同一套数字，
 * 也为了能脱离 React 直接测。
 *
 * 坐标系约定：**全部用 0~1 的相对比例**（切割线位置、格子框、涂抹笔迹都是）。
 * 这样画布缩放、缩略图与原图之间的换算只剩一次乘法，不会出现"预览和实际切出来差几像素"。
 */

/** n 等分 → n-1 条内部切割线 */
export function equalCuts(n: number): number[] {
  return Array.from({ length: Math.max(0, n - 1) }, (_, i) => (i + 1) / n);
}

/** 用户拖过就用拖的，否则等分 */
export function effectiveCuts(cuts: number[], n: number): number[] {
  return cuts.length ? cuts : equalCuts(n);
}

export interface CellBox {
  /** 相对整图的左上角与宽高（0~1） */
  x: number;
  y: number;
  w: number;
  h: number;
  row: number;
  col: number;
  /** 显示用序号，从 1 开始，行优先 —— 与后端返回的格子顺序一致 */
  index: number;
}

export function cellBoxes(cutsX: number[], cutsY: number[]): CellBox[] {
  const xb = [0, ...cutsX, 1];
  const yb = [0, ...cutsY, 1];
  const out: CellBox[] = [];
  // 0 基：与后端 /images/split 的 cells 参数、返回的 tile.cell_index 同一套编号；
  // 面向用户的"第 N 格"在渲染时用 index + 1
  let index = 0;
  for (let r = 0; r + 1 < yb.length; r++) {
    for (let c = 0; c + 1 < xb.length; c++) {
      out.push({
        x: xb[c],
        y: yb[r],
        w: xb[c + 1] - xb[c],
        h: yb[r + 1] - yb[r],
        row: r,
        col: c,
        index: index++,
      });
    }
  }
  return out;
}

export interface TileSizeRange {
  minW: number;
  minH: number;
  maxW: number;
  maxH: number;
}

/**
 * 每格的像素尺寸区间。拖过分割线之后各格不再等大，所以提示要给区间，
 * 而"会不会太小被上游拒收"只看**最窄的那一格**。
 */
export function tileSizes(
  boxes: CellBox[],
  width?: number,
  height?: number,
  trimPx = 0,
): TileSizeRange | null {
  if (!width || !height || boxes.length === 0) return null;
  let minW = Number.POSITIVE_INFINITY;
  let minH = Number.POSITIVE_INFINITY;
  let maxW = 0;
  let maxH = 0;
  for (const b of boxes) {
    const w = Math.round(b.w * width) - trimPx * 2;
    const h = Math.round(b.h * height) - trimPx * 2;
    minW = Math.min(minW, w);
    minH = Math.min(minH, h);
    maxW = Math.max(maxW, w);
    maxH = Math.max(maxH, h);
  }
  return { minW, minH, maxW, maxH };
}

/** 一条线上要丢弃的区间（像素，相对该轴的整长） */
export interface Band {
  from: number;
  to: number;
}

/**
 * 内缩会吃掉的区域。
 *
 * 关键简化：内部切割线处，左右两格各内缩 trimPx，合起来就是以该线为中心、宽 2×trimPx
 * 的一条带；四条外边各吃 trimPx。所以蒙版只需要 (列数-1 + 行数-1 + 4) 个矩形，
 * 不必逐格画四个边 —— 视觉上正好就是"宫格之间的白边被吃掉"。
 */
export function trimBands(cuts: number[], totalPx: number, trimPx: number): Band[] {
  if (trimPx <= 0 || totalPx <= 0) return [];
  const out: Band[] = [
    { from: 0, to: trimPx },
    { from: totalPx - trimPx, to: totalPx },
  ];
  for (const c of cuts) {
    const center = c * totalPx;
    out.push({ from: center - trimPx, to: center + trimPx });
  }
  return out;
}

/**
 * 拖动某条线时把它夹在相邻两条线之间。
 * gap 与后端 cutsMinGap 保持一致：比这更近的一刀会被后端丢掉，前端先拦住，
 * 免得用户看到"拖了但结果没变"。
 */
export const CUT_GAP = 0.02;

export function clampCut(cuts: number[], index: number, ratio: number): number {
  const lower = index === 0 ? CUT_GAP : cuts[index - 1] + CUT_GAP;
  const upper = index === cuts.length - 1 ? 1 - CUT_GAP : cuts[index + 1] - CUT_GAP;
  return Math.min(upper, Math.max(lower, ratio));
}
// ========== 元素编辑：提示词输入框贴在哪儿 ==========

/**
 * 输入框宽度与它跟图片之间的间距（屏幕像素）。
 * 宽度刻意压到 240：图片节点只显示 320px 宽，窄一点才塞得进节点宽度、不至于左右乱溢。
 */
export const PROMPT_BOX_WIDTH = 240;
export const PROMPT_BOX_GAP = 10;

export interface PromptBoxPlacement {
  /** 锚点横坐标（节点内 CSS px，缩放前）：图片盒水平中心 */
  anchorX: number;
  /** 锚点纵坐标（节点内 CSS px，缩放前）：图片盒**下边缘**再让开一个间距 */
  anchorY: number;
}

/**
 * 提示词输入框的落点：挂在**图片下方**（节点底部外侧），水平居中。
 *
 * 这里改过两次，两次都是被用户驳回后改的，别再改回去：
 *  1. 最早贴在选区**下方**（图片内部）：选区偏下时正好压住节点自己的提示词框，写提示词的地方被盖住；
 *  2. 改成贴选区**左右两侧**：不再压提示词框了，但框浮在图上，总会挡住选区旁边的内容
 *     —— 用户的原话是"放到节点下方，避免遮住图片"。
 *  3. 现在放图片下方：之所以这次可以，是因为**选中工具时节点自己的提示词框已经收起**
 *     （见 components/canvas/promptPanelRule.ts），下面这块地方空出来了，不会再打架。
 *
 * 单位提醒：锚点是"节点内 CSS px"（缩放前），外面的浮层整体带 scale(1/zoom)、
 * 所以间距要按屏幕像素换算成节点内像素（除以 zoom），间距在屏幕上才恒定。
 * 这里**不能**用 tokens.screenPx：它对 zoom 有 0.5 的下限（画布 minZoom 是 0.05），
 * 下限一触发，间距在屏幕上就不是 10px 了（实测 zoom=0.25 时只剩 5px）。
 */
export function promptBoxPlacement(
  host: { x: number; y: number; w: number; h: number },
  zoom: number,
): PromptBoxPlacement {
  return {
    anchorX: host.x + host.w / 2,
    anchorY: host.y + host.h + PROMPT_BOX_GAP / Math.max(zoom, 0.05),
  };
}

import type { ElementRegion } from './opsStore';

/**
 * 移动模式的落点框：把"源选区"整体平移，使它的**中心**落在落点上（相对坐标 0~1）。
 *
 * 为什么用源选区的尺寸而不是让用户自己框：移动的语义是"原样搬过去"，
 * 尺寸不变才符合直觉（框大小交给用户就等于让他顺手改了缩放）。
 * 结果夹在图内，避免落点贴边时框跑到图外。
 */
export function moveDestinationRect(
  region: ElementRegion | undefined,
  moveTo: { x: number; y: number } | undefined,
): ElementRegion | undefined {
  if (!region || !moveTo) return undefined;
  const x = Math.min(Math.max(moveTo.x - region.w / 2, 0), Math.max(0, 1 - region.w));
  const y = Math.min(Math.max(moveTo.y - region.h / 2, 0), Math.max(0, 1 - region.h));
  return { tool: 'box', x, y, w: region.w, h: region.h };
}
