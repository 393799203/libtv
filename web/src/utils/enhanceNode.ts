import { createNode } from '@/utils/nodeFactory';
import { useCanvasStore } from '@/stores/canvasStore';
import type { LibTVEdge, LibTVNode } from '@/types/canvas';

/** 清晰化节点的宽度（与视频节点同宽） */
const ENHANCE_NODE_WIDTH = 480;
/** 新节点与原节点的水平间距 */
const ENHANCE_NODE_GAP = 80;

/**
 * 在指定节点右侧创建「清晰化」节点并连线。
 *
 * 为什么放在工具函数里：入口不止一处（清晰度面板里的 480p 引导、节点的右键菜单），
 * 都要保证「同一行为」——幂等、位置一致、连线类型一致。
 *
 * 幂等：该节点已经连着一个清晰化节点时，直接返回既有的那个，不再叠一个。
 */
export function addEnhanceNodeAfter(sourceNodeId: string): LibTVNode | null {
  const store = useCanvasStore.getState();
  const source = store.nodes.find((n) => n.id === sourceNodeId);
  if (!source) return null;

  // 已有连线 → 复用（用户重复点「加清晰化节点」不该堆出一排节点）
  const existingEdge = store.edges.find(
    (e) => e.source === sourceNodeId && e.target.startsWith('enhance-')
  );
  if (existingEdge) {
    const existing = store.nodes.find((n) => n.id === existingEdge.target);
    if (existing) return existing;
  }

  const nodeId = `enhance-${Date.now()}`;
  const node = createNode(
    'enhance',
    {
      x: source.position.x + ENHANCE_NODE_WIDTH + ENHANCE_NODE_GAP,
      y: source.position.y,
    },
    { id: nodeId }
  );

  store.addNode(node);

  const edge: LibTVEdge = {
    id: `e-${sourceNodeId}-${nodeId}`,
    source: sourceNodeId,
    target: nodeId,
    type: 'dataFlow',
  };
  store.addEdge(edge);

  return node;
}