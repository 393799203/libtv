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

import { toSameOriginMediaUrl } from '@/utils/download';

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

/** 匹配一个完整 <img ...> 标签（属性值里的 > 不算结束） */
const IMG_TAG_RE = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const SRC_ATTR_RE = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 改写正文 HTML：图片改用 640px 缩略图显示，并包一层指向原图的链接。
 *
 * **必须在字符串上改写，不能等渲染完再改 DOM**：组件任何一次 state 变化
 * （比如打开预览弹窗）都会让 React 用原始 HTML 重灌 innerHTML，手工加的属性、
 * 包裹的节点全部会被冲掉 —— 实测底图会直接退回原图，布局从 642px 蹦到 992px。
 *
 * 产出的结构：
 *   <a class="forum-img-link" href="/media/<对象名>" target="_blank" rel="noopener">
 *     <img src="…thumb.webp" data-original="原图地址" loading="lazy" title="查看原图">
 *   </a>
 * 链接保留是为了右键「新标签页打开 / 复制链接」还能用；href 走同源 /media，
 * 因为 ZOS 直链在响应层强制 Content-Disposition: attachment，点开只会下载。
 */
export function decorateForumContent(html: string): string {
  if (!html || html.indexOf('<img') === -1) return html;
  return html.replace(IMG_TAG_RE, (tag) => {
    if (/data-original=/i.test(tag)) return tag; // 已处理过
    const srcMatch = tag.match(SRC_ATTR_RE);
    if (!srcMatch) return tag;
    const original = srcMatch[1] ?? srcMatch[2] ?? srcMatch[3] ?? '';
    if (!original || !isOwnStorageUrl(original)) return tag;
    const thumb = deriveThumbUrl(original);
    if (!thumb) return tag;

    let next = tag.replace(SRC_ATTR_RE, `src="${escapeAttr(thumb)}"`);
    next = next.replace(
      /<img\b/i,
      `<img data-original="${escapeAttr(original)}" loading="lazy" title="查看原图"`,
    );
    const href = escapeAttr(toSameOriginMediaUrl(original));
    return `<a class="forum-img-link" href="${href}" target="_blank" rel="noopener noreferrer">${next}</a>`;
  });
}
