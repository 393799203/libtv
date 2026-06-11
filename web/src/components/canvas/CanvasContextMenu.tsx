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
import { NODE_TYPE_CONFIG, type NodeType, type LibTVNode } from '@/types/canvas';

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
      const config = NODE_TYPE_CONFIG[nodeType];

      const flowPosition = screenToFlowPosition(position);

      const baseData = {
        type: nodeType,
        label: config.label,
        status: 'idle' as const,
      };

      let nodeData;
      switch (nodeType) {
        case 'text':
          nodeData = {
            ...baseData,
            type: 'text' as const,
            content: '',
          };
          break;
        case 'image':
          nodeData = {
            ...baseData,
            type: 'image' as const,
            prompt: '',
            model: 'stable-diffusion-xl',
            width: 1024,
            height: 1024,
          };
          break;
        case 'video':
          nodeData = {
            ...baseData,
            type: 'video' as const,
            prompt: '',
            model: 'kling-v1',
            duration: 5,
            fps: 24,
          };
          break;
        case 'audio':
          nodeData = {
            ...baseData,
            type: 'audio' as const,
            text: '',
            voice: 'zh-CN-XiaoxiaoNeural',
            speed: 1,
          };
          break;
        case 'script':
          nodeData = {
            ...baseData,
            type: 'script' as const,
            scriptContent: '',
            shots: [],
          };
          break;
      }

      const newNode: LibTVNode = {
        id: `${nodeType}-${Date.now()}`,
        type: nodeType,
        position: flowPosition,
        data: nodeData as LibTVNode['data'],
        style: { width: 280, ...(nodeType !== 'image' ? { height: 200 } : {}) },
      };

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
