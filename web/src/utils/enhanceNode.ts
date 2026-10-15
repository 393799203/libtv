import { createNode } from '@/utils/nodeFactory';
import { absolutePositionIn } from '@/utils/canvasGroups';
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
  // 判据是目标节点的类型，不看 id 前缀：清晰化节点就是 type==='enhance' 的节点
  const existingEdge = store.edges.find(
    (e) => e.source === sourceNodeId && store.nodes.find((n) => n.id === e.target)?.type === 'enhance'
  );
  if (existingEdge) {
    const existing = store.nodes.find((n) => n.id === existingEdge.target);
    if (existing) return existing;
  }

  // 清晰化节点不需要自定义 id：工厂产出的统一 id 就够（幂等靠 type 判断，不靠 id 前缀）
  // 绝对坐标：源节点在组合里时 position 是相对的，新节点会落到别处
  const sourceAbs = absolutePositionIn(store.nodes, source);
  const node = createNode('enhance', {
    x: sourceAbs.x + ENHANCE_NODE_WIDTH + ENHANCE_NODE_GAP,
    y: sourceAbs.y,
  });

  store.addNode(node);

  const edge: LibTVEdge = {
    id: `e-${sourceNodeId}-${node.id}`,
    source: sourceNodeId,
    target: node.id,
    type: 'dataFlow',
  };
  store.addEdge(edge);

  return node;
}