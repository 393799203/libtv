/**
 * 「截取画面」弹窗的纯计算部分：时间码、帧号、微调步进、三种动作的请求参数、命名去重。
 *
 * 全部是纯函数（不碰 DOM、不碰 store、不读视频元素），这样才能在 jsdom 里直接断言
 * "按钮点下去到底传了什么参数" —— 这类 bug（传错时刻、传整数秒丢了小数）靠肉眼看界面看不出来。
 *
 * 约定：**播放进度永远不进 store**（timeupdate 每秒触发多次，会把整条工具条拖着重渲染），
 * 这里的函数只接收/返回数字，调用方把结果放在弹窗自己的局部 state 里。
 */

/** 帧率兜底：节点数据里的 fps 可能是 0/undefined（老数据），退回 24（生成的默认值） */
export const DEFAULT_FPS = 24;

/** 合理帧率范围（防止脏数据让步进变成 0 或巨大） */
export function safeFps(fps?: number | null): number {
  if (typeof fps !== 'number' || !Number.isFinite(fps) || fps <= 1) return DEFAULT_FPS;
  return Math.min(fps, 120);
}

/** 夹到 [0, duration]；duration 未知（还没读到元数据）时只保证非负 */
export function clampTime(seconds: number, duration: number): number {
  if (!Number.isFinite(seconds)) return 0;
  const nonNegative = Math.max(0, seconds);
  if (!Number.isFinite(duration) || duration <= 0) return nonNegative;
  return Math.min(nonNegative, duration);
}

/**
 * 时间码 `分:秒.厘秒`（00:03.24）。
 *
 * 用厘秒而不是整秒：逐帧微调时一秒内的差别必须看得见，否则用户没法确认"到底停在哪一帧"。
 * 先四舍五入到厘秒再拆分钟秒，避免 3.998 → "00:03.100" 这种越界写法。
 */
export function formatTimecode(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  let cs = Math.round(safe * 100);
  const total = Math.floor(cs / 100);
  cs -= total * 100;
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/** 贴到帧网格：n / fps。逐帧步进和进度条拖动都用它，保证落在真实帧边界上 */
export function quantizeToFrame(seconds: number, fps?: number | null): number {
  const f = safeFps(fps);
  return Math.round(seconds * f) / f;
}

/** 当前时刻是第几帧（0 基，仅用于显示） */
export function frameIndex(seconds: number, fps?: number | null): number {
  const f = safeFps(fps);
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  return Math.round(safe * f);
}

/**
 * 微调一格：fine = 1 帧、coarse（按住 Shift）= 1 秒。
 *
 * 结果贴回帧网格：逐秒时若停在 3.0 正好是帧边界就不会漂；从 3.0416 往右 1 秒得 4.0 而不是
 * 4.0416 —— "逐秒"就该是整秒，用户按的是秒，不该继承上一次的帧余数。
 */
export function stepTime(
  current: number,
  dir: 1 | -1,
  fps: number | null | undefined,
  coarse: boolean,
  duration: number,
): number {
  const f = safeFps(fps);
  const base = coarse ? Math.round(current) : current;
  const next = coarse ? base + dir : base + dir / f;
  return clampTime(quantizeToFrame(next, f), duration);
}

export type FrameMode = 'first' | 'last' | 'at';

/**
 * 从"浏览器实际呈现过的帧时间戳"推出真实帧率。
 *
 * 为什么要实测：节点数据里的 fps 是**生成时的设置值**，和文件本身可能不一致 ——
 * 实测那条 30 秒片：节点写的是 24fps，ffprobe 量出来是 30fps。按 24 步进的话，
 * "±1 帧"实际跳 41.7ms，界面却写着 24fps ⇒ 用户以为停在帧边界上，其实没有。
 *
 * 取**最小正间隔**（帧网格的步长）而不是平均间隔：seek 时浏览器会跳过若干帧，
 * 平均会把跳帧算成更长的间隔、把帧率算低。
 */
export function fpsFromFrameTimes(times: readonly number[]): number | null {
  const uniq = [...new Set(times.filter((t) => Number.isFinite(t) && t >= 0))].sort((a, b) => a - b);
  if (uniq.length < 3) return null;
  let min = Number.POSITIVE_INFINITY;
  for (let i = 1; i < uniq.length; i += 1) {
    const delta = uniq[i] - uniq[i - 1];
    if (delta > 0.002 && delta < min) min = delta;
  }
  if (!Number.isFinite(min)) return null;
  const fps = 1 / min;
  if (!Number.isFinite(fps) || fps < 1 || fps > 120) return null;
  // 时间戳有量化误差（29.97 常落成 30），差得不多就归到整数帧率；差得多就保留两位小数
  const rounded = Math.round(fps);
  return Math.abs(fps - rounded) / fps < 0.06 ? rounded : Math.round(fps * 100) / 100;
}

/**
 * 三种动作真正传给 `POST /api/videos/frame` 的参数。
 *
 * - `first`：**不**传时刻，让后端自己 `-frames:v 1` 取第一帧（"第一帧"由 ffmpeg 判定，比我算 0 更可靠）
 * - `last` ：同样不传时刻，让后端 `-sseof` 从结尾往回 seek。
 *            这里绝不能用 `at = duration`：那是"最后一帧之后"，ffmpeg 很可能解出空画面。
 * - `at`   ：传**精确**秒（带小数，后端用 `-ss` 3 位小数 + accurate_seek）。
 *            **不做任何四舍五入** —— 之前提示语里 `toFixed(1)` 只用于显示，参数必须是原始播放头。
 */
export function buildFrameRequest(
  mode: FrameMode,
  current: number,
  duration: number,
): { mode: FrameMode; time: number } {
  if (mode === 'at') return { mode, time: clampTime(current, duration) };
  return { mode, time: 0 };
}

/** 新图片节点的名字：首帧/尾帧用固定词，指定时刻带上时间码（一眼看出截的是哪一帧） */
export function frameLabel(base: string, mode: FrameMode, time: number): string {
  if (mode === 'first') return `${base}·首帧`;
  if (mode === 'last') return `${base}·尾帧`;
  return `${base}·画面 ${formatTimecode(time)}`;
}

/**
 * 重名就去重：同一位置连截两张，不会都叫「镜头1·首帧」（画布里两个同名节点没法区分）。
 * 用已存在的标签列表判断，不改已有节点。
 */
export function uniqueFrameLabel(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base} ${i}`;
    if (!taken.includes(candidate)) return candidate;
  }
  return `${base} ${Date.now()}`;
}