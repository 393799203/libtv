import type { CSSProperties } from 'react';
import type { XYPosition } from '@xyflow/react';
import type { LibTVNode } from '@/types/canvas';
import { createNode } from './nodeFactory';

/**
 * 画布「组合」的纯逻辑（不碰 DOM、不碰 store，方便直接测）。
 *
 * 组合本身是一个普通节点（type === 'group'，由 GroupNode 渲染成半透明的虚线容器），
 * 成员节点带上 `parentId` 指向它、`position` 变成**相对组合**的坐标 —— 靠 React Flow
 * 原生父子关系实现「拖组合 = 成员一起走」，前端不需要自己在拖拽里搬成员。
 *
 * 约定：
 * - **只支持一层组合**：组合里不会再放组合（把组合再选进来做组合时，旧组合会被摊平成成员）
 * - 组合框的位置/尺寸永远等于「成员包围盒 + 内边距」，由 normalizeGroups 统一维持
 */

/** 组合框四周的内边距（画布坐标） */
export const GROUP_PADDING = 28;
/** 组合框顶部额外留的高度：标题浮在框上方，不留就会被成员压住 */
export const GROUP_TITLE_GAP = 26;

/** 读不到实测尺寸时的兜底节点尺寸 */
const FALLBACK_SIZE = { w: 320, h: 200 };

/** 组合/成员之间没有实际尺寸时的兜底：优先 React Flow 实测值，其次 style，最后按默认值 */
/**
 * 这两个函数只关心 id / position / parentId / 尺寸，不关心 data。
 * 用结构化类型而不是 LibTVNode：React Flow 的 `useReactFlow().getNodes()` 返回的是通用的
 * `Node[]`（data 是 Record<string, unknown>），不然每个调用点都得写一次类型断言。
 */
export type PositionedNode = Pick<LibTVNode, 'id' | 'position'> & {
  type?: string;
  parentId?: string;
  style?: LibTVNode['style'];
  measured?: LibTVNode['measured'];
};

export function nodeSizeOf(n: PositionedNode): { w: number; h: number } {
  const styleW = typeof n.style?.width === 'number' ? n.style.width : undefined;
  const styleH = typeof n.style?.height === 'number' ? n.style.height : undefined;
  // ⚠️ 组合的尺寸以 style 为准：框的宽高是我们自己算出来写进 style 的，React Flow 的 measured 要等
  // 这一帧渲染完才更新。这里若优先读 measured，重算成员绝对坐标时就会拿到"上一帧的旧框尺寸"，
  // 换算出的成员相对坐标整体偏 (旧宽−新宽)/2（实测：组合内拖单个成员，其余成员被推走 60px）。
  if (n.type === 'group') {
    return { w: styleW ?? n.measured?.width ?? FALLBACK_SIZE.w, h: styleH ?? n.measured?.height ?? FALLBACK_SIZE.h };
  }
  return {
    w: n.measured?.width ?? styleW ?? FALLBACK_SIZE.w,
    h: n.measured?.height ?? styleH ?? FALLBACK_SIZE.h,
  };
}

/**
 * 节点的**绝对**画布坐标（= position 语义对应的那个点：nodeOrigin 0.5 时就是节点中心）。
 *
 * ⚠️ React Flow 对「有父节点的节点」的 position 有一套自己的换算（源码 calculateChildXYZ /
 * getNodePositionWithOrigin）：
 *
 *     子节点绝对左上角 = 父节点绝对左上角 + 子节点 position − 子节点尺寸 × nodeOrigin
 *  ⇒  子节点绝对中心   = 父节点绝对左上角 + 子节点 position        （nodeOrigin=[0.5,0.5] 时正好抵消）
 *
 * 即**子节点的 position 是相对父节点左上角的**，不是中心对中心。曾经按中心对中心算，
 * 成员会被甩到框外、再被视口裁掉，表现为「成组后成员从画面上消失」。
 * 父节点绝对左上角 = 父节点绝对中心 − 父节点尺寸 / 2。
 */
export function absolutePositionOf(node: PositionedNode, byId: Map<string, PositionedNode>): XYPosition {
  let pos = { x: node.position.x, y: node.position.y };
  let cur = node;
  const seen = new Set<string>([node.id]);
  while (cur.parentId) {
    const parent = byId.get(cur.parentId);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    const pSize = nodeSizeOf(parent);
    pos = {
      x: parent.position.x - pSize.w / 2 + pos.x,
      y: parent.position.y - pSize.h / 2 + pos.y,
    };
    cur = parent;
  }
  return pos;
}

/**
 * 便捷版：从节点数组现建索引取绝对坐标。
 * 凡是「要把某个节点的坐标拿去当绝对坐标用」的地方都该走这里 —— 组合成员的 position
 * 是相对的，直接拿来用就会把东西放到别处（提示词框跑中间、新节点落错位置、适应视图框不全）。
 */
