import type { VideoNodeData, VideoReshootState } from '@/types/canvas';

/**
 * 「片段重拍」的提示词装配与区间换算。
 *
 * 为什么这些是纯函数：区间 → 文案的换算最容易出错（小数点、进位、用户把时间改掉了），
 * 而它决定了发给模型的提示词里到底写着哪一段。抽出来就能脱开 React 直接断言。
 *
 * 用户要的形态（原话）：
 *   把@视频 中 00:00 - 00:05 后续用户自己写
 * 也就是：一条 @引用 + 中文的"中" + `mm:ss - mm:ss`，末尾留一个空格让用户直接接着写。
 */

/** 新建重拍节点时的默认片段长度（秒）。用户举例就是 00:00 - 00:05。 */
export const RESHOOT_DEFAULT_SECONDS = 5;
/** 片段最短 1 秒：比 1 秒更短的片段在提示词里只能写成 00:00 - 00:00，等于没说 */
export const RESHOOT_MIN_SECONDS = 1;

/** 秒 → `mm:ss`（超过 1 小时就写成 `hh:mm:ss`，虽然视频一般不会） */
export function formatTimecode(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * 拖动时把秒对齐到整秒。
 *
 * 为什么不做 0.1 秒精度：提示词里写的是 `mm:ss`，0.1 秒的精度在文案里根本不体现
 * —— 拖了半天文案没变，用户会以为"拖了没用"。对齐整秒后**手上的位置和提示词里的数字永远一致**。
 */
export function snapSeconds(seconds: number): number {
  return Math.round(seconds);
}

/** 把区间夹进 [0, duration]，并保证至少 RESHOOT_MIN_SECONDS 长且顺序正确 */
export function clampRange(start: number, end: number, duration?: number): { start: number; end: number } {
  const max = typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : undefined;
  let s = Math.max(0, snapSeconds(start));
  let e = Math.max(0, snapSeconds(end));
  if (e < s) [s, e] = [e, s];
  if (max !== undefined) {
    s = Math.min(s, Math.max(0, snapSeconds(max) - RESHOOT_MIN_SECONDS));
    // 结尾取到片尾时不再强加 1 秒：3 秒的视频只能给 00:00 - 00:03，写 00:04 是假的
    e = Math.min(Math.max(e, s + RESHOOT_MIN_SECONDS), Math.max(snapSeconds(max), s + RESHOOT_MIN_SECONDS));
  } else if (e - s < RESHOOT_MIN_SECONDS) {
    e = s + RESHOOT_MIN_SECONDS;
  }
  return { start: s, end: e };
}

/** `00:00 - 00:05` —— 注意是全角位置的空格，和用户给的例子一致 */
export function reshootRangeText(start: number, end: number): string {
  return `${formatTimecode(start)} - ${formatTimecode(end)}`;
}

/** 提示词开头：`把<@引用> 中 00:00 - 00:05 `（末尾留空格，用户接着写） */
export function buildReshootPrefix(refToken: string, start: number, end: number): string {
  return `把${refToken} 中 ${reshootRangeText(start, end)} `;
}

/**
 * 拖完区间后把提示词里那段时间改掉（**只改时间，不动用户自己写的内容**）。
 *
 * 两条刻意的设计：
 * 1. 只替换**第一个**时间区间。提示词里后面如果再出现 `12:03 - 12:07` 这类内容
 *    （用户可能在描述画面里的时钟），那是他的话，不能跟着把手动。
 * 2. 找不到时间区间就**原样返回**：说明用户把这段删了或改写了，此时不该硬塞回去
 *    —— 区间本身存在节点上（reshoot 字段），他随时能在片段条上看到。
 */
const RANGE_PATTERN = /\d{1,3}:\d{2}(?::\d{2})?\s*-\s*\d{1,3}:\d{2}(?::\d{2})?/;

export function applyRangeToPrompt(prompt: string, start: number, end: number): string {
  const text = prompt || '';
  if (!RANGE_PATTERN.test(text)) return text;
  return text.replace(RANGE_PATTERN, reshootRangeText(start, end));
}

/** 提示词里是否已经有时间区间（用于判断"到底改没改到"） */
export function promptHasRange(prompt: string): boolean {
  return RANGE_PATTERN.test(prompt || '');
}

/**
 * 读视频真实时长（秒）。
 *
 * 为什么要探一次：片段条的坐标轴就是"整条视频"，没有时长就不知道右把手能拖到哪。
 * 走 <video preload="metadata"> 只取头部元数据（几十 KB），不需要下载整条视频；
 * 跨域视频**照样能读** —— 没有 CORS 头只挡 canvas 取像素，不挡媒体元数据。
 * 读不到（编码不支持 / 网络失败 / 超时）返回 null，调用方必须**明说读不到**，
 * 不能偷偷按 5 秒假设 —— 那会让区间条和真实视频对不上。
 */
export function probeVideoDuration(url: string, timeoutMs = 12000): Promise<number | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || !url) {
      resolve(null);
      return;
    }
    const el = document.createElement('video');
    el.preload = 'metadata';
    el.muted = true;
    let done = false;
    const finish = (value: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      el.onloadedmetadata = null;
      el.onerror = null;
      // 释放这次元数据请求（否则视频元素会一直挂着）
      el.removeAttribute('src');
      try {
        el.load();
      } catch {
        /* 元素已分离，忽略 */
      }
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    el.onloadedmetadata = () => {
      const d = el.duration;
      finish(Number.isFinite(d) && d > 0 ? d : null);
    };
    el.onerror = () => finish(null);
    el.src = url;
  });
}

