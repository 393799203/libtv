/**
 * 论坛帖子 / 回复的客户端 id。
 *
 * 为什么由前端先生成：发帖时图片、视频是**先于帖子**上传的，那一刻服务端还没有帖子 id。
 * 打开编辑器就先造一个 id，上传物落到 forum/<id>/ 下，发帖时把同一个 id 交上去，
 * 于是「删帖 = 删这个目录」，帖子删掉媒体必定跟着删干净，不会留下孤儿文件。
 *
 * 不这么做的话，删除时只能解析正文里的 URL 再反查对象，还得处理
 * 「同一个文件被多个帖子引用」的情况（上传按内容哈希命名，同图只会存一份）——
 * 既有误删风险，也会漏删。
 *
 * 格式必须是标准 UUID：服务端会校验（它会被拼进存储目录名，不能允许 ../ 之类）。
 */
export function newContentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // 兜底：极老的浏览器没有 randomUUID，手写一个 UUID v4
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}
