import { memo, useMemo } from 'react';
import { getBezierPath, useConnection, useStore, type InternalNode } from '@xyflow/react';
import { useCanvasStore } from '@/stores/canvasStore';
import { membersOf } from '@/utils/canvasGroups';

/**
 * 连线拖动过程中的预览线。
 *
 * 默认预览是一条「从起手那个耳朵到指针」的线。组合的小耳朵是个例外：
 * 耳朵长在组合上（方便一次连一片），但组合自己没有内容，真正接线的必须是**里面的每个成员**。
 * 所以从组合起手时，这里给每个成员各画一条预览线 ——
 * 落子时 onConnect 也按同样规则建边（一个成员一条），两边口径一致，看到的线就是最后落下的线。
 *
 * 组合**没有**入口耳朵：它没有内容，别的节点连进来没有意义（虚拟节点只出不进），
 * 所以不存在"往组合上落"的情形，这里只处理起手一侧。
 */

/** 取一个成员输出耳朵（右耳）在画布坐标里的位置（成员在拖动过程中不会移动，按依赖缓存） */
function sourceHandlePoint(internal: InternalNode | undefined) {
  if (!internal) return null;
  const bounds = internal.internals.handleBounds?.source?.[0];
  const pos = internal.internals.positionAbsolute;
  const w = internal.measured?.width ?? 0;
  const h = internal.measured?.height ?? 0;
  if (bounds) {
    return { x: pos.x + bounds.x + bounds.width / 2, y: pos.y + bounds.y + bounds.height / 2 };
  }
  // 没拿到 handleBounds 时退化到节点右边缘中点，预览线也不至于消失
  return { x: pos.x + w, y: pos.y + h / 2 };
}

export const GroupConnectionLine = memo(function GroupConnectionLine() {
  const connection = useConnection();
  const nodes = useCanvasStore((s) => s.nodes);
  const nodeLookup = useStore((s) => s.nodeLookup);

  const fromNodeId = connection.inProgress ? connection.fromNode?.id ?? null : null;
  // 起手节点是组合 → 给它的每个成员各画一条预览线
  const fanOutFrom = useMemo(
    () => (fromNodeId ? membersOf(nodes as never, fromNodeId) : []),
    [nodes, fromNodeId]
  );

  const starts = useMemo(() => {
    if (fanOutFrom.length === 0) return null;
    return fanOutFrom.map((m) => ({ id: m.id, p: sourceHandlePoint(nodeLookup.get(m.id)) })).filter((x) => x.p);
  }, [fanOutFrom, nodeLookup]);

  if (!connection.inProgress || !connection.to) return null;

  const to = connection.to;
  const pairs: { key: string; from: { x: number; y: number }; to: { x: number; y: number } }[] = [];
  if (starts) {
    for (const s of starts) pairs.push({ key: `s-${s.id}`, from: s.p!, to });
  } else {
    pairs.push({ key: 'single', from: connection.from, to });
  }

  return (
    <>
      {pairs.map((pair) => {
        const [path] = getBezierPath({
          sourceX: pair.from.x,
          sourceY: pair.from.y,
          targetX: pair.to.x,
          targetY: pair.to.y,
        });
        return (
          <path
            key={pair.key}
            d={path}
            fill="none"
            className="react-flow__connection-path"
            stroke="#94a3b8"
            strokeWidth={2}
            strokeDasharray={pairs.length > 1 ? '4 3' : undefined}
          />
        );
      })}
    </>
  );
});