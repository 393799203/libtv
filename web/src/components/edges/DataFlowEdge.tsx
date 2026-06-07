import { memo } from 'react';
import { BaseEdge, getSmoothStepPath, type EdgeProps, type Edge } from '@xyflow/react';
import type { DataFlowEdgeData } from '@/types/canvas';

type DataFlowEdgeType = Edge<DataFlowEdgeData>;

export const DataFlowEdge = memo<EdgeProps<DataFlowEdgeType>>(function DataFlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
}) {
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 8,
  });

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      style={{
        stroke: selected ? '#3b82f6' : '#94a3b8',
        strokeWidth: selected ? 2 : 1.5,
      }}
    />
  );
});
