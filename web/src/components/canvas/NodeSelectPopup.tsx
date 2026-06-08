import { memo, useCallback } from 'react';
import {
  FileTextOutlined,
  PictureOutlined,
  VideoCameraOutlined,
  AudioOutlined,
  CodeOutlined,
} from '@ant-design/icons';
import { NODE_TYPE_CONFIG, type NodeType } from '@/types/canvas';

const iconMap: Record<string, React.ReactNode> = {
  FileTextOutlined: <FileTextOutlined />,
  PictureOutlined: <PictureOutlined />,
  VideoCameraOutlined: <VideoCameraOutlined />,
  AudioOutlined: <AudioOutlined />,
  CodeOutlined: <CodeOutlined />,
};

const nodeTypeList: NodeType[] = ['text', 'image', 'video', 'audio', 'script'];

interface NodeSelectPopupProps {
  position: { x: number; y: number };
  onSelect: (nodeType: NodeType) => void;
  onClose: () => void;
}

export const NodeSelectPopup = memo(function NodeSelectPopup({
  position,
  onSelect,
  onClose,
}: NodeSelectPopupProps) {
  const handleSelect = useCallback(
    (nodeType: NodeType) => {
      onSelect(nodeType);
      onClose();
    },
    [onSelect, onClose]
  );

  return (
    <div
      className="fixed z-[9999] bg-white rounded-xl shadow-2xl border border-gray-200 py-1.5 min-w-[160px]"
      style={{ left: position.x, top: position.y }}
    >
      <div className="px-3 py-1.5 text-xs text-gray-400 font-medium border-b border-gray-100 mb-0.5">
        选择节点类型
      </div>
      {nodeTypeList.map((nodeType) => {
        const config = NODE_TYPE_CONFIG[nodeType];
        return (
          <div
            key={nodeType}
            className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-blue-50 transition-colors"
            onClick={() => handleSelect(nodeType)}
          >
            <div
              className="w-6 h-6 rounded-md flex items-center justify-center text-white text-xs flex-shrink-0"
              style={{ backgroundColor: config.color }}
            >
              {iconMap[config.icon]}
            </div>
            <span className="text-sm text-gray-700">{config.label}</span>
          </div>
        );
      })}
    </div>
  );
});
