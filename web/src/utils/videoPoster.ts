import { imageOpsApi } from '@/services/imageOpsApi';

/**
 * 视频节点的「首帧封面」。
 *
 * 为什么需要它：画布数据里的视频节点**只有 videoUrl**（线上实测确认：thumbUrl / stillUrl 都是空的），
 * 所以提示词框里的 @视频 标签没有图可显示，只能退回默认的 🎬 图标 ——
 * 用户明确说"不要显示视频默认图标，要显示视频首帧缩略图"。
 * 这里让后端取一次首帧（/videos/frame mode=first），拿它的 640px webp 当封面。
 *
 * 顺带一个大好处：这一步会把源视频拉进后端的「源文件缓存」，于是
 * 「片段重拍 / 截取画面 / 裁剪」的**第一次**也不用再干等 30 秒 ——
 * 那 30 秒在节点刚出现时就后台花掉了（源站限速 1.26MB/s，一支 37MB 的片子必然要这么久）。
 *
 * 缓存放在模块级：同一支视频在多个节点/多次打开面板之间共用，且并发只发一次请求。
 */
const posterCache = new Map<string, string>();
const inFlight = new Map<string, Promise<string | undefined>>();

/** 同步读缓存（渲染时用；没拿到就先用图标顶着） */
export function getCachedVideoPoster(videoUrl?: string): string | undefined {
  return videoUrl ? posterCache.get(videoUrl) : undefined;
}

/** 取首帧封面（并发去重；失败不抛，返回 undefined 让调用方退回图标） */
export function ensureVideoPoster(videoUrl?: string): Promise<string | undefined> {
  if (!videoUrl) return Promise.resolve(undefined);
  const hit = posterCache.get(videoUrl);
  if (hit) return Promise.resolve(hit);
  const running = inFlight.get(videoUrl);
  if (running) return running;

  const task = imageOpsApi
    .videoFrame({ videoUrl, mode: 'first' })
    .then((res) => {
      const tile = res?.tile;
      const url = tile?.thumb_url || tile?.url;
      if (url) posterCache.set(videoUrl, url);
      return url;
    })
    .catch(() => undefined)
    .finally(() => {
      inFlight.delete(videoUrl);
    });

  inFlight.set(videoUrl, task);
  return task;
}