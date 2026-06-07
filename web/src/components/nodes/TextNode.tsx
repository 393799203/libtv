import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { NodeProps, Node } from '@xyflow/react';
import { NodeResizer, useReactFlow, Handle, Position } from '@xyflow/react';
import ReactMarkdown from 'react-markdown';
import {
  FileTextOutlined,
  BoldOutlined,
  ItalicOutlined,
  StrikethroughOutlined,
  UnorderedListOutlined,
  OrderedListOutlined,
  MinusOutlined,
  LinkOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import type { TextNodeData } from '@/types/canvas';
import { useCanvasStore } from '@/stores/canvasStore';

type TextNodeType = Node<TextNodeData, 'text'>;

// 工具栏独立组件，避免 TextNode 重渲染时重建
const Toolbar = memo(function Toolbar({
  position,
  onExit,
  onFormat,
}: {
  position: { x: number; y: number };
  onExit: () => void;
  onFormat: (before: string, after?: string) => void;
}) {
  return createPortal(
    <div
      className="fixed flex items-center gap-0.5 px-1.5 py-1 bg-white rounded border border-gray-200 shadow-md z-[9999]"
      style={{
        left: position.x,
        top: position.y - 36,
        transform: 'translateX(-50%)',
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <button onClick={onExit} className="p-1 hover:bg-gray-100 rounded" title="关闭编辑">
        <CloseOutlined className="text-gray-500 text-xs" />
      </button>
      <div className="w-px h-3 bg-gray-200 mx-0.5" />
      <button onClick={() => onFormat('# ')} className="p-1 hover:bg-gray-100 rounded text-xs font-bold text-gray-600" title="标题1">H1</button>
      <button onClick={() => onFormat('## ')} className="p-1 hover:bg-gray-100 rounded text-xs font-bold text-gray-600" title="标题2">H2</button>
      <button onClick={() => onFormat('### ')} className="p-1 hover:bg-gray-100 rounded text-xs font-bold text-gray-600" title="标题3">H3</button>
      <div className="w-px h-3 bg-gray-200 mx-0.5" />
      <button onClick={() => onFormat('**', '**')} className="p-1 hover:bg-gray-100 rounded" title="加粗">
        <BoldOutlined className="text-gray-600 text-xs" />
      </button>
      <button onClick={() => onFormat('*', '*')} className="p-1 hover:bg-gray-100 rounded" title="斜体">
        <ItalicOutlined className="text-gray-600 text-xs" />
      </button>
      <button onClick={() => onFormat('~~', '~~')} className="p-1 hover:bg-gray-100 rounded" title="删除线">
        <StrikethroughOutlined className="text-gray-600 text-xs" />
      </button>
      <div className="w-px h-3 bg-gray-200 mx-0.5" />
      <button onClick={() => onFormat('- ')} className="p-1 hover:bg-gray-100 rounded" title="无序列表">
        <UnorderedListOutlined className="text-gray-600 text-xs" />
      </button>
      <button onClick={() => onFormat('1. ')} className="p-1 hover:bg-gray-100 rounded" title="有序列表">
        <OrderedListOutlined className="text-gray-600 text-xs" />
      </button>
      <div className="w-px h-3 bg-gray-200 mx-0.5" />
      <button onClick={() => onFormat('---\n')} className="p-1 hover:bg-gray-100 rounded" title="分割线">
        <MinusOutlined className="text-gray-600 text-xs" />
      </button>
      <button onClick={() => onFormat('[文字](url)')} className="p-1 hover:bg-gray-100 rounded" title="链接">
        <LinkOutlined className="text-gray-600 text-xs" />
      </button>
    </div>,
    document.body
  );
});

export const TextNode = memo<NodeProps<TextNodeType>>(function TextNode({ id, data, selected }) {
  const [isEditing, setIsEditing] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [label, setLabel] = useState(data.label || '文本');
  const [content, setContent] = useState(data.content || '');
  const [toolbarPos, setToolbarPos] = useState({ x: 0, y: 0 });
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const { getNode, flowToScreenPosition } = useReactFlow();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const labelInputRef = useRef<HTMLInputElement>(null);

  // 同步外部 data（编辑/重命名时不同步，避免覆盖用户输入）
  useEffect(() => {
    if (!isRenaming) setLabel(data.label || '文本');
  }, [data.label, isRenaming]);

  useEffect(() => {
    if (!isEditing) setContent(data.content || '');
  }, [data.content, isEditing]);

  // 编辑模式时计算工具栏位置（只在进入编辑时绑定）
  useEffect(() => {
    if (!isEditing) return;
    const update = () => {
      const node = getNode(id);
      if (!node || !node.measured) return;
      const screenPos = flowToScreenPosition({
        x: node.position.x,
        y: node.position.y - (node.measured.height || 200) / 2,
      });
      setToolbarPos({ x: screenPos.x, y: screenPos.y });
    };
    update();
    // 用 requestAnimationFrame 代替 setInterval，更省性能
    let rafId: number;
    const loop = () => {
      update();
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [isEditing, id, getNode, flowToScreenPosition]);

  // 自动聚焦
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isEditing]);

  useEffect(() => {
    if (isRenaming && labelInputRef.current) {
      labelInputRef.current.focus();
      labelInputRef.current.select();
    }
  }, [isRenaming]);

  // 进入编辑模式
  const handleDoubleClick = useCallback(() => {
    setIsEditing(true);
    updateNodeData(id, { isEditing: true });
  }, [id, updateNodeData]);

  // 退出编辑模式
  const exitEditing = useCallback(() => {
    setIsEditing(false);
    updateNodeData(id, { isEditing: false });
  }, [id, updateNodeData]);

  // 内容变更 - 节流更新 store
  const lastStoreUpdate = useRef(0);
  const handleContentChange = useCallback((val: string) => {
    setContent(val);
    const now = Date.now();
    if (now - lastStoreUpdate.current > 300) {
      lastStoreUpdate.current = now;
      updateNodeData(id, { content: val });
    }
  }, [id, updateNodeData]);

  // 失去焦点时确保最终内容写入 store
  const handleBlur = useCallback(() => {
    updateNodeData(id, { content, isEditing: false });
    setIsEditing(false);
  }, [id, content, updateNodeData]);

  // 标签变更
  const handleLabelChange = useCallback((val: string) => {
    setLabel(val);
  }, []);

  // 标签确认
  const handleLabelConfirm = useCallback(() => {
    setIsRenaming(false);
    const finalLabel = label.trim() || '文本';
    setLabel(finalLabel);
    updateNodeData(id, { label: finalLabel });
  }, [label, id, updateNodeData]);

  // 插入格式
  const insertFormat = useCallback((before: string, after: string = '') => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const sel = ta.value.substring(start, end);
    const newText = ta.value.substring(0, start) + before + sel + after + ta.value.substring(end);
    setContent(newText);
    updateNodeData(id, { content: newText });
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(start + before.length, start + before.length + sel.length);
    }, 0);
  }, [id, updateNodeData]);

  return (
    <>
      <NodeResizer
        color="#8b5cf6"
        handleStyle={{ width: 8, height: 8 }}
        isVisible={selected}
        minWidth={200}
        minHeight={120}
      />

      <div
        className={`
          w-full h-full rounded-lg border-2 bg-white transition-shadow duration-150 flex flex-col overflow-hidden
          ${selected ? 'shadow-lg border-purple-500' : 'shadow-sm hover:shadow-md border-purple-300'}
          ${isEditing ? 'border-purple-500 nodrag nopan nowheel' : ''}
        `}
      >
        {/* 简化标题行 */}
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-t-md text-xs text-purple-700 bg-purple-50 border-b border-purple-100"
          onDoubleClick={(e) => {
            e.stopPropagation();
            setIsRenaming(true);
          }}
        >
          <FileTextOutlined className="text-purple-500" />
          {isRenaming ? (
            <input
              ref={labelInputRef}
              value={label}
              onChange={(e) => handleLabelChange(e.target.value)}
              onBlur={handleLabelConfirm}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleLabelConfirm();
                e.stopPropagation();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className="flex-1 bg-white border border-purple-300 rounded px-1 py-0.5 text-xs outline-none focus:border-purple-500"
            />
          ) : (
            <span className="truncate flex-1 font-medium">{label}</span>
          )}
        </div>

        {/* 内容区 */}
        <div
          className="px-3 py-2 flex-1 min-h-0 overflow-y-auto"
          onDoubleClick={handleDoubleClick}
        >
          {isEditing ? (
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              onBlur={handleBlur}
              placeholder="输入内容，支持 Markdown 格式..."
              className="w-full h-full text-sm text-gray-700 border-0 outline-none resize-none bg-transparent"
            />
          ) : content ? (
            <div className="text-sm text-gray-700 prose prose-sm max-w-none">
              <ReactMarkdown>{content}</ReactMarkdown>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-4 text-gray-400">
              <FileTextOutlined className="text-3xl mb-1" />
              <span className="text-xs">双击编辑</span>
            </div>
          )}
        </div>

        {/* Handles */}
        <Handle
          type="target"
          position={Position.Left}
          className="!w-2.5 !h-2.5 !bg-purple-400 !border-2 !border-white"
        />
        <Handle
          type="source"
          position={Position.Right}
          className="!w-2.5 !h-2.5 !bg-purple-400 !border-2 !border-white"
        />
      </div>

      {/* 编辑工具栏 */}
      {isEditing && (
        <Toolbar position={toolbarPos} onExit={exitEditing} onFormat={insertFormat} />
      )}
    </>
  );
});
