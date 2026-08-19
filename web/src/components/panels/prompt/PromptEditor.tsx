import { memo, useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import type { UpstreamInput, MentionMarker } from '@/types/prompt';

interface PromptEditorProps {
  value: string;
  mentions: MentionMarker[];
  placeholder?: string;
  maxLength?: number;
  upstreamInputs: UpstreamInput[];
  syncKey?: string | number;
  onChange: (value: string, mentions: MentionMarker[]) => void;
  /** 编辑器前缀标签（如 720全景），渲染为不可编辑的内联 span */
  prefixTag?: { label: string; icon?: string };
}

export interface PromptEditorHandle {
  /** 在光标位置插入文本 */
  insertTextAtCursor: (text: string) => void;
  /** 在光标位置插入 HTML 标签（用于停顿/语气词）；text 参数未使用，仅为兼容旧调用保留 */
  insertTagAtCursor: (html: string, text: string) => void;
  /** 替换整个编辑器内容（用于快捷导入） */
  setValue: (text: string) => void;
  /** 获取编辑器当前纯文本（不受防抖延迟影响） */
  getValue: () => string;
  /** 获取当前 DOM 中实际存在的 mention 元数据（按 DOM 中出现顺序） */
  getMentions: () => MentionMarker[];
  /** 在编辑器内容末尾插入一个 mention（id 由编辑器内部生成） */
  insertMention: (input: { nodeId: string; label: string; nodeType: string }) => void;
  /** 删除 DOM 中所有 nodeId 匹配的 mention span */
  removeMentionByNodeId: (nodeId: string) => void;
}

const NODE_TYPE_ICON_TEXT: Record<string, string> = {
  image: '🖼',
  video: '🎬',
  text: '📝',
  script: '📜',
};

/** 命中后转为标签的语气词 */
const TONE_LABELS = ['笑声', '轻笑', '咳嗽', '清嗓子', '正常换气', '喘气', '叹气', '抽泣', '哭腔', '打哈欠', '惊讶', '低语', '呐喊', '嘟囔'];

/** mention 占位符：[[m:<id>]]，id 对应 mentions 数组里的 entry */
function mentionMarker(id: string): string {
  return `[[m:${id}]]`;
}
/** 同步生成不重复的 mention id（短随机，避免 Date.now() 冲突） */
function genMentionId(): string {
  return Math.random().toString(36).slice(2, 8);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 转义 CSS 字符串内容（<style> 是 raw text 元素，HTML 实体在其中不生效，必须用 CSS 转义防 " 和 </style> 注入） */
function escapeCssString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/</g, '\\<')
    .replace(/>/g, '\\>')
    .replace(/\n/g, '\\a ');
}

/** 从编辑器 DOM 提取纯文本：把 mention span 替换回 [[m:id]] 占位符 */
function extractPlainText(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.libtv-mention:not(.libtv-prefix-tag)').forEach((n) => {
    const id = n.getAttribute('data-mention-id') || '';
    if (id) n.replaceWith(mentionMarker(id));
  });
  // 音频标签：提取原始文本
  clone.querySelectorAll('.libtv-audio-pause').forEach((n) => {
    const val = n.getAttribute('data-value') || n.textContent?.match(/<#([\d.]+)#>/)?.[1] || '';
    n.replaceWith(`<#${val}#>`);
  });
  clone.querySelectorAll('.libtv-audio-tone').forEach((n) => {
    const label = n.getAttribute('data-label') || n.textContent?.match(/\(([^)]+)\)/)?.[1] || '';
    n.replaceWith(`(${label})`);
  });
  return clone.textContent || '';
}

/** 把 DOM 文本节点中命中的 (语气词) 转为 contenteditable=false 的 span。
 *  只遍历文本节点（跳过 mention / 音频标签内部），避免在序列化 HTML 上做正则破坏标签结构 */
