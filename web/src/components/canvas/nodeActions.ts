import { message } from '@/utils/antdApp';
import { useCanvasStore } from '@/stores/canvasStore';
import { useNodeActionStore } from './nodeActionStore';
import type { LibTVNode } from '@/types/canvas';

/**
 * 节点级动作的**唯一实现**：复制到剪贴板 / 按 id 删除。
 *
 * 抽出来的原因：这两个动作的入口从"只有右键菜单"变成"右键菜单 + 图片节点工具条"
 * （用户要求把图片节点的这些项挪到工具条）。两处各写一遍，迟早出现
 * "工具条复制的节点右键粘不出来"或提示文案不一致；而且剪贴板本身也得是同一份状态
 * （见 nodeActionStore）。
 */

/** 复制节点到剪贴板。返回是否成功（组合节点不允许复制）。 */
export function copyNodeToClipboard(node: LibTVNode, label: string): boolean {
  // 组合是容器不是素材：复制出来是个没有成员的空框（还得手工往里塞节点，等于没用），
  // 所以和删除一样不允许 —— 要走「取消组合 → 复制成员 → 重新组合」。
  if (node.type === 'group') {
    message.warning('组合节点不支持复制，请先用「取消组合」');
    return false;
  }
  useNodeActionStore.getState().setClipboard(node);
  message.success({ content: `已复制节点「${label}」`, key: 'node-clip' });
  return true;
}

/** 按 id 删除节点（自动跳过组合节点）。返回实际删除的数量。 */
export function deleteNodesByIds(ids: string[]): number {
  const all = useCanvasStore.getState().nodes;
  const deletable = ids.filter((id) => all.find((n) => n.id === id)?.type !== 'group');
  if (deletable.length === 0) {
    message.warning(
      ids.length > 0 ? '组合节点不能直接删除，请先用「取消组合」' : '请先选中一个节点再删除'
    );
    return 0;
  }
  useCanvasStore.getState().removeNodes(deletable);
  message.success(`已删除 ${deletable.length} 个节点（Ctrl/Cmd+Z 可撤销）`);
  return deletable.length;
}
