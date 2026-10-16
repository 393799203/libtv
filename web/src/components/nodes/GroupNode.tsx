import { memo, useCallback, useState } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { GroupOutlined } from '@ant-design/icons';
import type { GroupNodeData } from '@/types/canvas';
import { useCanvasStore } from '@/stores/canvasStore';

type GroupNodeType = Node<GroupNodeData, 'group'>;

/**
 * 组合节点（容器）：把框选出来的一批节点在视觉上收进一个框。
 *
 * 它**只是个容器**：
 * - 左右各一个小耳朵（Handle），拖出去就是「组合整体 → 目标节点」的一条线；
 *   组合自己没有内容，所以读上游的地方会把它摊成成员（utils/topology 的 expandEdgesThroughGroups，
 *   后端 parser.Parse 同步做同样的摊平）——这样目标拿到的仍是成员的内容
 * - 它不会进执行计划（后端按 node type 找执行器，没人找 group）
 * - 双击标题可以改名
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
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);

  // 双击标题改名（与普通节点一致：双击 → 输入框 → 回车/失焦保存）
  const [isRenaming, setIsRenaming] = useState(false);
  const [draft, setDraft] = useState(label);
  const startRename = useCallback(() => {
    setDraft(label);
    setIsRenaming(true);
  }, [label]);
  const confirm = useCallback(() => {
    setIsRenaming(false);
    const next = draft.trim() || '组合';
    updateNodeData(id, { label: next });
  }, [draft, id, updateNodeData]);

  return (
    <div
      className={[
        'w-full h-full rounded-2xl border-2 border-dashed transition-colors',
        selected
          ? 'border-cyan-400 bg-cyan-400/[0.07]'
          : 'border-white/15 bg-white/[0.02] hover:border-white/30',
      ].join(' ')}
    >
      {/* 标题浮在框的上方（框内顶部已经在 normalizeGroups 里留出了 GROUP_TITLE_GAP）。
          这里要拦掉 pointerdown/mousedown：React Flow 的节点拖拽在 pointerdown 就把事件收走了，
          标题又浮在节点盒子**外面**，双击根本传不到 onDoubleClick（实测：JS 派发能改名、真实双击不能）。
          nodrag 是 React Flow 的正解：带这个类名的元素不会起拖拽，双击才会真的落到 onDoubleClick 上。 */}
      <div
        className={`nodrag absolute -top-[22px] left-1.5 flex items-center gap-1.5 text-[11px] select-none ${
          selected ? 'text-cyan-300' : 'text-gray-400'
        }`}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <GroupOutlined />
        {isRenaming ? (
          <input
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={confirm}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirm();
              if (e.key === 'Escape') setIsRenaming(false);
              e.stopPropagation();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            className="w-32 rounded border border-gray-300 bg-white px-1 py-0.5 text-[11px] text-gray-800 outline-none focus:border-cyan-400"
          />
        ) : (
          <span className="font-medium" onDoubleClick={startRename} title="双击改名">
            {label}
          </span>
        )}
        {memberCount > 0 && <span className="text-gray-500">· {memberCount} 个节点</span>}
      </div>

      {/* 组合只有右耳（输出）。它没有左耳 —— 组合是**虚拟**的：
          别的节点不该连进组合（连进来也没有意义，成员才是真正跑生成的东西）。
          从右耳拖出去时，落下的线仍然是一个成员一条（见 GroupConnectionLine + store 的 onConnect）。 */}
      <Handle type="source" position={Position.Right} className="libtv-handle libtv-handle-right">
        <span className="libtv-handle-hit" aria-hidden />
      </Handle>
    </div>
  );
});