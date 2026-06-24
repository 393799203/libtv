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
 * 在持久化画布前清掉所有节点的 stale 标记（脏标不存盘）
 */
export function clearAllStale(nodes: LibTVNode[]): LibTVNode[] {
  return nodes.map((n) => {
    if (!n.data.stale) return n;
    return {
      ...n,
      data: { ...n.data, stale: false } as LibTVNode['data'],
    };
  });
}
