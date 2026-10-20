import { useSyncExternalStore } from 'react';
import { equalCuts } from './geometry';

/**
 * 图片节点操作会话（悬停目标 + 当前打开的能力 + 各自的草稿参数）。
 *
 * 为什么放在 canvasStore 之外：
 * canvasStore 的每次 set 都会进历史栈并触发存盘，而"鼠标悬停在哪个节点""分割线拖到 48%"
 * 这类状态高频变化且没有留档价值，混进去会把 ⌘Z 变成"撤销我刚才拖的那条线"。
 * 这个 store 只服务画布上那 3 个组件（工具栏、面板、节点覆盖层），用 useSyncExternalStore 订阅。
 */

export type OpsMode = 'split' | 'element' | 'quality' | 'view';

/** 元素编辑的两种选区工具：框选（拖一个矩形）/ 点选（在某处点一下，圈出该处元素） */
export type ElementTool = 'box' | 'point';

/**
 * 一个选区。坐标与尺寸都是**相对图片的 0~1**（与切分线、涂抹笔迹同一套约定）：
 *   - x/y 是选区外接矩形的左上角；
 *   - w/h 是外接矩形尺寸；
 *   - tool='point' 时这个矩形内切一个椭圆（半径 = 点选笔刷），代表"点中的那个元素"。
 *
 * 存外接矩形而不是 `{cx,cy,r}`：两种工具共用一套结构，导出蒙版/画高亮/算位置提示
 * 都只有一条代码路径，不会出现"点选能画、框选忘了处理"这类漏。
 */
export interface ElementRegion {
  tool: ElementTool;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 点选识别出来的物体名：跟着这处选区走（撤销它就该一起消失） */
  label?: string;
  /**
   * 这一处可选的识别层级（由具体到宽泛），例如点鼻子：鼻子 / 人脸 / 人物。
   * 只有一个候选时也可以放着 —— 前端据此决定要不要显示"选一层"那一行。
   */
  candidates?: { label: string; box: { x: number; y: number; w: number; h: number } }[];
  /** 当前用的是第几层候选（高亮用） */
  candidateIndex?: number;
}

export interface SplitDraft {
  /** 视图预设 kind；'free' 表示用户自己改过行列 */
  kind: string;
  rows: number;
  cols: number;
  /** 用户拖过的切割线（0~1）。空 = 该方向等分 */
  cutsX: number[];
  cutsY: number[];
  /** 每格四边各内缩的像素数（默认 0：图上画的框就是切出来的，所见即所得） */
  trimPx: number;
  /**
   * 被选中的格号（0 起，行优先）。空 = 不限制，切分/高清作用于全部格子。
   * 顺序与后端返回一致，前端靠它把"图上点中的格子"对应到"切出来的图"。
   */
  selected: number[];
}

export interface ElementDraft {
  tool: ElementTool;
  /**
   * 点选的笔刷直径，**节点显示像素**（框选不用它）。
   *
   * 注意单位：图片节点固定显示成 320px 宽，所以"圈多大一块图"= brush/320。
   * 默认 48 ≈ 图宽的 15%（一个杯子/一顶帽子那种尺寸）；曾经默认 120，
   * 那是图宽的 37% —— 点一下半个身子都被圈进去，等于"改半张图"。
   */
  brush: number;
  regions: ElementRegion[];
  /** 用户写的那句短提示词 */
  prompt: string;
  /**
   * 点选识别出来的物体名（如"自动售货机"）。
   * 它会跟着改图请求发给后端，最终写进指令（"把「自动售货机」去掉"）——
   * 模型对"这个"没有指代，对"自动售货机"有，线上实测就是差在这一步。
   */
  target?: string;
  /** 正在识别中（点选后 5~16s）：提示框上显示"识别中…"，不阻塞用户继续写提示词 */
  recognizing?: boolean;
  /** 识别没认出来时的轻提示（不弹错，只在提示框里说明一句） */
  recognizeHint?: string;
  /** 上一次识别扣了多少积分（后端价格可调，这里只回显，不写死） */
  recognizeCharged?: number;
  /**
   * 移动模式：用户要把选区里的东西**搬到别处**（而不是原地改）。
   * 打开后下一次点图不再是"加选区"，而是标记落点（moveTo）。
   */
  moveMode?: boolean;
  /** 落点（相对图宽高 0~1 的中心点）；有它 + moveMode 就是一个移动指令 */
  moveTo?: { x: number; y: number };
}

