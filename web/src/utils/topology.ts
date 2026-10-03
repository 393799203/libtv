import type { LibTVNode, LibTVEdge } from '@/types/canvas';

/**
 * 获取某节点的所有下游节点 ID（BFS 沿正向邻接表）
 */
export function getDownstreamOf(
  startId: string,
  nodes: LibTVNode[],
  edges: LibTVEdge[],
): string[] {
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
