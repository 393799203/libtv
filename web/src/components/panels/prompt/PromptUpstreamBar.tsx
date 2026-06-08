import { memo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  PictureOutlined,
  VideoCameraOutlined,
  FileTextOutlined,
  CodeOutlined,
  CloseOutlined,
} from '@ant-design/icons';
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
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // 删除上游节点的依赖连线
  const handleRemove = useCallback(
    (e: React.MouseEvent, upstreamNodeId: string) => {
      e.stopPropagation();
      if (!targetNodeId) return;
      removeEdges([`e-${upstreamNodeId}-${targetNodeId}`]);
    },
    [removeEdges, targetNodeId]
  );

  const handleMouseEnter = useCallback((e: React.MouseEvent, input: UpstreamInput) => {
    // 只对有缩略图的资源显示大图预览
    if (!input.thumbnail) return;
    setHoveredItem(input);
    setHoverPos({ x: e.clientX, y: e.clientY });
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoveredItem(null);
  }, []);

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

      {/* hover 大图预览浮层（Portal 到 body，避免被父容器裁切） */}
      {hoveredItem?.thumbnail && createPortal(
        <div
          className="fixed z-[9999] pointer-events-none"
          style={{
            left: hoverPos.x - 80,
            top: hoverPos.y - 20,
            transform: 'translateY(-100%)',
          }}
        >
          <img
            src={hoveredItem.thumbnail}
            alt=""
            className="max-w-[280px] max-h-[240px] object-contain rounded-lg shadow-2xl"
          />
        </div>,
        document.body
      )}
    </div>
  );
});
