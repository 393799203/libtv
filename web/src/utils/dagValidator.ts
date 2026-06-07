import type { LibTVNode, LibTVEdge } from '@/types/canvas';

// DAG 校验：检测环
export function hasCycle(nodes: LibTVNode[], edges: LibTVEdge[]): boolean {
  const adjacency = new Map<string, Set<string>>();
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  // 构建邻接表
  for (const node of nodes) {
    adjacency.set(node.id, new Set());
  }
  for (const edge of edges) {
    adjacency.get(edge.source)?.add(edge.target);
  }

  // DFS 检测环
  function dfs(nodeId: string): boolean {
    visited.add(nodeId);
    recursionStack.add(nodeId);

    const neighbors = adjacency.get(nodeId);
    if (neighbors) {
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          if (dfs(neighbor)) return true;
        } else if (recursionStack.has(neighbor)) {
          return true;
        }
      }
    }

    recursionStack.delete(nodeId);
    return false;
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      if (dfs(node.id)) return true;
    }
  }

  return false;
}

// 获取拓扑排序
export function topologicalSort(nodes: LibTVNode[], edges: LibTVEdge[]): string[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) queue.push(nodeId);
  }

  const result: string[] = [];
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    result.push(nodeId);

    for (const neighbor of adjacency.get(nodeId) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  return result;
}

// 校验 DAG 合法性
export function validateDAG(nodes: LibTVNode[], edges: LibTVEdge[]): {
  valid: boolean;
  error?: string;
} {
  if (hasCycle(nodes, edges)) {
    return { valid: false, error: '工作流中存在循环依赖' };
  }

  // 校验连线是否指向有效节点
  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      return { valid: false, error: '存在无效的连线' };
    }
  }

  return { valid: true };
}
