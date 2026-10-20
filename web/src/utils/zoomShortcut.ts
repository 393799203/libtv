/**
 * 浏览器缩放键 → 画布缩放的判定。
 *
 * 为什么要有这个文件：⌘/Ctrl 加 `+` `-` `0` 是浏览器的**页面缩放**快捷键。用户按下去，
 * 浏览器把整个工作台（顶栏、侧栏、画布、提示词框）一起缩放，而用户真正想放大的是画布里的节点。
 * 所以我们拦下这三个键，改成缩放画布本身。
 *
 * 抽成纯函数是为了能真断言：`=` 和 `+` 在键盘上是同一个物理键（按了 Shift 才是 `+`），
 * 小键盘的 `+`/`-`/`0` 又要靠 `code` 认；漏掉任何一个，用户就会遇到"按了没反应、
 * 反而整个页面被缩了"的割裂感。
 */

export type ZoomIntent = 'in' | 'out' | 'reset';

/** 只关心这几个字段：KeyboardEvent 的这两组都满足 */
export interface ZoomKeyEventLike {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

/**
 * 命中返回意图，否则 null。
 *
 * 规则：
 *  - 必须带 ⌘(mac) 或 Ctrl；带 Alt 一律不认（⌘⌥ 组合另有其含义）。
 *  - `+`/`=`（同一物理键）、小键盘加号 → 放大；`-`/`_`、小键盘减号 → 缩小；
 *    `0`、小键盘 0 → 回到 100%（对应浏览器的"实际大小"）。
 *  - **不**区分 Shift：⌘⇧= 就是打出 `+`，语义仍然是放大。
 *  - 不碰其它键：⌘C/⌘V/⌘Z/⌘S 由各自的地方处理，这里绝不插一脚。
 */
export function zoomIntentFromKey(e: ZoomKeyEventLike): ZoomIntent | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
  const code = e.code || '';
  if (e.key === '+' || e.key === '=' || code === 'NumpadAdd') return 'in';
  if (e.key === '-' || e.key === '_' || code === 'NumpadSubtract') return 'out';
  if (e.key === '0' || code === 'Numpad0') return 'reset';
  return null;
}

/**
 * 拦截的条件（用于 ⌘/Ctrl + 滚轮、触控板双指捏合 —— 捏合在浏览器里就是 ctrlKey 的 wheel 事件）。
 *
 * `allowInsidePane` 由调用方给：画布内部 React Flow 自己就处理滚轮缩放，
 * 我们再拦一次会变成"一次滚轮缩两倍"。所以只拦画布**外面**（顶栏/侧栏/提示词面板）的那些。
 */
export function shouldCaptureZoomWheel(
  e: { ctrlKey: boolean; metaKey: boolean },
  insideReactFlowPane: boolean
): boolean {
  if (!(e.ctrlKey || e.metaKey)) return false;
  return !insideReactFlowPane;
}

/**
 * 滚轮/捏合一次后的目标缩放。用指数而不是线性：缩放的"感觉"是按比例的，
 * 线性加法会在放大后变得迟钝、在缩小后变得过冲。
 * 乘 0.0015 是因为一次普通滚轮 deltaY≈100 → 约 1.16 倍，和浏览器/画布的手感接近。
 */
export function nextZoomFromWheel(current: number, deltaY: number, min: number, max: number): number {
  const factor = Math.exp(-deltaY * 0.0015);
  const next = current * factor;
  if (!Number.isFinite(next) || next <= 0) return current;
  return Math.min(Math.max(next, min), max);
}