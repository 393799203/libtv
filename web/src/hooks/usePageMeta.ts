import { useEffect } from 'react';

/**
 * 站点根地址。与 index.html 里的 JSON-LD、web/public/robots.txt 的 Sitemap 保持同一个域名。
 */
export const SITE_ORIGIN = 'https://manwa.yunqueai.cloud';

/** 站点名：标题里没带站点名时自动追加 */
const SITE_NAME = '漫蛙';

export interface PageMeta {
  /** 页面标题（浏览器标签 + 搜索结果标题）；未包含站点名会自动补「 · 漫蛙」 */
  title: string;
  /** 页面描述：搜索结果摘要的主要来源，写清楚"这页有什么" */
  description?: string;
  /** canonical / og:url 用的路径（默认取当前 URL 的 pathname+search） */
  path?: string;
  /** og:type，作品/帖子详情页用 article */
  type?: 'website' | 'article' | 'video.other';
  /** 需登录的应用页：标 noindex，并且不写 canonical（私有 URL 不该成为规范化目标） */
  noindex?: boolean;
}

function ensureMeta(attr: 'name' | 'property', key: string): HTMLMetaElement {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  return el;
}

function ensureLink(rel: string): HTMLLinkElement {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  return el;
}

/**
 * 按路由设置标题 / 描述 / canonical。
 *
 * 为什么需要它：全站共用一份静态 index.html，不这么做的话每个页面（首页、论坛、帖子、
 * 作品详情）在搜索结果里都会是同一个标题和同一段摘要 —— 既不利于收录，也没法让人点。
 *
 * canonical 与 og:url 只在**公开可读**的页面调用（首页 / 论坛 / 帖子 / 作品详情），
 * 需登录的应用页不调用：它们的 HTML 与首页相同，乱标 canonical 反而会互相打架；
 * 那些页面由 nginx 的 X-Robots-Tag: noindex 明确排除在索引外。
 */
export function usePageMeta(meta: PageMeta) {
  const { title, description, path, type, noindex } = meta;

  useEffect(() => {
    const fullTitle = title.includes(SITE_NAME) ? title : `${title} · ${SITE_NAME}`;
    document.title = fullTitle;

    if (noindex) {
      // 应用内页：明确 noindex，并把可能残留自上一个公开页的 canonical / og:url 去掉
      ensureMeta('name', 'robots').setAttribute('content', 'noindex,nofollow');
      document.head.querySelector('link[rel="canonical"]')?.remove();
      ensureMeta('property', 'og:url').remove();
      ensureMeta('property', 'og:title').setAttribute('content', fullTitle);
      return;
    }

    const url = SITE_ORIGIN + (path ?? window.location.pathname + window.location.search);
    ensureLink('canonical').setAttribute('href', url);

    ensureMeta('name', 'robots').setAttribute('content', 'index,follow,max-image-preview:large');
    if (description) {
      ensureMeta('name', 'description').setAttribute('content', description);
      ensureMeta('property', 'og:description').setAttribute('content', description);
      ensureMeta('name', 'twitter:description').setAttribute('content', description);
    }
    ensureMeta('property', 'og:title').setAttribute('content', fullTitle);
    ensureMeta('name', 'twitter:title').setAttribute('content', fullTitle);
    ensureMeta('property', 'og:url').setAttribute('content', url);
    ensureMeta('property', 'og:type').setAttribute('content', type ?? 'website');
    ensureMeta('property', 'og:site_name').setAttribute('content', SITE_NAME);
  }, [title, description, path, type, noindex]);
}