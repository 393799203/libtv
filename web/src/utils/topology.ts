import type { LibTVNode, LibTVEdge } from '@/types/canvas';
import { membersOf } from '@/utils/canvasGroups';

/**
 * 把「组合」两端的连线摊成成员两端的连线（用于读上游/下游）。
 *
 * 组合只是容器：它自己没内容、也不参与生成，真正有内容的是成员。所以「组合 → 目标」
 * 这条整体连线，在读取上游时要理解成「组合里每个成员 → 目标」——
 * 否则目标会拿到一个空节点（提示词框的上游区一片空白、生成时也没有参考图）。
 *
 * 双向都摊：
 * - source 是组合 → 换成它的成员（组合的产出＝成员的产出）
 * - target 是组合 → 换成它的成员（喂给组合＝喂给每个成员）
 * 既有的成员级连线原样保留（去重）。
 */
export function expandEdgesThroughGroups(nodes: LibTVNode[], edges: LibTVEdge[]): LibTVEdge[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const isGroup = (id: string) => byId.get(id)?.type === 'group';
  if (!edges.some((e) => isGroup(e.source) || isGroup(e.target))) return edges;

  const out: LibTVEdge[] = [];
  const seen = new Set<string>();
  const push = (e: LibTVEdge) => {
    const key = `${e.source}->${e.target}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(e);
  };
  const sides = (id: string) => (isGroup(id) ? membersOf(nodes, id).map((m) => m.id) : [id]);

  for (const e of edges) {
    const sources = sides(e.source);
    const targets = sides(e.target);
    // 两端都是组合时是笛卡尔积；正常情况只有一端是组合
    for (const s of sources) for (const t of targets) push({ ...e, id: `${e.id}__${s}__${t}`, source: s, target: t });
  }
  return out;
}

/**
 * 获取某节点的所有下游节点 ID（BFS 沿正向邻接表）
 */
export function getDownstreamOf(
  startId: string,
  nodes: LibTVNode[],
  edges: LibTVEdge[],
): string[] {
  edges = expandEdgesThroughGroups(nodes, edges);
  const nodeIds = new Set(nodes.map((n) => n.id));
  const result: string[] = [];
  const visited = new Set<string>([startId]);
  const queue: string[] = [startId];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const e of edges) {
      if (e.source === cur && !visited.has(e.target) && nodeIds.has(e.target)) {
        visited.add(e.target);
        result.push(e.target);
        queue.push(e.target);
      }
    }
  }
  return result;
}

/**
 * 获取某节点的所有上游节点 ID（反向 BFS）
 */
export function getUpstreamOf(
  startId: string,
  nodes: LibTVNode[],
  edges: LibTVEdge[],
): string[] {
  edges = expandEdgesThroughGroups(nodes, edges);
  const nodeIds = new Set(nodes.map((n) => n.id));
  const result: string[] = [];
  const visited = new Set<string>([startId]);
  const queue: string[] = [startId];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const e of edges) {
      if (e.target === cur && !visited.has(e.source) && nodeIds.has(e.source)) {
        visited.add(e.source);
        result.push(e.source);
        queue.push(e.source);
      }
    }
  }
  return result;
}

/**
 * 在持久化画布前清掉所有节点的「瞬态字段」：
 * - stale：脏标不存盘；
 * - progressMessage：进度文案（"已运行 40s · 上游生成中"）是**运行期间**的瞬时信息，
 *   结果出来之后它就成了对不上的旧文案。DB 里已经积了一批「success 节点还挂着
 *   '上游处理中'」的记录 —— 正是它被存盘造成的，节点上会显示成永远不结束的进度。
 */
export function clearAllStale(nodes: LibTVNode[]): LibTVNode[] {
  return nodes.map((n) => {
    const hasStale = !!n.data.stale;
    const hasProgress = n.data.progressMessage !== undefined;
    if (!hasStale && !hasProgress) return n;
    const data = { ...n.data } as LibTVNode['data'];
    if (hasStale) data.stale = false;
    if (hasProgress) delete (data as { progressMessage?: string }).progressMessage;
    return { ...n, data };
  });
}
