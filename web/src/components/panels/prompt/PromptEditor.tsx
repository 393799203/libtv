import { memo, useState, useRef, useCallback, useEffect } from 'react';
import type { UpstreamInput, MentionMarker } from '@/types/prompt';

interface PromptEditorProps {
  value: string;
  mentions: MentionMarker[];
  placeholder?: string;
  maxLength?: number;
  upstreamInputs: UpstreamInput[];
  syncKey?: string | number;
  onChange: (value: string, mentions: MentionMarker[]) => void;
}

const NODE_TYPE_ICON_TEXT: Record<string, string> = {
  image: '🖼',
  video: '🎬',
  text: '📝',
  script: '📜',
};

const MARKER = '\uFFFC';

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 从编辑器 DOM 提取纯文本 */
function extractPlainText(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.libtv-mention').forEach((n) => {
    n.replaceWith(`${MARKER}${n.getAttribute('data-label') || ''}${MARKER}`);
  });
  return clone.textContent || '';
}

/** 获取当前光标前一个可见字符（跳过不可见的 mention span） */
function getCharBeforeCursor(el: HTMLElement): string | null {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer)) return null;

  // 情况1：光标在文本节点中间或末尾
  if (
    range.startContainer.nodeType === Node.TEXT_NODE &&
    range.startOffset > 0
  ) {
    return range.startContainer.textContent![range.startOffset - 1];
  }

  // 情况2：光标在元素节点中 → 向前找最近的文本内容
  // 从光标位置往前遍历，找到最近的文本字符
  const preRange = range.cloneRange();
  el.appendChild(document.createTextNode('')); // 临时锚点
  preRange.setEndAfter(el.lastChild!);
  const textBefore = preRange.toString();
  el.lastChild?.remove(); // 清理临时锚点

  if (textBefore.length > 0) {
    return textBefore[textBefore.length - 1];
  }

  return null;
}

