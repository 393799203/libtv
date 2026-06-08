import { memo } from 'react';
import { BaseEdge, getBezierPath, type EdgeProps, type Edge } from '@xyflow/react';
import { useCanvasStore } from '@/stores/canvasStore';
import type { DataFlowEdgeData } from '@/types/canvas';

type DataFlowEdgeType = Edge<DataFlowEdgeData>;

export const DataFlowEdge = memo<EdgeProps<DataFlowEdgeType>>(function DataFlowEdge({
  id,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
}) {
  // 检查目标节点是否被选中
  const targetNodeSelected = useCanvasStore((s) => s.nodes.find((n) => n.id === target)?.selected ?? false);

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      style={{
        stroke: targetNodeSelected ? '#3b82f6' : selected ? '#3b82f6' : '#94a3b8',
        strokeWidth: targetNodeSelected || selected ? 3 : 2,
        fill: 'none',
        strokeDasharray: targetNodeSelected ? '8 4' : 'none',
        animation: targetNodeSelected ? 'dash 1s linear infinite' : undefined,
      }}
    />
  );
});
