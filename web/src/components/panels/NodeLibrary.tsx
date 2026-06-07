import { memo, useCallback } from 'react';
import { Typography } from 'antd';
import {
  FileTextOutlined,
  PictureOutlined,
  VideoCameraOutlined,
  AudioOutlined,
  CodeOutlined,
} from '@ant-design/icons';
import { NODE_TYPE_CONFIG, type NodeType } from '@/types/canvas';

const { Title } = Typography;

const iconMap: Record<string, React.ReactNode> = {
  FileTextOutlined: <FileTextOutlined />,
  PictureOutlined: <PictureOutlined />,
  VideoCameraOutlined: <VideoCameraOutlined />,
  AudioOutlined: <AudioOutlined />,
  CodeOutlined: <CodeOutlined />,
};

const nodeTypeList: NodeType[] = ['text', 'image', 'video', 'audio', 'script'];

export const NodeLibrary = memo(function NodeLibrary() {
  const handleDragStart = useCallback((e: React.DragEvent, nodeType: NodeType) => {
    e.dataTransfer.setData('application/reactflow-type', nodeType);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  return (
    <div className="p-3">
      <Title level={5} className="!mb-3 !text-sm">
        节点库
      </Title>
      <div className="space-y-1">
        {nodeTypeList.map((nodeType) => {
          const config = NODE_TYPE_CONFIG[nodeType];
          return (
            <div
              key={nodeType}
              className="flex items-center gap-2 px-2 py-1.5 cursor-grab hover:bg-gray-50 rounded"
              draggable
              onDragStart={(e) => handleDragStart(e, nodeType)}
            >
              <div
                className="w-6 h-6 rounded flex items-center justify-center text-white text-xs"
                style={{ backgroundColor: config.color }}
              >
                {iconMap[config.icon]}
              </div>
              <span className="text-sm">{config.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
});