export function absolutePositionIn(nodes: readonly PositionedNode[], node: PositionedNode): XYPosition {
  return absolutePositionOf(node, new Map(nodes.map((n) => [n.id, n])));
}

/** 组合里直接挂着的成员（不含组合自身） */
export function membersOf(nodes: LibTVNode[], groupId: string): LibTVNode[] {
  return nodes.filter((n) => n.parentId === groupId && n.type !== 'group');
}

interface Box {
  /** 组合框左上角（画布坐标） */
  left: number;
  top: number;
  width: number;
  height: number;
  /** 组合节点自己的 position —— ⚠️ 本画布 nodeOrigin=[0.5,0.5]，节点的 position 是**中心点** */
  center: XYPosition;
}

/**
 * 由成员算出组合框：成员**包围盒** + 内边距（顶部多留标题那一条）。
 *
 * ⚠️ 坐标约定：Canvas 上 ReactFlow 的 nodeOrigin 是 [0.5, 0.5]，也就是节点的 position 是
 * 节点的**中心点**（DOM 里由 transform 把节点居中到该点）。所以包围盒必须按
 * `center ± size/2` 算，不能直接把 position 当左上角 —— 否则框会整体偏掉半个节点。
 */
function boxForMembers(members: LibTVNode[], byId: Map<string, LibTVNode>): Box {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const m of members) {
    const c = absolutePositionOf(m, byId);
    const { w, h } = nodeSizeOf(m);
    x1 = Math.min(x1, c.x - w / 2);
    y1 = Math.min(y1, c.y - h / 2);
    x2 = Math.max(x2, c.x + w / 2);
    y2 = Math.max(y2, c.y + h / 2);
  }
  const left = x1 - GROUP_PADDING;
  const top = y1 - GROUP_PADDING - GROUP_TITLE_GAP;
  const width = x2 - x1 + GROUP_PADDING * 2;
  const height = y2 - y1 + GROUP_PADDING * 2 + GROUP_TITLE_GAP;
  return {
    left,
    top,
    width,
    height,
    center: { x: left + width / 2, y: top + height / 2 },
  };
}

/**
 * 把每个组合挪到它的第一个成员**前面**（幂等）。
 * React Flow 按数组顺序建父子索引，父节点排在子节点后面时子节点算不出绝对坐标
 * （控制台报 "Parent node not found"），表现为拖组合时成员不跟随。
 * 老画布（这个修复之前存的）里组合就在最后，所以加载时也统一过一遍。
 */
function orderGroupsBeforeMembers(nodes: LibTVNode[]): LibTVNode[] {
  let out: LibTVNode[] | null = null;
  for (let i = 0; i < nodes.length; i += 1) {
    const n = nodes[i];
    if (n.type !== 'group') continue;
    const src = out ?? nodes;
    const firstMember = src.findIndex((m) => m.parentId === n.id);
    if (firstMember === -1 || firstMember > src.indexOf(n)) continue;
    out = out ?? [...nodes];
    out.splice(out.indexOf(n), 1);
    out.splice(out.findIndex((m) => m.parentId === n.id), 0, n);
  }
  return out ?? nodes;
}

/**
 * 组合容器归一化（纯函数、**幂等**，没变化时原样返回同一个数组引用）：
 *
 * 0. 组合排在成员前面（React Flow 的父子索引要求）。
 * 1. 父子关系悬空（父节点已被删/不存在）→ 摘出来并转成绝对坐标，否则成员会画到别处或消失；
 *    组合自身还挂着 parentId 的（历史/异常数据）也一并拍平 —— 组合只支持一层。
 * 2. 每个组合的位置/尺寸 = 成员包围盒 + 内边距。
 *    ⚠️ 组合原点移动时，**成员的相对坐标要同步反向平移**，保证成员的绝对位置不动；
 *    否则每归一化一次，框就往外漂一圈（内边距会被反复加进去）。
 * 3. 没有任何成员的组合直接删掉（删光了成员的组合没有存在意义）。
 *
 * @param goneNodes 刚从画布上删掉的节点。删组合时必须把它们传进来：成员的绝对坐标要按
 *   组合**删除前**的原点换算，否则成员会停在相对坐标上（表现为删掉组合后成员整体跳一下）。
 */
