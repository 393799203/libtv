import { deriveThumbUrl } from '@/utils/thumbUrl';
import type { NodeType } from '@/types/canvas';

/** 一份媒体产物的原始信息（拖放/上传/生成都归到这里） */
export interface MediaPayload {
  /** 媒体 URL；**空串表示「节点先建出来、上传还没完成」的占位**（见下方 mediaFieldsFor） */
  url: string;
  name?: string;
  /** 服务端已生成的缩略图；没有就按约定从 url 推导 */
  thumbUrl?: string;
  width?: number;
  height?: number;
  /** 占位态：正在上传（默认 true，除非显式给 false 或带了 uploadError） */
  uploading?: boolean;
  uploadProgress?: number;
  uploadPhase?: string;
  uploadError?: string;
}

/**
 * 节点标题（人看的）从文件名（系统看的）里取：**去掉扩展名**。
 *
 * 为什么：拖进来的图/视频/音频，标题顶着 `IMG_2043.HEIC`、`clip.mp4` 这种后缀既长又没用 ——
 * 卡片上已经用图标和预览说清它是什么类型了，后缀只是噪声（用户明确要求标题不带后缀）。
 * 只去掉**最后一段**扩展名，`a.tar.gz` → `a.tar`；点文件（`.gitignore`，点在最前）保持原样，
 * 免得整名被吃掉。真实文件名不受影响：判定媒体类型（mediaKindOfFile）、上传、资产库都仍用原文件名。
 */
export function titleFromFileName(name: string): string {
  const trimmed = name.trim();
  const dot = trimmed.lastIndexOf('.');
  if (dot <= 0) return trimmed;
  return trimmed.slice(0, dot) || trimmed;
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
  if (payload.name) fields.label = titleFromFileName(payload.name);

  // 还没有 URL = 占位节点（拖入画布时先建节点、再上传，见 Canvas 的 drop 流程）。
  // 这里只写上传态，**不写** imageUrl: '' 这种半成品 —— 空串会让节点以为自己"有图"，
  // 于是去渲染一个空 <img>（空白 + 破图），而不是「上传中」。
  if (!payload.url) {
    fields.uploading = payload.uploading ?? !payload.uploadError;
    if (payload.uploadPhase) fields.uploadPhase = payload.uploadPhase;
    if (payload.uploadProgress != null) fields.uploadProgress = payload.uploadProgress;
    if (payload.uploadError) fields.uploadError = payload.uploadError;
    return fields;
  }

  // URL 到手：清掉占位态，节点立刻换成真正的图/视频/音频。
  // 显式写 undefined（而不是留着不动）—— 节点数据是浅合并的，不覆盖就永远转圈。
  fields.uploading = undefined;
  fields.uploadPhase = undefined;
  fields.uploadProgress = undefined;
  fields.uploadError = undefined;

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
