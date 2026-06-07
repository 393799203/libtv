import { memo, useCallback } from 'react';
import { Typography, Empty } from 'antd';
import { useCanvasStore } from '@/stores/canvasStore';
import { TextNodeEditor } from './TextNodeEditor';
import type { LibTVNodeData } from '@/types/canvas';

const { Title } = Typography;

export const NodePropsPanel = memo(function NodePropsPanel() {
  const selectedNodeIds = useCanvasStore((s) => s.selectedNodeIds);
  const nodes = useCanvasStore((s) => s.nodes);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);

  const selectedNode = selectedNodeIds.length === 1
    ? nodes.find((n) => n.id === selectedNodeIds[0])
    : null;

  const handleUpdateNode = useCallback((data: Partial<LibTVNodeData>) => {
    if (!selectedNode) return;
    updateNodeData(selectedNode.id, data);
  }, [selectedNode, updateNodeData]);

  const renderEditor = () => {
    if (!selectedNode) return null;

    switch (selectedNode.data.type) {
      case 'text':
        return <TextNodeEditor data={selectedNode.data} onUpdate={handleUpdateNode} />;
      case 'image':
      case 'video':
      case 'audio':
      case 'script':
      default:
        return (
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-500">ID</span>
              <span className="text-gray-800 font-mono">{selectedNode.id}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">类型</span>
              <span className="text-gray-800">{selectedNode.data.type}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">标签</span>
              <span className="text-gray-800">{selectedNode.data.label}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">状态</span>
              <span className="text-gray-800">{selectedNode.data.status}</span>
            </div>
          </div>
        );
    }
  };

  if (!selectedNode) {
    return (
      <div className="p-3">
        <Title level={5} className="!mb-3 !text-sm">
          属性面板
        </Title>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="选中节点查看属性"
          className="!my-4"
        />
      </div>
    );
  }

  return (
    <div className="p-3">
      <Title level={5} className="!mb-3 !text-sm">
        属性面板
      </Title>
      {renderEditor()}
    </div>
  );
});