/**
 * 新建重拍节点时的初始状态：**总是从 0 开始的一个 RESHOOT_DEFAULT_SECONDS 秒窗口**
 * （用户举的例子就是 00:00 - 00:05），视频更短就夹到片尾。
 *
 * 注意不要把"时长已知"当成"区间就是整条视频"：知道 30 秒的片子多长，不等于用户想重拍整条
 * —— 那样提示词会直接写成 00:00 - 00:30，把"选一段"的意图抹掉（这条一开始就写错了，已修）。
 */
export function initialReshootState(sourceNodeId: string, sourceUrl: string, durationSeconds?: number | null): VideoReshootState {
  const range = clampRange(0, RESHOOT_DEFAULT_SECONDS, durationSeconds ?? undefined);
  return {
    sourceNodeId,
    sourceUrl,
    start: range.start,
    end: range.end,
    ...(typeof durationSeconds === 'number' && durationSeconds > 0 ? { durationSeconds } : {}),
  };
}

/** 重拍节点的初始数据（label/prompt/mentions/videoMode 一起给全，避免半成品节点） */
export function reshootNodeData(
  sourceLabel: string,
  mentionToken: string,
  state: VideoReshootState,
  source: Partial<VideoNodeData>,
): Partial<VideoNodeData> {
  return {
    label: `${sourceLabel || '视频'}·重拍`,
    prompt: buildReshootPrefix(mentionToken, state.start, state.end),
    reshoot: state,
    videoMode: 'video-ref',
    /**
     * 节点自己带**源视频**：新节点一出现就能播放、能拖进度条，
     * 用户要看着片子决定"重拍哪一段"。若这里留空，节点就是个黑框，选区间等于盲选。
     */
    videoUrl: state.sourceUrl ?? '',
    videoWidth: source.videoWidth,
    videoHeight: source.videoHeight,
    model: source.model || '',
    duration: source.duration,
    fps: source.fps,
    resolution: source.resolution,
    aspectRatio: source.aspectRatio,
    status: 'idle',
  } as Partial<VideoNodeData>;
}

/**
 * fast 系视频模型的硬限制：**参考视频时长 + 生成时长 ≤ 15.2 秒**
 * （后端 llm/video.go 的 normalizeSeedanceParams 在本地拦下）。
 *
 * 为什么前端要提前提示：这条错误发生在**扣费之后**（executor 先扣费、再构请求），
 * 而且它没包装成 ErrUpstreamRejected，billing 的自动退费判定不认 → 落"待人工复核"、
 * 钱不会自动回来，节点还被标成不可重试。对用户来说就是"生成失败还扣了钱"。
 * 所以这里在点生成之前就把算术做给他看。
 */
export const REF_VIDEO_FAST_LIMIT_SECONDS = 15.2;

export function refVideoLimitWarning(opts: {
  /** 参考视频时长（秒）：注意送的是**整条源视频**，不是选中的那一段 */
  refSeconds?: number;
  /** 本次生成时长（秒） */
  genSeconds?: number;
  model?: string;
}): string | null {
  const { refSeconds, genSeconds, model } = opts;
  if (!model || !/fast/i.test(model)) return null;
  if (typeof refSeconds !== 'number' || typeof genSeconds !== 'number') return null;
  if (!Number.isFinite(refSeconds) || !Number.isFinite(genSeconds)) return null;
  const total = refSeconds + genSeconds;
  if (total <= REF_VIDEO_FAST_LIMIT_SECONDS) return null;
  return `参考视频 ${Math.round(refSeconds)} 秒 + 生成 ${Math.round(genSeconds)} 秒 = ${Math.round(total)} 秒，超过 fast 模型 15 秒上限；直接生成会在扣费后失败，请换非 fast 模型或缩短生成时长`;
}