export function normalizeGroups(nodes: LibTVNode[], goneNodes: LibTVNode[] = []): LibTVNode[] {
  const ordered = orderGroupsBeforeMembers(nodes);
  // 顺序变了也算"有变化"（要写回 store），所以先在这里记下来
  let changed = ordered !== nodes;
  const byId = new Map(ordered.map((n) => [n.id, n]));
  // 坐标解析用的表：现存节点 + 刚被删掉的节点（只有换算坐标时会命中后者）
  const byRef = goneNodes.length > 0
    ? new Map([...goneNodes, ...ordered].map((n) => [n.id, n]))
    : byId;

  // 1) 摘掉悬空的父子关系
  const list = ordered.map((n) => {
    if (!n.parentId) return n;
    const parent = byId.get(n.parentId);
    if (parent && n.type !== 'group') return n;
    changed = true;
    const ref = byRef.get(n.parentId);
    return {
      ...n,
      parentId: undefined,
      position: ref ? absolutePositionOf(n, byRef) : n.position,
    };
  });

  const byId2 = new Map(list.map((n) => [n.id, n]));
  const drop = new Set<string>();
  const groupPatch = new Map<string, { position: XYPosition; width: number; height: number }>();
  const memberPatch = new Map<string, XYPosition>();

  // 2) 框贴合成员
  for (const g of list) {
    if (g.type !== 'group') continue;
    const members = membersOf(list, g.id);
    if (members.length === 0) {
      drop.add(g.id);
      changed = true;
      continue;
    }
    const box = boxForMembers(members, byId2);
    const dx = box.center.x - g.position.x;
    const dy = box.center.y - g.position.y;
    const sizeOk = g.style?.width === box.width && g.style?.height === box.height;
    if (dx === 0 && dy === 0 && sizeOk) continue;
    changed = true;
    groupPatch.set(g.id, { position: box.center, width: box.width, height: box.height });
    // 成员的相对坐标 = 成员绝对中心 − 组合**新**左上角。逐条直接重算，不走增量：
    // 增量算法在组合尺寸变化时会漏掉「尺寸变化/2」那一项，成员会被推着一起漂。
    const newTopLeft = { x: box.center.x - box.width / 2, y: box.center.y - box.height / 2 };
    for (const m of members) {
      const abs = absolutePositionOf(m, byId2);   // 旧坐标系下的成员绝对中心（此时组合还是老位置/老尺寸）
      const want = { x: abs.x - newTopLeft.x, y: abs.y - newTopLeft.y };
      if (want.x !== m.position.x || want.y !== m.position.y) memberPatch.set(m.id, want);
    }
  }

  if (!changed) return nodes;

  return list
    .filter((n) => !drop.has(n.id))
    .map((n) => {
      const gp = groupPatch.get(n.id);
      if (gp) {
        const style: CSSProperties = { ...n.style, width: gp.width, height: gp.height };
        return { ...n, position: gp.position, style };
      }
      const mp = memberPatch.get(n.id);
      return mp ? { ...n, position: mp } : n;
    });
}

/**
 * 由「当前选中的节点」算出新组合与重新挂载后的成员（纯函数，供 store 一次写入）。
 *
 * - 选中的旧组合会被**摊平**：它的成员并进新组合、旧组合删掉（因此不会出现嵌套组合）
 * - 成员少于 2 个时返回 null（一个节点"组合"没有意义）
 */
export function buildGroupFromSelection(
  nodes: LibTVNode[],
  selected: LibTVNode[]
): { group: LibTVNode; members: LibTVNode[]; removedGroupIds: string[] } | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const removedGroupIds: string[] = [];
  const picked: LibTVNode[] = [];

  for (const n of selected) {
    if (n.type === 'group') {
      removedGroupIds.push(n.id);
      picked.push(...membersOf(nodes, n.id));
    } else {
      picked.push(n);
    }
  }
  const members = [...new Map(picked.map((n) => [n.id, n])).values()].filter((n) => n.type !== 'group');
  if (members.length < 2) return null;

  const box = boxForMembers(members, byId);
  const group = createNode('group', { x: box.center.x, y: box.center.y }, {
    style: { width: box.width, height: box.height },
  });
  group.selected = true;

  return {
    group,
    members: members.map((m) => {
      const abs = absolutePositionOf(m, byId);
      return {
        ...m,
        parentId: group.id,
        // ⚠️ 相对坐标的基准是**组合的左上角**（不是组合中心）：见 absolutePositionOf 的注释。
        // 组合左上角 = 组合中心 - 组合尺寸/2
        position: {
          x: abs.x - (box.center.x - box.width / 2),
          y: abs.y - (box.center.y - box.height / 2),
        },
        selected: false,
      };
    }),
    removedGroupIds,
  };
}

/** 解除组合：成员还原成绝对坐标 + 取消 parentId，返回解绑后的成员（调用方负责删掉组合） */
export function releaseGroupMembers(nodes: LibTVNode[], group: LibTVNode): LibTVNode[] {
  return nodes
    .filter((n) => n.parentId === group.id)
    .map((m) => ({
      ...m,
      parentId: undefined,
      position: absolutePositionOf(m, new Map(nodes.map((x) => [x.id, x]))),
      selected: true,
    }));
}