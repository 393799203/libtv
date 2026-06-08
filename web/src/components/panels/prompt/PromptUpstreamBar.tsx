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

// 圈数字符映射（用于角标）
const CIRCLED_NUMBERS = ['\u2460', '\u2461', '\u2462', '\u2463', '\u2464', '\u2465'];

export const PromptUpstreamBar = memo<PromptUpstreamBarProps>(function PromptUpstreamBar({
  inputs,
  onInsertMention,
  targetNodeId,
}) {
  const removeEdges = useCanvasStore((s) => s.removeEdges);
  const [hoveredItem, setHoveredItem] = useState<UpstreamInput | null>(null);
  // 鼠标 x 坐标（作为浮层水平中心）+ 缩略图顶部（浮层显示在缩略图上方）
  const [hoverPos, setHoverPos] = useState<{ mouseX: number; thumbTop: number }>({ mouseX: 0, thumbTop: 0 });
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 显示预览：取消隐藏定时器，记录位置
  const handleMouseEnter = useCallback((e: React.MouseEvent, input: UpstreamInput) => {
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
    setHoveredItem(input);
    setHoverPos({
      mouseX: e.clientX,
      thumbTop: e.currentTarget.getBoundingClientRect().top,
    });
  }, []);

  // 隐藏预览：短延迟，给鼠标滑到浮层的时间
  const handleMouseLeave = useCallback(() => {
    hideTimerRef.current = setTimeout(() => { setHoveredItem(null); }, 100);
  }, []);

  // 删除上游节点的依赖连线
  const handleRemove = useCallback(
    (e: React.MouseEvent, upstreamNodeId: string) => {
      e.stopPropagation();
      if (!targetNodeId) return;
      removeEdges([`e-${upstreamNodeId}-${targetNodeId}`]);
    },
    [removeEdges, targetNodeId]
  );

  if (inputs.length === 0) return null;

  return (
    <div className="flex items-center gap-2 pb-3">
      {/* 上游输入缩略图列表 */}
      {inputs.map((input, index) => (
        <div
          key={input.nodeId}
          className="relative group"
          onMouseEnter={(e) => handleMouseEnter(e, input)}
          onMouseLeave={handleMouseLeave}
        >
          {/* 缩略图 */}
          {input.thumbnail ? (
            <div className="relative w-[44px] h-[44px] rounded-lg bg-gray-100 border border-gray-200 group">
              <img
                src={input.thumbnail}
                alt={input.label}
                className="w-full h-full object-cover rounded-lg"
              />
              {/* hover 显示删除按钮 */}
              <button
                className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/60 text-white rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer z-10"
                onClick={(e) => handleRemove(e, input.nodeId)}
              >
                <CloseOutlined style={{ fontSize: 10 }} />
              </button>
              {/* 序号角标：右下角圆形数字（图片内） */}
              <span className="absolute bottom-0.5 right-0.5 w-4 h-4 bg-black/60 text-white text-[9px] rounded-full flex items-center justify-center font-medium shadow-sm">
                {index + 1}
              </span>
            </div>
          ) : (
            <div className="w-[44px] h-[44px] rounded-lg bg-gray-50 border border-dashed border-gray-250 flex flex-col items-center justify-center gap-0.5">
              {NODE_TYPE_ICON[input.nodeType]}
              <span className="text-[9px] text-gray-400 leading-none">{input.label}</span>
            </div>
          )}
        </div>
      ))}

      {/* hover 预览浮层（以鼠标 x 为水平中心，显示在缩略图上方） */}
      {createPortal(
        <div
          className="fixed z-[9999] transition-opacity duration-150"
          style={{
            left: hoverPos.mouseX,
            top: hoverPos.thumbTop - 8,
            transform: 'translate(-50%, -100%)',
            opacity: hoveredItem ? 1 : 0,
            pointerEvents: hoveredItem ? 'auto' : 'none',
          }}
          onMouseEnter={() => { if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; } }}
          onMouseLeave={() => { hideTimerRef.current = setTimeout(() => setHoveredItem(null), 100); }}
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
