import { memo, useState, useRef, useCallback, useEffect } from 'react';
import {
  PictureOutlined,
  VideoCameraOutlined,
  FileTextOutlined,
  CodeOutlined,
} from '@ant-design/icons';
import type { UpstreamInput, MentionMarker } from '@/types/prompt';

interface PromptEditorProps {
  value: string;
  mentions: MentionMarker[];
  placeholder?: string;
  maxLength?: number;
  upstreamInputs: UpstreamInput[];
  onChange: (value: string, mentions: MentionMarker[]) => void;
}

const NODE_TYPE_ICON: Record<UpstreamInput['nodeType'], React.ReactNode> = {
  image: <PictureOutlined className="text-[11px]" />,
  video: <VideoCameraOutlined className="text-[11px]" />,
  text: <FileTextOutlined className="text-[11px]" />,
  script: <CodeOutlined className="text-[11px]" />,
};

export const PromptEditor = memo<PromptEditorProps>(function PromptEditor({
  value,
  mentions,
  placeholder = '描述你想生成的内容...',
  maxLength = 2000,
  upstreamInputs,
  onChange,
}) {
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionPos, setMentionPos] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 过滤可用的上游输入（排除已引用的）
  const availableInputs = upstreamInputs.filter(
    (input) => !mentions.some((m) => m.nodeId === input.nodeId)
  );

  const filteredInputs = mentionFilter
    ? availableInputs.filter((input) => input.label.includes(mentionFilter))
    : availableInputs;

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      const cursorPos = e.target.selectionStart;

      // 检测 @ 触发
      if (
        newValue[cursorPos - 1] === '@' &&
        (cursorPos === 1 || newValue[cursorPos - 2] === ' ' || newValue[cursorPos - 2] === '\n')
      ) {
        setShowMentionMenu(true);
        setMentionPos(cursorPos - 1);
        setMentionFilter('');
        onChange(newValue, mentions);
        return;
      }

      if (showMentionMenu && cursorPos > mentionPos + 1) {
        const filterText = newValue.slice(mentionPos + 1, cursorPos);
        setMentionFilter(filterText);
      }

      if (showMentionMenu && cursorPos <= mentionPos) {
        setShowMentionMenu(false);
      }

      onChange(newValue, mentions);
    },
    [mentions, showMentionMenu, mentionPos, onChange]
  );

  const handleSelectMention = useCallback(
    (input: UpstreamInput) => {
      const newMention: MentionMarker = {
        id: `${Date.now()}`,
        nodeId: input.nodeId,
        label: input.label,
        nodeType: input.nodeType,
      };

      const before = value.slice(0, mentionPos);
      const after = value.slice(mentionPos + 1 + mentionFilter.length);
      const newValue = before + ` ${after}`;

      setShowMentionMenu(false);
      onChange(newValue, [...mentions, newMention]);

      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(before.length + 1, before.length + 1);
        }
      }, 0);
    },
    [value, mentionPos, mentionFilter, mentions, onChange]
  );

  useEffect(() => {
    if (!showMentionMenu) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowMentionMenu(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showMentionMenu]);

  return (
    <div className="relative flex-1 min-h-[72px] py-1">
      {/* 文本编辑区 */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        maxLength={maxLength}
        className="w-full text-[14px] text-gray-800 placeholder:text-gray-400 border-0 outline-none resize-none bg-transparent leading-[1.7]"
        style={{ minHeight: 72 }}
        rows={3}
      />

      {/* @ 引用下拉菜单 */}
      {showMentionMenu && filteredInputs.length > 0 && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setShowMentionMenu(false)} />
          <div className="absolute left-0 top-0 mt-9 w-60 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden z-30">
            <div className="max-h-[220px] overflow-y-auto py-1">
              {filteredInputs.map((input) => (
                <button
                  key={input.nodeId}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors text-left"
                  onClick={() => handleSelectMention(input)}
                >
                  {input.thumbnail ? (
                    <img src={input.thumbnail} alt="" className="w-8 h-8 rounded-lg object-cover bg-gray-100 flex-shrink-0" />
                  ) : (
                    <span className="w-8 h-8 rounded-lg bg-gray-50 border border-gray-200 flex items-center justify-center flex-shrink-0 text-gray-400">
                      {NODE_TYPE_ICON[input.nodeType]}
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

      {/* 已引用标签：内联展示在编辑区下方 */}
      {mentions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-2">
          {mentions.map((m) => (
            <span
              key={m.id}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[12px]"
            >
              {NODE_TYPE_ICON[m.nodeType]}
              {m.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
});
