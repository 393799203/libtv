/**
 * 把文本里命中的关键词高亮（大小写不敏感，与后端 ILIKE 行为一致）。
 *
 * 关键词必须先转义正则元字符：用户搜 "(" 或 "[" 这类字符时，
 * 未转义会直接抛 RegExp 语法错误，整页白屏。
 */
export function Highlight({ text, keyword }: { text: string; keyword?: string }) {
  const kw = (keyword || '').trim();
  if (!kw) return <>{text}</>;

  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 捕获组保留分隔符，split 结果为 [普通, 命中, 普通, 命中, ...]，奇数下标即命中
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));

  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-sm bg-amber-100 px-0.5 text-amber-900">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
