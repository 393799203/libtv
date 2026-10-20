/**
 * 读视频节点播放器**当前的播放进度**（秒）。
 *
 * 为什么直接读 DOM，而不是让 VideoNode 把进度同步进 store：
 * - 进度每秒变化 4 次以上（timeupdate），同步进 store 会让订阅它的组件跟着重渲染，
 *   而"截取当前帧"只在点击那一刻需要这个数字 —— 为了它把整条工具条按秒重渲染不划算；
 * - 读 DOM 拿到的一定是用户**眼睛看到的那一帧**（播放器真实状态），不会有时序偏差。
 * 为此 VideoNode 在播放器上留了 data-video-playhead="<节点id>" 这个锚点。
 *
 * 找不到播放器（节点没打开播放、或不是视频节点）返回 null —— 调用方必须**明确拒绝**
 * 而不是退回 0：退回 0 会悄悄把"当前帧"变成"首帧"，用户拿到的是错的那一帧却看不出来。
 */
export function readPlayheadSeconds(nodeId: string): number | null {
  if (typeof document === 'undefined') return null;
  const el = document.querySelector<HTMLVideoElement>(
    `video[data-video-playhead="${CSS.escape(nodeId)}"]`
  );
  if (!el) return null;
  const t = el.currentTime;
  if (!Number.isFinite(t) || t < 0) return null;
  return t;
}

/**
 * 把视频节点的播放器**跳到指定秒数**（片段条驱动播放器用）。
 *
 * 和 readPlayheadSeconds 成对：同样是按 id 找 DOM，不进 store。
 * 秒数会被夹到 [0, duration]；视频还没拿到元数据（duration 是 NaN）时只夹下界，
 * 让浏览器自己决定上限，避免因为我们算错上限把它钉在 0。
 *
 * 返回 false 表示这个节点当前没有可用的播放器（没打开播放、或不是视频节点）——
 * 调用方据此决定要不要给用户一句提示，而不是假装跳过去了。
 */
export function seekPlayhead(nodeId: string, seconds: number): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.querySelector<HTMLVideoElement>(
    `video[data-video-playhead="${CSS.escape(nodeId)}"]`
  );
  if (!el) return false;
  if (!Number.isFinite(seconds)) return false;
  const max = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : Infinity;
  const target = Math.min(Math.max(seconds, 0), max);
  try {
    el.currentTime = target;
  } catch {
    // 某些浏览器在元数据就绪前赋值会抛，忽略即可：用户再拖一次就好了
    return false;
  }
  return true;
}
