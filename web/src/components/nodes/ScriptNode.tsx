import { memo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { NodeProps, Node } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import { ScriptCard } from './script/ScriptCard';
import { ScriptDetailPanel } from './script/ScriptDetailPanel';
import { useCanvasStore } from '@/stores/canvasStore';
import type { ScriptNodeData } from '@/types/canvas';

type ScriptNodeType = Node<ScriptNodeData, 'script'>;

export const ScriptNode = memo<NodeProps<ScriptNodeType>>(function ScriptNode({ id, data, selected }) {
  const [detailOpen, setDetailOpen] = useState(false);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);

  // 稳定的 card data 对象 — 只在数据实际变化时新建，保证 ScriptCard.memo 生效
  const cardData = {
    label: data.label,
    currentStep: data.currentStep,
    shots: data.shots,
    scriptContent: data.scriptContent,
  };

  // 稳定的事件处理
  const handleOpenDetail = useCallback(() => setDetailOpen(true), []);
  const handleCloseDetail = useCallback(() => setDetailOpen(false), []);

  // 稳定的更新回调
  const handleUpdateData = useCallback(
    (updates: Partial<ScriptNodeData>) => {
      updateNodeData(id, updates as Partial<ScriptNodeData>);
    },
    [id, updateNodeData]
  );

  return (
    <>
      <BaseNode id={id} data={data} selected={selected} noContentPadding>
        <ScriptCard
          data={cardData}
          status={data.status}
          onOpen={handleOpenDetail}
        />
      </BaseNode>

      {/* 条件渲染 Portal：关闭时不创建 DOM，减少节点数 */}
      {detailOpen &&
        createPortal(
          <ScriptDetailPanel
            open={detailOpen}
            scriptNodeId={id}
            data={data}
            onClose={handleCloseDetail}
            onUpdate={handleUpdateData}
          />,
          document.body
        )}
    </>
  );
});