export const PromptEditor = memo<PromptEditorProps>(function PromptEditor({
  value,
  mentions,
  placeholder = '描述你想生成的内容...',
  upstreamInputs,
  syncKey,
  onChange,
}) {
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);

  const editorRef = useRef<HTMLDivElement>(null);

  // 可用的上游输入（排除当前已引用的）
  const availableInputs = upstreamInputs.filter(
    (input) => !mentions.some((m) => m.nodeId === input.nodeId)
  );
  const filteredInputs = mentionFilter
    ? availableInputs.filter((input) => input.label.includes(mentionFilter))
    : availableInputs;

  /** 构建初始 HTML（只在初始化时使用） */
  const buildHtml = useCallback((): string => {
    if (!value && !mentions.length) return '';
    const thumbMap: Record<string, string | undefined> = {};
    for (const u of upstreamInputs) thumbMap[u.nodeId] = u.thumbnail;

    let html = escapeHtml(value);
    const sorted = [...mentions].sort(
      (a, b) =>
        value.lastIndexOf(`${MARKER}${b.label}${MARKER}`) -
        value.lastIndexOf(`${MARKER}${a.label}${MARKER}`)
    );
    for (const m of sorted) {
      const marker = `${MARKER}${m.label}${MARKER}`;
      const idx = html.lastIndexOf(escapeHtml(marker));
      if (idx === -1) continue;

      const thumbUrl = thumbMap[m.nodeId];
      const iconPart =
        m.nodeType === 'image' && thumbUrl
          ? `<img src="${escapeHtml(thumbUrl)}" class="libtv-mention-thumb" />`
          : NODE_TYPE_ICON_TEXT[m.nodeType] || '';

      html =
        html.slice(0, idx) +
        `<span class="libtv-mention" contenteditable="false" data-node-id="${m.nodeId}" data-label="${escapeHtml(m.label)}">` +
        iconPart +
        `<span>${escapeHtml(m.label)}</span>` +
        `</span>` +
        html.slice(idx + marker.length);
    }
    return html;
  }, [value, mentions, upstreamInputs]);

  /** 在光标位置插入标签（替换 @） */
  function insertMentionSpan(input: UpstreamInput): boolean {
    const el = editorRef.current;
    if (!el) return false;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return false;
    const range = sel.getRangeAt(0);

    // 找 @ 字符位置
    let atNode: Node | null = null;
    let atOffset = 0;

    if (
      range.startContainer.nodeType === Node.TEXT_NODE &&
      range.startOffset > 0 &&
      range.startContainer.textContent?.[range.startOffset - 1] === '@'
    ) {
      atNode = range.startContainer;
      atOffset = range.startOffset - 1;
    }

    if (!atNode) return false;

    // 创建标签元素
    const thumbUrl = upstreamInputs.find((u) => u.nodeId === input.nodeId)?.thumbnail;
    const iconPart =
      input.nodeType === 'image' && thumbUrl
        ? `<img src="${escapeHtml(thumbUrl)}" class="libtv-mention-thumb" />`
        : NODE_TYPE_ICON_TEXT[input.nodeType] || '';

    const span = document.createElement('span');
    span.className = 'libtv-mention';
    span.contentEditable = 'false';
    span.setAttribute('data-node-id', input.nodeId);
    span.setAttribute('data-label', input.label);
    span.innerHTML = iconPart + '<span>' + escapeHtml(input.label) + '</span>';

    // 删除 @ 并插入 span
    const delRange = document.createRange();
    delRange.setStart(atNode, atOffset);
    delRange.setEnd(range.startContainer, range.startOffset);
    delRange.deleteContents();

    range.insertNode(span);

    // 标签后面自动加一个空格（用不间断空格防止被合并）
    const spaceNode = document.createTextNode('\u00A0');
    range.setStartAfter(span);
    range.insertNode(spaceNode);

    // 光标放到空格后面
    range.setStartAfter(spaceNode);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);

    return true;
  }

  /** 通知父组件数据变化 */
  function emitChange() {
    const el = editorRef.current;
    if (!el) return;
    onChange(extractPlainText(el), mentions);
  }

  /** 用户输入 */
  const handleInput = useCallback(() => {
    emitChange();

    const el = editorRef.current;
    if (!el) return;

    const charBefore = getCharBeforeCursor(el);

    // 输入了 @ → 唤起菜单
    if (charBefore === '@') {
      setShowMentionMenu(true);
      setMentionFilter('');
      setSelectedIdx(0);
      return;
    }

    // 菜单打开时：输入空白符则关闭
    if (showMentionMenu && charBefore && /[\s\n]/.test(charBefore)) {
      setShowMentionMenu(false);
    }
  }, [mentions, showMentionMenu, onChange]);

  /** 选择一个引用（点击或回车） */
  const handleSelectMention = useCallback(
    (input: UpstreamInput) => {
      if (!insertMentionSpan(input)) return;

      const newMention: MentionMarker = {
        id: `${Date.now()}`,
        nodeId: input.nodeId,
        label: input.label,
        nodeType: input.nodeType,
      };

      setShowMentionMenu(false);
      onChange(extractPlainText(editorRef.current!), [...mentions, newMention]);
    },
    [mentions, onChange, upstreamInputs]
  );

  /** 键盘事件 */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // 菜单导航
      if (showMentionMenu && filteredInputs.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIdx((p) => Math.min(p + 1, filteredInputs.length - 1));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedIdx((p) => Math.max(p - 1, 0));
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          handleSelectMention(filteredInputs[selectedIdx]);
          return;
        }
      }

      // 退格键整删标签
      if (e.key !== 'Backspace') return;
      const el = editorRef.current;
      if (!el) return;
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      if (!range.collapsed) return;
      if (!el.contains(range.startContainer)) return;

      // 查找光标前面最近的 mention span
      let mentionEl: Element | null = null;

      // 方法1：光标在文本节点开头 → 看 previousSibling 链
      if (range.startContainer.nodeType === Node.TEXT_NODE) {
        if (range.startOffset === 0) {
          // 文本节点开头 → 检查前面的兄弟节点
          let prev: Node | null = range.startContainer.previousSibling;
          while (prev) {
            if (prev.nodeType === Node.ELEMENT_NODE && (prev as Element).classList.contains('libtv-mention')) {
              mentionEl = prev as Element;
              break;
            }
            if (prev.nodeType === Node.TEXT_NODE && prev.textContent?.trim()) {
              break; // 前面有普通文字，不删
            }
            prev = prev.previousSibling;
          }
        } else {
          // 文本节点中间 → 前面有普通字符，不是在删标签
          // 但如果前面只有空白字符，继续向前查找
          const text = range.startContainer.textContent || '';
          let i = range.startOffset - 1;
          while (i >= 0 && /[\s\u00A0]/.test(text[i])) i--;
          if (i < 0) {
            // 前面全是空白或到头了 → 继续查 previousSibling
            let prev: Node | null = range.startContainer.previousSibling;
            while (prev) {
              if (prev.nodeType === Node.ELEMENT_NODE && (prev as Element).classList.contains('libtv-mention')) {
                mentionEl = prev as Element;
                break;
              }
              if (prev.nodeType === Node.TEXT_NODE && prev.textContent?.trim()) {
                break;
              }
              prev = prev.previousSibling;
            }
          }
        }
      } else if (range.startContainer.nodeType === Node.ELEMENT_NODE) {
        // 光标在元素边界 → 检查前一个子节点
        const offset = range.startOffset;
        const container = range.startContainer as Element;
        if (offset > 0) {
          let prev = container.childNodes[offset - 1];
          while (prev) {
            if (prev.nodeType === Node.ELEMENT_NODE && (prev as Element).classList.contains('libtv-mention')) {
              mentionEl = prev as Element;
              break;
            }
            if (prev.nodeType === Node.TEXT_NODE && prev.textContent?.trim()) {
              break;
            }
            prev = prev.previousSibling;
          }
        }
      }

      if (!mentionEl) return;

      e.preventDefault();
      const label = mentionEl.getAttribute('data-label') || '';
      mentionEl.remove();

      onChange(
        extractPlainText(el),
        mentions.filter((m) => m.label !== label)
      );
    },
    [mentions, onChange, showMentionMenu, filteredInputs, selectedIdx, handleSelectMention]
  );

  // ESC 关闭菜单
  useEffect(() => {
    if (!showMentionMenu) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowMentionMenu(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showMentionMenu]);

  // 只在挂载和 syncKey 变化时渲染初始 HTML
  const needsInitRef = useRef(true);
  useEffect(() => {
    if (!needsInitRef.current) return;
    const el = editorRef.current;
    if (!el) return;
    el.innerHTML = buildHtml();
    needsInitRef.current = false;
  }, [syncKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative flex-1 min-h-[72px] py-1">
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        className="w-full text-[14px] text-gray-800 border-0 outline-none resize-none bg-transparent leading-[1.7] min-h-[72px]"
        style={{ minHeight: 72 }}
      />

      {/* @ 引用下拉菜单 */}
      {showMentionMenu && filteredInputs.length > 0 && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setShowMentionMenu(false)} />
          <div className="absolute left-0 top-0 mt-9 w-52 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden z-30">
            <div className="max-h-[220px] overflow-y-auto py-1">
              {filteredInputs.map((input, idx) => (
                <button
                  key={input.nodeId}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 transition-colors text-left cursor-pointer ${
                    idx === selectedIdx ? 'bg-blue-50' : 'hover:bg-gray-50'
                  }`}
                  onClick={() => handleSelectMention(input)}
                  onMouseEnter={() => setSelectedIdx(idx)}
                >
                  {input.thumbnail ? (
                    <img src={input.thumbnail} alt="" className="w-8 h-8 rounded-lg object-cover bg-gray-100 flex-shrink-0" />
                  ) : (
                    <span className="w-8 h-8 rounded-lg bg-gray-50 border border-gray-200 flex items-center justify-center flex-shrink-0 text-gray-400 text-sm">
                      {NODE_TYPE_ICON_TEXT[input.nodeType]}
                    </span>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-gray-700 font-medium">{input.label}</div>
                    {input.textSnippet && (
                      <div className="text-[11px] text-gray-400 truncate mt-0.5">{input.textSnippet}</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <style>{`
        .libtv-mention {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          padding: 1px 6px;
          margin: 0 2px;
          background: #f3f4f6;
          color: #374151;
          border-radius: 6px;
          font-size: 12px;
          line-height: 20px;
          vertical-align: middle;
          white-space: nowrap;
          user-select: none;
        }
        .libtv-mention-thumb {
          width: 16px;
          height: 16px;
          border-radius: 3px;
          object-fit: cover;
          display: inline-block;
          flex-shrink: 0;
        }
        [contenteditable]:empty::before {
          content: "${escapeHtml(placeholder)}";
          color: #9ca3af;
          pointer-events: none;
        }
      `}</style>
    </div>
  );
});
