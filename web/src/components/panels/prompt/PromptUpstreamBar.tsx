import { memo, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  PictureOutlined,
  VideoCameraOutlined,
  FileTextOutlined,
  CodeOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import type { UpstreamInput } from '@/types/prompt';
import { useCanvasStore } from '@/stores/canvasStore';

interface PromptUpstreamBarProps {
  inputs: UpstreamInput[];
  onInsertMention: (input: UpstreamInput) => void;
  /** 当前节点 ID，用于删除连线时定位边 */
  targetNodeId?: string;
}

const NODE_TYPE_ICON: Record<UpstreamInput['nodeType'], React.ReactNode> = {
  image: <PictureOutlined className="text-blue-500" />,
  video: <VideoCameraOutlined className="text-red-500" />,
  text: <FileTextOutlined className="text-purple-500" />,
  script: <CodeOutlined className="text-amber-500" />,
};

export const PromptUpstreamBar = memo<PromptUpstreamBarProps>(function PromptUpstreamBar({
  inputs,
  onInsertMention,
  targetNodeId,
}) {
  const removeEdges = useCanvasStore((s) => s.removeEdges);
  const edges = useCanvasStore((s) => s.edges);
  const [hoveredItem, setHoveredItem] = useState<UpstreamInput | null>(null);
  const [hoverPos, setHoverPos] = useState<{ mouseX: number; thumbTop: number }>({ mouseX: 0, thumbTop: 0 });
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 鼠标进入缩略图区域：显示预览浮层
  const handleThumbEnter = useCallback((e: React.MouseEvent, input: UpstreamInput) => {
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
    setHoveredItem(input);
    setHoverPos({
      mouseX: e.clientX,
      thumbTop: e.currentTarget.getBoundingClientRect().top,
    });
  }, []);

  // 鼠标离开缩略图：延迟隐藏
  const handleThumbLeave = useCallback(() => {
    hideTimerRef.current = setTimeout(() => setHoveredItem(null), 150);
  }, []);

  // 删除连线：通过 source+target 匹配真实 edge ID（不依赖手动拼接格式）
  const handleRemove = useCallback(
    (e: React.MouseEvent, upstreamNodeId: string) => {
      e.stopPropagation();
      e.preventDefault();
      if (!targetNodeId) return;
      // 从 store 的 edges 中查找匹配的边，取其真实 ID
      const edge = edges.find(
        (ed) => ed.source === upstreamNodeId && ed.target === targetNodeId
      );
      if (edge) {
        removeEdges([edge.id]);
      }
    },
    [removeEdges, targetNodeId, edges]
  );

  if (inputs.length === 0) return null;

  return (
    <div className="flex items-center gap-2 pb-3">
      {inputs.map((input, index) => (
        <div
          key={input.nodeId}
          className="relative group"
        >
          {/* 缩略图 */}
          {input.thumbnail ? (
            <div className="relative w-[44px] h-[44px] rounded-lg bg-gray-100 border border-gray-200">
              {/* 图片：控制预览浮层的显示/隐藏 */}
              <img
                src={input.thumbnail}
                alt={input.label}
                className="w-full h-full object-cover rounded-lg"
                onMouseEnter={(e) => handleThumbEnter(e, input)}
                onMouseLeave={handleThumbLeave}
              />
              {/* 删除按钮：纯 CSS group-hover 控制，不依赖 React 状态 */}
              <button
                className="absolute top-0 right-0 w-4 h-4 bg-black/60 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer z-10"
                onClick={(e) => handleRemove(e, input.nodeId)}
              >
                <CloseOutlined style={{ fontSize: 10 }} />
              </button>
              {/* 序号角标 */}
              <span className="absolute bottom-0.5 right-0.5 w-4 h-4 bg-black/60 text-white text-[9px] rounded-full flex items-center justify-center font-medium shadow-sm pointer-events-none">
                {index + 1}
              </span>
            </div>
          ) : (
            <div
              className="w-[44px] h-[44px] rounded-lg bg-gray-50 border border-dashed border-gray-250 flex flex-col items-center justify-center gap-0.5"
              onMouseEnter={(e) => handleThumbEnter(e, input)}
              onMouseLeave={handleThumbLeave}
            >
              {NODE_TYPE_ICON[input.nodeType]}
              <span className="text-[9px] text-gray-400 leading-none">{input.label}</span>
            </div>
          )}
        </div>
      ))}

      {/* hover 预览浮层（Portal 渲染到 body） */}
      {createPortal(
        <div
          className="fixed z-[9999] transition-opacity duration-150"
          style={{
            left: hoverPos.mouseX,
            top: hoverPos.thumbTop - 8,
            transform: 'translate(-50%, -100%)',
            opacity: hoveredItem ? 1 : 0,
            // 图片预览不需要交互；文本预览需要滚动
            pointerEvents: hoveredItem?.textSnippet ? 'auto' : 'none',
          }}
          onMouseEnter={() => { if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; } }}
          onMouseLeave={() => { hideTimerRef.current = setTimeout(() => setHoveredItem(null), 150); }}
        >
          {hoveredItem?.thumbnail ? (
            <img
              src={hoveredItem.thumbnail}
              alt=""
              className="max-w-[280px] max-h-[240px] object-contain rounded-lg shadow-2xl"
            />
          ) : hoveredItem?.textSnippet ? (
            <div className="max-w-[280px] max-h-[320px] overflow-y-auto bg-white rounded-lg shadow-2xl border border-gray-200 p-3">
              <div className="prose prose-sm max-w-none text-[13px] text-gray-600 leading-relaxed">
                <ReactMarkdown>{hoveredItem.textSnippet}</ReactMarkdown>
              </div>
            </div>
          ) : null}
        </div>,
        document.body
      )}
    </div>
  );
});
