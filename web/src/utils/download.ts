/**
 * 下载远程文件（fetch → blob → a.download）
 * 适用于同源 /media、/uploads 资源；跨域资源需服务端允许 CORS
 */
export async function downloadFile(url: string, filename?: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`下载失败: ${res.status}`);
  }
  const blob = await res.blob();
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