function applyToneTags(el: HTMLElement): void {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
  const targets: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const textNode = node as Text;
    if (textNode.parentElement?.closest('.libtv-mention, .libtv-audio-tag')) continue;
    if (/\(([^)]+?)\)/.test(textNode.textContent || '')) targets.push(textNode);
  }
  const re = /\(([^)]+?)\)/g;
  for (const textNode of targets) {
    const text = textNode.textContent || '';
    re.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    let changed = false;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (!TONE_LABELS.includes(m[1])) continue;
      changed = true;
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const span = document.createElement('span');
      span.className = 'libtv-audio-tag libtv-audio-tone';
      span.contentEditable = 'false';
      span.setAttribute('data-tag-type', 'tone');
      const icon = document.createElement('span');
      icon.className = 'libtv-audio-tag-icon';
      icon.textContent = m[0];
      span.appendChild(icon);
      frag.appendChild(span);
      last = m.index + m[0].length;
    }
    if (!changed) continue;
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    textNode.replaceWith(frag);
  }
}

/** 获取当前光标前一个可见字符（不修改 DOM，使用 TreeWalker 向前遍历） */
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

  // 情况2：光标在元素节点中或文本节点开头 → 用 TreeWalker 向前遍历找最近的文本字符
  const walker = document.createTreeWalker(
    el,
    NodeFilter.SHOW_TEXT,
    null
  );

  // 将 walker 移到光标位置前一个节点
  let currentNode: Node | null = null;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (
      node === range.startContainer ||
      (range.startContainer as Node).contains?.(node)
    ) {
      break;
    }
    currentNode = node;
  }

  // 取 walker 停在的最后一个文本节点的末尾字符
  if (currentNode && currentNode.textContent!.length > 0) {
    return currentNode.textContent![currentNode.textContent!.length - 1];
  }

  return null;
}

/** 获取光标前最近一个未闭合 @ 之后的过滤文本；不在 @ 上下文中返回 null */
function getMentionFilterAtCursor(el: HTMLElement): string | null {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!range.collapsed || !el.contains(range.startContainer)) return null;
  if (range.startContainer.nodeType !== Node.TEXT_NODE) return null;
  const before = (range.startContainer.textContent || '').slice(0, range.startOffset);
  const atIdx = before.lastIndexOf('@');
  if (atIdx < 0) return null;
  const after = before.slice(atIdx + 1);
  // @ 之后出现空白 → 已离开引用上下文
  if (/[\s\u00A0]/.test(after)) return null;
  return after;
}

