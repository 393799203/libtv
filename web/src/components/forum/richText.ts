/**
 * 富文本内容判定与摘要工具。
 *
 * 关键点：判断正文是否为空**不能只看有没有文字** —— 只插一张图、一个字不打，
 * 同样是合法内容（用户发图配表情、发一张截图反馈 bug 都是常见用法）。
 * 服务端用同一口径判断，见 server/internal/service/forum_service.go 的 forumContentEmpty。
 */

const MEDIA_TAG_RE = /<(img|video|audio)\b/i;

/** 富文本是否为空：纯文本为空、且不含图片/视频/音频，才算空 */
export function isRichTextEmpty(html: string): boolean {
  if (!html) return true;
  const text = html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
  if (text) return false;
  return !MEDIA_TAG_RE.test(html);
}

/** 是否含媒体元素（用于列表摘要：纯图片帖显示「［图片］」而不是「无正文」） */
export function hasRichMedia(html: string): boolean {
  return MEDIA_TAG_RE.test(html || '');
}

/** HTML → 纯文本（列表摘要用；正文渲染仍走 innerHTML，不经此处） */
export function plainText(html: string): string {
  return (html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 列表摘要：命中关键词时以它为中心截一段，否则取开头。
 * 命中词在正文中后段时，光取开头会让用户看不到为什么这条被搜出来。
 */
export function excerptAround(html: string, keyword = '', max = 110): string {
  const text = plainText(html);
  if (text.length <= max) return text;
  const kw = keyword.trim().toLowerCase();
  const at = kw ? text.toLowerCase().indexOf(kw) : -1;
  if (at < 0) return `${text.slice(0, max)}…`;
  const start = Math.max(0, at - Math.floor(max / 3));
  const end = Math.min(text.length, start + max);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}
