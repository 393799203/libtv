import { memo } from 'react';
import type { Node, NodeProps } from '@xyflow/react';
import { GroupOutlined } from '@ant-design/icons';
import type { GroupNodeData } from '@/types/canvas';
import { useCanvasStore } from '@/stores/canvasStore';

type GroupNodeType = Node<GroupNodeData, 'group'>;

/**
 * 组合节点（容器）：把框选出来的一批节点在视觉上收进一个框。
 *
 * 它**只是个容器**：
 * - 不带任何 Handle → 连不了线，也不会进执行计划（后端按 node type 找执行器，没人找 group）
 * - 位置/尺寸由 store 的 normalizeGroups 按「成员包围盒 + 内边距」持续贴合（成员一拖，框跟着变）
 * - 「拖组合 = 成员一起走」靠 React Flow 的原生父子关系：成员节点带 parentId 指向它
 *
 * 成员数从 store 现算而不落库：它是派生值，存进 data 反而会出现和实际成员不一致的脏数据。
 */
export const GroupNode = memo(function GroupNode({ id, data, selected }: NodeProps<GroupNodeType>) {
  const label = (typeof data.label === 'string' && data.label) || '组合';
  const memberCount = useCanvasStore(
    (s) => s.nodes.reduce((acc, n) => (n.parentId === id ? acc + 1 : acc), 0)
  );

  return (
    <div
      className={[
        'w-full h-full rounded-2xl border-2 border-dashed transition-colors',
        selected
          ? 'border-cyan-400 bg-cyan-400/[0.07]'
          : 'border-white/15 bg-white/[0.02] hover:border-white/30',
      ].join(' ')}
    >
      {/* 标题浮在框的上方（框内顶部已经在 normalizeGroups 里留出了 GROUP_TITLE_GAP） */}
      <div
        className={`absolute -top-[22px] left-1.5 flex items-center gap-1.5 text-[11px] select-none ${
          selected ? 'text-cyan-300' : 'text-gray-400'
        }`}
      >
        <GroupOutlined />
        <span className="font-medium">{label}</span>
        {memberCount > 0 && <span className="text-gray-500">· {memberCount} 个节点</span>}
      </div>
    </div>
  );
});