export const PromptEditor = memo(forwardRef<PromptEditorHandle, PromptEditorProps>(function PromptEditor({
  value,
  mentions,
  placeholder = '描述你想生成的内容...',
  maxLength,
  upstreamInputs,
  syncKey,
  onChange,
  prefixTag,
}, ref) {
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);

  const editorRef = useRef<HTMLDivElement>(null);
  // 防抖定时器：避免每次按键都 cloneNode 提取文本
  const emitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 用 ref 实时读取最新 props，避免防抖/立即通知的闭包捕获旧值
  const mentionsRef = useRef(mentions);
  mentionsRef.current = mentions;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const upstreamInputsRef = useRef(upstreamInputs);
  upstreamInputsRef.current = upstreamInputs;
  // 编辑器内部新插入、可能尚未同步到 props.mentions 的 mention 元数据（id → MentionMarker）
  const internalMentionsRef = useRef(new Map<string, MentionMarker>());
  // 最近一次 flushChange 提取的纯文本长度，供 beforeinput 快速路径使用（远离 maxLength 时不做全量提取）
  const lastLenRef = useRef(0);

  /** 立即从 DOM 完整提取并通知父组件（防抖到期与关键 DOM 操作共用同一逻辑） */
  const flushChange = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const text = extractPlainText(el);
    lastLenRef.current = text.length;
    // 只保留文本中仍然存在的 [[m:xxx]] 对应的 mentions
    // 防止用户通过 Ctrl+A 删除、选中删除等方式删除 mention span 后 mentions 残留
    const validIds = new Set<string>();
    const regex = /\[\[m:([^\]]+)\]\]/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      validIds.add(match[1]);
    }
    // 合并映射：props.mentions + 内部新增（props 优先），再按 DOM 中实际存在的 id 过滤
    const merged = [...mentionsRef.current];
    for (const [id, m] of internalMentionsRef.current) {
      if (!merged.some((x) => x.id === id)) merged.push(m);
    }
    onChangeRef.current(text, merged.filter((m) => validIds.has(m.id)));
  }, []);

  /** 关键 DOM 修改后同步父组件：先清掉挂起的防抖 timer，再立即完整提取+onChange */
  const commitNow = useCallback(() => {
    if (emitTimerRef.current) {
      clearTimeout(emitTimerRef.current);
      emitTimerRef.current = null;
    }
    flushChange();
  }, [flushChange]);

  /** 防抖通知父组件数据变化（避免每次按键都 cloneNode） */
  const emitChangeDebounced = useCallback(() => {
    if (emitTimerRef.current) clearTimeout(emitTimerRef.current);
    emitTimerRef.current = setTimeout(flushChange, 150);
  }, [flushChange]);

  /** 生成不与 props / 内部新增 / DOM 中现有 id 冲突的 mention id */
  const genUniqueMentionId = useCallback((): string => {
    const existing = new Set<string>(mentionsRef.current.map((m) => m.id));
    for (const id of internalMentionsRef.current.keys()) existing.add(id);
    editorRef.current?.querySelectorAll('[data-mention-id]').forEach((n) => {
      const id = n.getAttribute('data-mention-id');
      if (id) existing.add(id);
    });
    let id = genMentionId();
    while (existing.has(id)) id = genMentionId();
    return id;
  }, []);

  /** 构建 mention span 元素（光标插入与末尾插入共用同一 DOM 结构/marker 机制） */
  const buildMentionSpan = useCallback(
    (id: string, input: { nodeId: string; label: string; nodeType: string }): HTMLSpanElement => {
      const thumbUrl = upstreamInputsRef.current.find((u) => u.nodeId === input.nodeId)?.thumbnail;
      const iconPart =
        input.nodeType === 'image' && thumbUrl
          ? `<img src="${escapeHtml(thumbUrl)}" class="libtv-mention-thumb" />`
          : NODE_TYPE_ICON_TEXT[input.nodeType] || '';
      const span = document.createElement('span');
      span.className = 'libtv-mention';
      span.contentEditable = 'false';
      span.setAttribute('data-mention-id', id);
      span.setAttribute('data-node-id', input.nodeId);
      span.setAttribute('data-label', input.label);
      span.innerHTML = iconPart + '<span>' + escapeHtml(input.label) + '</span>';
      return span;
    },
    []
  );

  /** 在光标位置插入标签（替换 @）。返回生成的 mention id */
  const insertMentionSpan = useCallback(
    (input: UpstreamInput): string | null => {
      const el = editorRef.current;
      if (!el) return null;
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return null;
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

      if (!atNode) return null;

      // 生成唯一 id 并创建标签元素（整体不可编辑）
      const id = genUniqueMentionId();
      const span = buildMentionSpan(id, input);

      // 删除 @ 并插入 span
      const delRange = document.createRange();
      delRange.setStart(atNode, atOffset);
      delRange.setEnd(range.startContainer, range.startOffset);
      delRange.deleteContents();

      range.insertNode(span);

      // 标签后面插入一个不间断空格（独立文本节点，不在标签内）
      const spaceNode = document.createTextNode('\u00A0');
      span.after(spaceNode);

      // 光标放到空格文本节点内部（offset=1，即空格之后）
      // 不能用 setStartAfter，否则光标在文本节点边界，Chrome 的 IME 组合事件会异常
      range.setStart(spaceNode, 1);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);

      return id;
    },
    [buildMentionSpan, genUniqueMentionId]
  );

  // 暴露插入方法给父组件
  useImperativeHandle(ref, () => ({
    insertTextAtCursor: (text: string) => {
      const el = editorRef.current;
      if (!el) return;
      el.focus();
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      if (!el.contains(range.startContainer)) {
        const newRange = document.createRange();
        newRange.selectNodeContents(el);
        newRange.collapse(false);
        sel.removeAllRanges();
        sel.addRange(newRange);
      }
      const node = document.createTextNode(text);
      const insertRange = sel.getRangeAt(0);
      insertRange.insertNode(node);
      insertRange.setStartAfter(node);
      insertRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(insertRange);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    insertTagAtCursor: (html: string) => {
      const el = editorRef.current;
      if (!el) return;
      el.focus();
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      if (!el.contains(range.startContainer)) {
        const newRange = document.createRange();
        newRange.selectNodeContents(el);
        newRange.collapse(false);
        sel.removeAllRanges();
        sel.addRange(newRange);
      }
      // 创建临时容器解析 HTML
      const tmp = document.createElement('span');
      tmp.innerHTML = html;
      const fragment = document.createDocumentFragment();
      while (tmp.firstChild) {
        fragment.appendChild(tmp.firstChild);
      }
      const insertRange = sel.getRangeAt(0);
      insertRange.insertNode(fragment);
      insertRange.collapse(false);
      sel.removeAllRanges();
      sel.addRange(insertRange);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    setValue: (text: string) => {
      const el = editorRef.current;
      if (!el) return;
      el.innerHTML = escapeHtml(text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    getValue: () => {
      const el = editorRef.current;
      if (!el) return '';
      return extractPlainText(el);
    },
    getMentions: () => {
      const el = editorRef.current;
      if (!el) return [];
      // 按 DOM 出现顺序扫描 mention span，从合并映射（props.mentions + 内部新增）中取元数据
      const result: MentionMarker[] = [];
      const seen = new Set<string>();
      el.querySelectorAll('.libtv-mention:not(.libtv-prefix-tag)').forEach((n) => {
        const id = n.getAttribute('data-mention-id') || '';
        if (!id || seen.has(id)) return;
        seen.add(id);
        const meta =
          mentionsRef.current.find((m) => m.id === id) ?? internalMentionsRef.current.get(id);
        if (meta) result.push(meta);
      });
      return result;
    },
    insertMention: (input) => {
      const el = editorRef.current;
      if (!el) return;
      const id = genUniqueMentionId();
      const span = buildMentionSpan(id, input);
      // 追加到内容末尾（空编辑器残留的 <br> 保持在最后）
      const lastEl = el.lastElementChild;
      if (lastEl && lastEl.tagName === 'BR') {
        el.insertBefore(span, lastEl);
      } else {
        el.appendChild(span);
      }
      span.after(document.createTextNode('\u00A0'));
      internalMentionsRef.current.set(id, {
        id,
        nodeId: input.nodeId,
        label: input.label,
        nodeType: input.nodeType as MentionMarker['nodeType'],
      });
      // 先清掉挂起的防抖，再立即同步父组件
      commitNow();
    },
    removeMentionByNodeId: (nodeId) => {
      const el = editorRef.current;
      if (!el) return;
      let removed = false;
      el.querySelectorAll('.libtv-mention:not(.libtv-prefix-tag)').forEach((n) => {
        if (n.getAttribute('data-node-id') !== nodeId) return;
        // 同时移除标签后面的空格（如果存在的话）
        const next = n.nextSibling;
        if (next?.nodeType === Node.TEXT_NODE && next.textContent === '\u00A0') {
          next.remove();
        }
        n.remove();
        removed = true;
      });
      // 先清掉挂起的防抖，再立即同步父组件
      if (removed) commitNow();
    },
  }), [buildMentionSpan, commitNow, genUniqueMentionId]);

  // 下拉展示所有上游输入（包括已引用的，已引用的显示为已选状态）
  const filteredInputs = mentionFilter
    ? upstreamInputs.filter((input) => input.label.includes(mentionFilter))
    : upstreamInputs;

  /** 构建初始 HTML（只在初始化和 syncKey 变化时使用） */
  const buildHtml = useCallback((): string => {
    const thumbMap: Record<string, string | undefined> = {};
    for (const u of upstreamInputs) thumbMap[u.nodeId] = u.thumbnail;

    let html = escapeHtml(value);
    // 逐个 mention 替换所有出现的占位符（同一 mention 可能在 prompt 中出现多次）
    for (const m of mentions) {
      const marker = escapeHtml(mentionMarker(m.id));
      if (!html.includes(marker)) continue;

      const thumbUrl = thumbMap[m.nodeId];
      const iconPart =
        m.nodeType === 'image' && thumbUrl
          ? `<img src="${escapeHtml(thumbUrl)}" class="libtv-mention-thumb" />`
          : NODE_TYPE_ICON_TEXT[m.nodeType] || '';

      const spanHtml =
        `<span class="libtv-mention" contenteditable="false" data-mention-id="${escapeHtml(m.id)}" data-node-id="${m.nodeId}" data-label="${escapeHtml(m.label)}">` +
        iconPart +
        `<span>${escapeHtml(m.label)}</span>` +
        `</span>`;

      // 全局替换所有出现的占位符
      html = html.split(marker).join(spanHtml);
    }
    // 停顿标签：<#N#> → 渲染为青色标签
    html = html.replace(/&lt;#([\d.]+)#&gt;/g, (_match, val) =>
      `<span class="libtv-audio-tag libtv-audio-pause" contenteditable="false" data-tag-type="pause"><span class="libtv-audio-tag-icon">&lt;#${val}#&gt;</span></span>`
    );
    // 语气词标签：在 innerHTML 写入后由 applyToneTags 处理（只作用于文本节点，避免正则破坏 mention 属性）
    // 前缀标签（如 720全景）：即使内容为空也要渲染，不能因提前返回而跳过
    if (prefixTag) {
      const iconHtml = prefixTag.icon
        ? `<span class="libtv-mention-thumb" style="background:#bfdbfe;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:9px;color:#2563eb;">${prefixTag.icon}</span>`
        : '';
      html =
        `<span class="libtv-mention libtv-prefix-tag" contenteditable="false" style="background:#eff6ff;color:#2563eb;border-color:#bfdbfe;">` +
        iconHtml +
        `<span>${escapeHtml(prefixTag.label)}</span>` +
        `</span>` +
        (html || '<br>');
    }
    return html;
  }, [value, mentions, upstreamInputs, prefixTag]);

  /** 用户输入 */
  const handleInput = useCallback(() => {
    emitChangeDebounced();

    const el = editorRef.current;
    if (!el) return;

    // 内容被清空时重置 innerHTML（Chrome 清空 contenteditable 后会残留 <br>），保证 placeholder 的 :empty 生效
    if (el.textContent === '' && !el.querySelector('.libtv-mention, .libtv-audio-tag')) {
      el.innerHTML = '';
    }

    // @ 引用菜单：解析光标前最近一个未闭合 @ 之后的文本作为过滤词
    const filter = getMentionFilterAtCursor(el);
    if (filter === null) {
      // 光标离开 @ 上下文 → 清空过滤词并关闭菜单
      if (showMentionMenu) setShowMentionMenu(false);
      return;
    }
    if (!showMentionMenu) {
      // 仅当刚输入 @ 时唤起菜单（光标移动到历史 @ 之后不主动唤起）
      if (getCharBeforeCursor(el) !== '@') return;
      setShowMentionMenu(true);
      setSelectedIdx(0);
    }
    setMentionFilter(filter);
  }, [showMentionMenu, emitChangeDebounced]);

  /** 选择一个引用（点击或回车） */
  const handleSelectMention = useCallback(
    (input: UpstreamInput) => {
      const newId = insertMentionSpan(input);
      if (!newId) return;

      const newMention: MentionMarker = {
        id: newId,
        nodeId: input.nodeId,
        label: input.label,
        nodeType: input.nodeType,
      };
      internalMentionsRef.current.set(newId, newMention);

      setShowMentionMenu(false);
      // 插入引用后立即同步（不走防抖）：先清掉挂起的防抖 timer，避免旧闭包触发时把新 mention 冲掉
      commitNow();
    },
    [commitNow, insertMentionSpan]
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
      if (!el.contains(range.startContainer)) return;

      // 非折叠选区：检查是否包含前缀标签，包含则阻止删除
      if (!range.collapsed) {
        const ancestor = range.commonAncestorContainer;
        const containerEl = (ancestor.nodeType === Node.ELEMENT_NODE ? ancestor : ancestor.parentElement)!;
        if (containerEl.contains(el) && el.querySelector('.libtv-prefix-tag')) {
          // 检查选区范围是否覆盖了前缀标签
          const tagRect = el.querySelector('.libtv-prefix-tag')?.getBoundingClientRect();
          const rangeRects = range.getClientRects();
          for (let i = 0; i < rangeRects.length; i++) {
            if (tagRect && !(rangeRects[i].right < tagRect.left || rangeRects[i].left > tagRect.right)) {
              e.preventDefault();
              return;
            }
          }
        }
        return;
      }

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

      // 前缀标签（如720全景）不允许通过退格删除，只能通过工具栏按钮控制
      if (mentionEl.classList.contains('libtv-prefix-tag')) {
        e.preventDefault();
        return;
      }

      e.preventDefault();
      // 同时删除标签后面的空格（如果存在的话）
      const nextSibling = mentionEl.nextSibling;
      if (nextSibling?.nodeType === Node.TEXT_NODE && nextSibling.textContent === '\u00A0') {
        nextSibling.remove();
      }
      mentionEl.remove();

      // 先清掉挂起的防抖，再立即完整提取+onChange（mentions 由 flushChange 实时合并过滤）
      commitNow();
    },
    [commitNow, showMentionMenu, filteredInputs, selectedIdx, handleSelectMention]
  );

  /** 输入前长度限制（统计口径与父组件一致：extractPlainText 的纯文本长度） */
  const handleBeforeInput = useCallback(
    (e: React.FormEvent<HTMLDivElement>) => {
      if (maxLength == null) return;
      const ev = e.nativeEvent as InputEvent;
      // 删除类输入不限制；粘贴/拖放由 onPaste 截断处理
      if (ev.inputType?.startsWith('delete')) return;
      if (ev.inputType === 'insertFromPaste' || ev.inputType === 'insertFromDrop') return;
      if (!ev.inputType?.startsWith('insert')) return;
      const el = editorRef.current;
      if (!el) return;
      // 快速路径：远离上限时直接放行，避免每次按键都全量克隆 DOM 提取文本。
      // 余量 16 覆盖 IME 组合串/自动替换等一次插入多字符的情况，接近上限时才做精确检查。
      if (lastLenRef.current + 16 < maxLength) return;
      // 已达上限且本次输入会增加字符 → 阻止
      if (extractPlainText(el).length >= maxLength) {
        e.preventDefault();
      }
    },
    [maxLength]
  );

  /** 粘贴时按 maxLength 截断（只插入纯文本） */
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      if (maxLength == null) return;
      e.preventDefault();
      const el = editorRef.current;
      if (!el) return;
      const text = e.clipboardData.getData('text/plain');
      if (!text) return;
      const sel = window.getSelection();
      let selectedLen = 0;
      if (sel && sel.rangeCount) {
        const range = sel.getRangeAt(0);
        if (el.contains(range.startContainer)) selectedLen = range.toString().length;
      }
      const remaining = maxLength - (extractPlainText(el).length - selectedLen);
      if (remaining <= 0) return;
      document.execCommand('insertText', false, text.slice(0, remaining));
    },
    [maxLength]
  );

  // ESC 关闭菜单
  useEffect(() => {
    if (!showMentionMenu) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowMentionMenu(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showMentionMenu]);

  // 卸载时清理挂起的防抖 timer（设计意图：未同步的暂存输入直接丢弃，不做卸载 flush）
  useEffect(() => {
    return () => {
      if (emitTimerRef.current) clearTimeout(emitTimerRef.current);
    };
  }, []);

  // 挂载和 syncKey 变化时重建 DOM（非受控：value prop 仅在此生效，之后 DOM 是唯一事实来源）
  const isFirstSyncRef = useRef(true);
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    el.innerHTML = buildHtml();
    applyToneTags(el);
    if (isFirstSyncRef.current) {
      isFirstSyncRef.current = false;
      return;
    }
    // syncKey 变化导致的重建：清掉挂起的防抖并同步一次父组件状态
    commitNow();
  }, [syncKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // prefixTag 变化时（如切换全景模式），动态插入/移除前缀标签
  const prevPrefixTagRef = useRef(prefixTag);
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;

    // 前缀标签未变化则跳过
    if (
      (prevPrefixTagRef.current === undefined && prefixTag === undefined) ||
      (prevPrefixTagRef.current !== undefined && prefixTag !== undefined &&
       prevPrefixTagRef.current?.label === prefixTag.label)
    ) {
      prevPrefixTagRef.current = prefixTag;
      return;
    }
    prevPrefixTagRef.current = prefixTag;

    // 移除已有的前缀标签
    const existing = el.querySelector('.libtv-prefix-tag');
    if (existing) existing.remove();

    // 需要新增前缀标签
    if (prefixTag) {
      const iconHtml = prefixTag.icon
        ? `<span class="libtv-mention-thumb" style="background:#bfdbfe;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:9px;color:#2563eb;">${prefixTag.icon}</span>`
        : '';
      const span = document.createElement('span');
      span.className = 'libtv-mention libtv-prefix-tag';
      span.contentEditable = 'false';
      span.style.cssText = 'background:#eff6ff;color:#2563eb;border-color:#bfdbfe;';
      span.setAttribute('data-label', prefixTag.label);
      span.innerHTML = iconHtml + `<span>${escapeHtml(prefixTag.label)}</span>`;

      // 如果编辑器为空，插入标签+换行；否则插到最前面
      if (el.childNodes.length === 0 || (el.childNodes.length === 1 && el.textContent?.trim() === '')) {
        el.innerHTML = '';
        el.appendChild(span);
        el.appendChild(document.createElement('br'));
      } else {
        el.insertBefore(span, el.firstChild);
      }
    }
  }, [prefixTag]);

  return (
    <div className="relative flex-1 min-h-[72px] py-1">
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onBeforeInput={handleBeforeInput}
        onPaste={handlePaste}
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
        .libtv-mention-space {
          display: inline;
          white-space: pre;
        }
        .libtv-audio-tag {
          display: inline-flex;
          align-items: center;
          padding: 0 5px;
          margin: 0 2px;
          border-radius: 4px;
          font-size: 11px;
          line-height: 18px;
          vertical-align: middle;
          white-space: nowrap;
          user-select: none;
        }
        .libtv-audio-pause {
          background: #ecfeff;
          color: #0891b2;
          border: 1px solid #a5f3fc;
        }
        .libtv-audio-pause .libtv-audio-tag-icon {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 10px;
          font-weight: 600;
        }
        .libtv-audio-tone {
          background: #fff7ed;
          color: #c2410c;
          border: 1px solid #fed7aa;
        }
        .libtv-audio-tone .libtv-audio-tag-icon {
          font-size: 11px;
          font-weight: 500;
        }
        [contenteditable]:empty::before {
          content: "${escapeCssString(placeholder)}";
          color: #9ca3af;
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}));
