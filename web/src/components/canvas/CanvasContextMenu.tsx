import { memo, useCallback, useEffect, useRef } from 'react';
import { Menu, type MenuProps } from 'antd';
import {
  FileTextOutlined,
  PictureOutlined,
  VideoCameraOutlined,
  AudioOutlined,
  CodeOutlined,
} from '@ant-design/icons';
import { useReactFlow } from '@xyflow/react';
import { useCanvasStore } from '@/stores/canvasStore';
import { type NodeType } from '@/types/canvas';
import { createNode } from '@/utils/nodeFactory';

interface ContextMenuProps {
  position: { x: number; y: number };
  onClose: () => void;
}

export const CanvasContextMenu = memo(function CanvasContextMenu({
  position,
  onClose,
}: ContextMenuProps) {
  const { screenToFlowPosition } = useReactFlow();
  const addNode = useCanvasStore((s) => s.addNode);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleMenuItemClick = useCallback(
    (e: { key: React.Key }) => {
      const nodeType = e.key as NodeType;
      const flowPosition = screenToFlowPosition(position);

      const newNode = createNode(nodeType, flowPosition);
      addNode(newNode);
      onClose();
    },
    [position, screenToFlowPosition, addNode, onClose]
  );

  const menuItems: MenuProps['items'] = [
    {
      key: 'text',
      label: '文本节点',
      icon: <FileTextOutlined />,
    },
    {
      key: 'image',
      label: '图像节点',
      icon: <PictureOutlined />,
    },
    {
      key: 'video',
      label: '视频节点',
      icon: <VideoCameraOutlined />,
    },
    {
      key: 'audio',
      label: '音频节点',
      icon: <AudioOutlined />,
    },
    {
      key: 'script',
      label: '脚本节点',
      icon: <CodeOutlined />,
    },
  ];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 1000,
      }}
    >
      <Menu
        items={menuItems}
        onClick={handleMenuItemClick}
        style={{
          borderRadius: 8,
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
        }}
      />
    </div>
  );
});
