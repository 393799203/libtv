import { memo, useCallback } from 'react';
import { Typography, Empty } from 'antd';
import { useCanvasStore } from '@/stores/canvasStore';
import { PromptCompose } from './prompt';
import type { LibTVNodeData } from '@/types/canvas';

const { Title } = Typography;

const PROMPT_NODE_TYPES = ['text', 'image', 'video', 'audio', 'script'] as const;

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

  // 支持提示词面板的节点类型，统一使用 PromptCompose
  if (selectedNode && PROMPT_NODE_TYPES.includes(selectedNode.data.type as typeof PROMPT_NODE_TYPES[number])) {
    return (
      <div className="p-3">
        <PromptCompose
          nodeId={selectedNode.id}
          nodeType={selectedNode.data.type}
          data={selectedNode.data}
          onUpdate={handleUpdateNode}
        />
      </div>
    );
  }

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
    </div>
  );
});