export interface OpsState {
  /** 当前打开的能力；null = 什么都没开 */
  mode: OpsMode | null;
  /** 当前能力作用的节点 */
  targetId: string | null;
  busy: boolean;
  split: SplitDraft;
  element: ElementDraft;
}

const initialState: OpsState = {
  mode: null,
  targetId: null,
  busy: false,
  split: { kind: 'free', rows: 2, cols: 2, cutsX: [], cutsY: [], trimPx: 0, selected: [] },
  // 点选默认直径 48px（节点显示像素，见 ElementDraft.brush 的单位说明）
  element: { tool: 'box', brush: 48, regions: [], prompt: '', target: undefined, recognizing: false, recognizeHint: undefined },
};

let state: OpsState = initialState;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function set(patch: Partial<OpsState>) {
  state = { ...state, ...patch };
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot(): OpsState {
  return state;
}

export function useOpsState(): OpsState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** 非 React 环境读取（事件回调里用） */
export function getOpsState(): OpsState {
  return state;
}

export const ops = {
  /**
   * 打开某个能力。切分/元素编辑是"就地模式"（覆盖层画在节点图上），
   * 画质/视图是"面板"（从工具栏按钮弹出），但都走同一套：谁是目标、当前是什么模式。
   * 打开即重置该能力的草稿 —— 上次拖过的分割线/上次圈过的选区不该带到下一张图上。
   */
  open(nodeId: string, mode: OpsMode, preset?: { kind: string; rows: number; cols: number }) {
    if (mode === 'split') {
      set({
        mode,
        targetId: nodeId,
        busy: false,
        split: {
          kind: preset?.kind ?? 'free',
          rows: preset?.rows ?? 2,
          cols: preset?.cols ?? 3,
          cutsX: [],
          cutsY: [],
          // 默认 0：图上画的框就是切出来的，所见即所得（要吃掉宫格白边再调大）
          trimPx: 0,
          selected: [],
        },
      });
      return;
    }
    if (mode === 'element') {
      set({
        mode,
        targetId: nodeId,
        busy: false,
        // 打开即清空上一次的选区与提示词：它们只属于上一张图/上一次编辑
        element: { tool: 'box', brush: 48, regions: [], prompt: '', target: undefined, recognizing: false, recognizeHint: undefined },
      });
      return;
    }
    set({ mode, targetId: nodeId, busy: false });
  },

  close() {
    set({ mode: null, targetId: null, busy: false });
  },

  busy(busy: boolean) {
    set({ busy });
  },

  // ---------- 切分草稿 ----------

  splitPatch(patch: Partial<SplitDraft>) {
    set({ split: { ...state.split, ...patch } });
  },

  /** 选预设：换网格就作废手拖的线，也要清掉选中（格号对应的格子已经变了） */
  splitPreset(kind: string, rows: number, cols: number) {
    set({ split: { ...state.split, kind, rows, cols, cutsX: [], cutsY: [], selected: [] } });
  },

  splitRows(rows: number) {
    set({ split: { ...state.split, rows, kind: 'free', cutsY: [], selected: [] } });
  },

  splitCols(cols: number) {
    set({ split: { ...state.split, cols, kind: 'free', cutsX: [], selected: [] } });
  },

  // ---------- 格子的点选 / 多选 ----------

  /**
   * 点选一格。additive=true（按住 ⌘/Ctrl/Shift）时追加/取消，否则只留这一格。
   * 用"点选"而不是"框选"：格子就贴在图上，直接点最直观；线本身还要留着拖动。
   */
  splitSelect(index: number, additive: boolean) {
    const cur = state.split.selected;
    const next = additive
      ? cur.includes(index)
        ? cur.filter((i) => i !== index)
        : [...cur, index].sort((a, b) => a - b)
      : [index];
    set({ split: { ...state.split, selected: next } });
  },

  /** 全选 / 取消全选（count 是当前格数） */
  splitToggleAll(count: number) {
    const cur = state.split.selected;
    const all = cur.length === count && count > 0;
    set({ split: { ...state.split, selected: all ? [] : Array.from({ length: count }, (_, i) => i) } });
  },

  splitClearSelection() {
    if (state.split.selected.length === 0) return;
    set({ split: { ...state.split, selected: [] } });
  },

  splitCuts(axis: 'x' | 'y', cuts: number[]) {
    // 拖线不改格数，所以选中可以留着；只是裁掉越界格号以防万一
    const count = (axis === 'x' ? cuts.length + 1 : state.split.rows) * (axis === 'y' ? cuts.length + 1 : state.split.cols);
    set({
      split: {
        ...state.split,
        kind: 'free',
        [axis === 'x' ? 'cutsX' : 'cutsY']: cuts,
        selected: state.split.selected.filter((i) => i < count),
      },
    });
  },

  /** 把等分线"物化"成具体位置，供拖动使用 */
  materialize(axis: 'x' | 'y'): number[] {
    const { split } = state;
    if (axis === 'x') return split.cutsX.length ? split.cutsX : equalCuts(split.cols);
    return split.cutsY.length ? split.cutsY : equalCuts(split.rows);
  },

  splitResetCuts() {
    set({ split: { ...state.split, kind: 'free', cutsX: [], cutsY: [] } });
  },

  // ---------- 元素编辑草稿 ----------

  elementPatch(patch: Partial<ElementDraft>) {
    set({ element: { ...state.element, ...patch } });
  },

  /** 用户开始写提示词/重新点选时，把上一次的"没认出来"轻提示收掉 */
  elementClearRecognizeHint() {
    if (!state.element.recognizeHint) return;
    set({ element: { ...state.element, recognizeHint: undefined } });
  },

  /**
   * 追加一个选区。选区可以叠多个（先框住外套、再点一下手里的杯子），
   * 后端会把所有选区画进同一张蒙版 —— 一次生成只改这几处，只扣一次积分。
   */
  elementAdd(region: ElementRegion) {
    set({ element: { ...state.element, regions: [...state.element.regions, region] } });
  },

  /** 撤销最后一个选区（点错了不用重画全部） */
  elementUndo() {
    if (state.element.regions.length === 0) return;
    // 撤掉选区时连识别出的目标名一起清：名字对应的是那处选区，留着会指向不存在的东西
    set({ element: { ...state.element, regions: state.element.regions.slice(0, -1), target: undefined } });
  },

  elementClearRegions() {
    if (state.element.regions.length === 0) return;
    set({ element: { ...state.element, regions: [], target: undefined } });
  },

  /**
   * 把某一处选区换成识别出来的外接框（点选 → 识别 → 框住它）。
   * index 用的是点击那一刻的下标；期间用户撤销/清空过就对不上了，那种情况直接不管 ——
   * 宁可不替换，也不能把框画到别的地方去。
   */
  elementReplaceRegion(index: number, region: ElementRegion) {
    const list = state.element.regions;
    if (index < 0 || index >= list.length) return;
    const next = list.slice();
    next[index] = region;
    set({ element: { ...state.element, regions: next, target: region.label ?? state.element.target } });
  },

  /**
   * 选中某一层识别候选（点鼻子 → 可以改成用"人脸"那一层）。
   * 同时把这处选区的框换成那一层的外接框：框是给用户看的、也是蒙版的依据，
   * 只改名字不改框会出现"说改人脸、实际只蒙住鼻子"。
   */
  elementSelectCandidate(index: number, candidateIndex: number) {
    const list = state.element.regions;
    if (index < 0 || index >= list.length) return;
    const region = list[index];
    const cand = region.candidates?.[candidateIndex];
    if (!cand) return;
    const next = list.slice();
    next[index] = {
      ...region,
      tool: 'box',
      x: cand.box.x,
      y: cand.box.y,
      w: cand.box.w,
      h: cand.box.h,
      label: cand.label,
      candidateIndex,
    };
    set({ element: { ...state.element, regions: next, target: cand.label } });
  },

  /** 打开/关闭移动模式；关掉时把落点一起清掉（避免留下一个看不见的移动指令） */
  elementToggleMoveMode() {
    const on = !state.element.moveMode;
    set({ element: { ...state.element, moveMode: on, moveTo: on ? state.element.moveTo : undefined } });
  },

  /** 标记落点（移动模式下的那次点击） */
  elementSetMoveTo(point: { x: number; y: number } | undefined) {
    set({ element: { ...state.element, moveTo: point } });
  },

  elementPrompt(prompt: string) {
    set({ element: { ...state.element, prompt } });
  },
};