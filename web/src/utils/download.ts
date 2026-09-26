/**
 * 把媒体地址转成同源地址。
 *
 * 对象存储（天翼云 ZOS）的公网域名**不返回 Access-Control-Allow-Origin**
 * （OPTIONS 预检直接 403），浏览器 fetch 跨域取对象会被 CORS 拦掉，
 * 因此统一改走同源代理 /media/*（后端从存储直读，支持 Range）。
 * 同源地址（/media、/uploads）原样返回。
 */
export function toSameOriginMediaUrl(url: string): string {
  try {
    const u = new URL(url, window.location.origin);
    if (u.origin === window.location.origin) return u.pathname + u.search;
    // 跨域即视为对象存储：其 pathname 就是 objectName（bucket 在子域名里）
    return `/media${u.pathname}`;
  } catch {
    return url;
  }
}

/**
 * 下载远程文件（fetch → blob → a.download）
 * 跨域对象存储会先退回同源 /media 代理；外链资源再回退直连（其域名若允许 CORS 仍可用）
 */
export async function downloadFile(url: string, filename?: string): Promise<void> {
  const proxied = toSameOriginMediaUrl(url);
  const candidates = proxied === url ? [url] : [proxied, url];

  let blob: Blob | null = null;
  let lastErr: unknown = null;
  for (const target of candidates) {
    try {
      const res = await fetch(target);
      if (!res.ok) {
        lastErr = new Error(`下载失败: ${res.status}`);
        continue;
      }
      blob = await res.blob();
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!blob) {
    throw lastErr instanceof Error ? lastErr : new Error('下载失败');
  }
  const objectUrl = URL.createObjectURL(blob);

  // 未指定文件名时从 URL 路径提取（忽略 query 参数）
  let name = filename;
  if (!name) {
    try {
      const pathname = new URL(url, window.location.origin).pathname;
      name = pathname.split('/').pop() || 'download';
    } catch {
      name = 'download';
    }
  }

  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}
