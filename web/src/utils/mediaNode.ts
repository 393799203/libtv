import { deriveThumbUrl } from '@/utils/thumbUrl';
import type { NodeType } from '@/types/canvas';

/** 一份媒体产物的原始信息（拖放/上传/生成都归到这里） */
export interface MediaPayload {
  url: string;
  name?: string;
  /** 服务端已生成的缩略图；没有就按约定从 url 推导 */
  thumbUrl?: string;
  width?: number;
  height?: number;
}

/**
 * 媒体节点的产物字段 —— **「把一份媒体放到画布上」的唯一出口**。
 *
 * 为什么要有这个函数：在此之前，系统文件拖入、资产库资产拖入、生成多图的兄弟节点
 * 三处各自手拼字段，漏写派生字段的情况反复出现过（例如只写 imageUrl 不写 thumbUrl，
 * 节点就会继续显示上一版的小图；兄弟节点还会继承原节点的缩略图）。
 * 统一到这里之后，新增入口只要调用它，就不会再漏。
 *
 * 注意：label / width / height 只在调用方真的给了值时才写入 —— 否则会把
 * createNode 的默认 label、或生成回写的尺寸覆盖成 undefined。
 */
export function mediaFieldsFor(nodeType: NodeType, payload: MediaPayload): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (payload.name) fields.label = payload.name;

  if (nodeType === 'video') {
    fields.videoUrl = payload.url;
    // 换了视频，旧封面（stillUrl 是某一帧画面）不能留
    fields.stillUrl = undefined;
    return fields;
  }
  if (nodeType === 'audio') {
    fields.audioUrl = payload.url;
    return fields;
  }

  fields.imageUrl = payload.url;
  fields.thumbUrl = payload.thumbUrl ?? deriveThumbUrl(payload.url);
  if (payload.width != null) fields.width = payload.width;
  if (payload.height != null) fields.height = payload.height;
  return fields;
}
/** 按 MIME/扩展名判定拖入的文件该落成哪种媒体节点（图片/视频/音频） */
export function mediaKindOfFile(file: File): 'image' | 'video' | 'audio' | null {
  if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(file.name)) return 'image';
  if (file.type.startsWith('video/') || /\.(mp4|webm|mov|mkv|m4v)$/i.test(file.name)) return 'video';
  if (file.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name)) return 'audio';
  return null;
}
