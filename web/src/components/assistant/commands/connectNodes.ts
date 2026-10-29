import { useCanvasStore } from '@/stores/canvasStore';
import { nodeRegistry } from '@/plugins/registry';
import { NODE_TYPE_CONFIG, type NodeType } from '@/types/canvas';
import { argString, type CommandHandler } from './types';

/**
 * connect_nodes：把两个节点连起来（上游输出 → 下游输入）。
 *
 * 这个命令的价值不在「省一次拖拽」，而在于**帮用户避开连不上的情况**：
 * 连线本身有语义（图片不能接文本的下游之类），
 * 用户凭直觉连错的概率不低，助手应该直接告诉他为什么不行。
 */

// type 用 string 而不是 NodeType：LibTVNode 的 type 经 reactflow 泛型出来是 string，
// 而这个函数只拿它查一次表，收窄类型没有收益、只会让调用点被迫断言
function describe(nodeId: string, type: string, label?: string): string {
  const name = label || (NODE_TYPE_CONFIG as Record<string, { label?: string }>)[type]?.label;
  return name ? `${name}（${nodeId}）` : nodeId;
}

export const connectNodesCommand: CommandHandler = (args) => {
  const canvas = useCanvasStore.getState();

  if (!canvas.projectId) {
    throw new Error('先打开一个项目，我才能帮你连线');
  }

  const sourceId = argString(args, 'sourceId');
  const targetId = argString(args, 'targetId');

  const find = (id: string) => canvas.nodes.find((n) => n.id === id);
  const source = find(sourceId);
  const target = find(targetId);

  // 模型编 id 是常见失败模式（它只看到摘要，at 长名单里选错很正常），
  // 所以这里的信息要足够让人能自己纠正，而不是干巴巴一句「节点不存在」
  if (!source) throw new Error(`画布上找不到 ${sourceId}，确认一下是哪个节点？`);
  if (!target) throw new Error(`画布上找不到 ${targetId}，确认一下是哪个节点？`);
  if (sourceId === targetId) throw new Error('不能把节点连到它自己');

  // 组合不能直接作为连线端点：canvasStore.connectNodes 会把组合摊成成员，
  // 但直接连一个组合框在语义上说不清，让用户先选成员更稳妥
  if (source.type === 'group' || target.type === 'group') {
    throw new Error('组合不能直接连线，选组里的具体节点吧');
  }

  // nodeRegistry 只登记了 7 种可生成节点（不含 group），上一行已排除 group，
  // 所以这里的断言是安全的：剩下的一定是已登记类型
  if (!nodeRegistry.validateConnection(source.type as NodeType, target.type as NodeType)) {
    const srcName = describe(sourceId, source.type, (source.data as { label?: string })?.label);
    const dstName = describe(targetId, target.type, (target.data as { label?: string })?.label);
    throw new Error(`${srcName} 的输出接不到 ${dstName} 上，这两个节点连不起来`);
  }

  const existed = canvas.edges.some((e) => e.source === sourceId && e.target === targetId);
  if (existed) {
    return { note: '这两个节点已经连上了', mutated: false };
  }

  canvas.connectNodes(sourceId, targetId);

  const ok = useCanvasStore
    .getState()
    .edges.some((e) => e.source === sourceId && e.target === targetId);
  if (!ok) {
    // connectNodes 内部有多条静默早退（自环、重复、目标是组合成员等）
    throw new Error('这条线没连上，可能它们之间已经有连接了');
  }

  const srcName = describe(sourceId, source.type, (source.data as { label?: string })?.label);
  const dstName = describe(targetId, target.type, (target.data as { label?: string })?.label);
  return { note: `已把 ${srcName} 接到 ${dstName}`, mutated: true };
};