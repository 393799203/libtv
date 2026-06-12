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
  // 直接用 selectedNodeIds 判断目标节点是否选中（O(M)，M=选中数，而非 O(N) 遍历全部节点）
  const selectedNodeIds = useCanvasStore((s) => s.selectedNodeIds);
  const targetNodeSelected = selectedNodeIds.includes(target);

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
