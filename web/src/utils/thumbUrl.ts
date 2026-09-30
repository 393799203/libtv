/**
 * 缩略图地址约定：foo/hash.png → foo/hash.thumb.webp
 *
 * 后端在图片上传成功时会顺手生成一张 640px 的 webp 缩略图，与原图同目录、同名加
 * `.thumb.webp` 后缀。画布的轻量展示用它，论坛正文也用 —— 一张 1.9MB 的原图换成
 * 24KB 的缩略图，省 98% 流量。
 *
 * 两点必须注意：
 * 1. 缩略图可能不存在（存量文件上传那一次请求没走完，事后不会自动补；管理员可用
 *    /api/admin/media/backfill-thumbnails 扫描补齐）。所以调用方一定要能回退原图。
 * 2. 不要对已经是 `.thumb.webp` 的地址再推一层，否则会得到 `x.thumb.thumb.webp`。
 */

const IMAGE_RE = /^(.*)\.(png|jpe?g|webp|gif)(\?.*)?$/i;

/** 本站在管存储的路径特征：外链不替换，避免为每个外链多打一次 404 请求 */
const OWN_STORAGE_RE = /\/(forum|users|images|canvas|projects|assets)\//i;

/** 是否是本站存储在管的图片地址（外链、data:、blob: 都不算） */
export function isOwnStorageUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('data:') || url.startsWith('blob:')) return false;
  return url.startsWith('/media/') || OWN_STORAGE_RE.test(url);
}

/** 按约定推导缩略图地址；推不出来（非图片、已是缩略图）返回 undefined */
export function deriveThumbUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('data:') || url.startsWith('blob:')) return undefined;
  if (/\.thumb\.webp(\?.*)?$/i.test(url)) return undefined;
  const matched = url.match(IMAGE_RE);
  if (!matched) return undefined;
  return `${matched[1]}.thumb.webp${matched[3] ?? ''}`;
}
