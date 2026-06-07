import { useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useCanvasStore } from '@/stores/canvasStore';
import { canvasApi } from '@/services/canvasApi';
import type { NodeType, LibTVNode, CanvasData } from '@/types/canvas';
import { createDefaultNodeData } from '@/utils/nodeFactory';

export function useCanvas() {
  const { screenToFlowPosition } = useReactFlow();
  const addNode = useCanvasStore((s) => s.addNode);
  const projectId = useCanvasStore((s) => s.projectId);
  const loadCanvas = useCanvasStore((s) => s.loadCanvas);

  // 从拖拽创建节点
  const createNodeFromDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const nodeType = event.dataTransfer.getData('application/reactflow-type') as NodeType;
      if (!nodeType) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode: LibTVNode = {
        id: `${nodeType}-${Date.now()}`,
        type: nodeType,
        position,
        data: createDefaultNodeData(nodeType),
        style: { width: 280, height: 200 },
      };

      addNode(newNode);
    },
    [screenToFlowPosition, addNode]
  );

  // 从后端加载画布
  const loadCanvasFromServer = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await canvasApi.getCanvas(projectId);
      const data = res as any;
      let canvasData: CanvasData | null = null;
      if (data && data.nodes && Array.isArray(data.nodes)) {
        canvasData = data as CanvasData;
      } else if (data && data.data && data.data.nodes) {
        canvasData = data.data as CanvasData;
      }

      if (canvasData && canvasData.nodes.length > 0) {
        const cleanedNodes = canvasData.nodes.map((node) => ({
          ...node,
          data: { ...node.data, isEditing: false },
        }));
        loadCanvas({ ...canvasData, nodes: cleanedNodes });
      }
    } catch (error) {
      console.log('画布数据为空或加载失败:', error);
    }
  }, [projectId, loadCanvas]);

  return {
    createNodeFromDrop,
    loadCanvasFromServer,
  };
}
