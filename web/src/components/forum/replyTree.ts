/**
 * 论坛回复的「楼中楼」分组。
 *
 * 背景：回复表里只存了被回复人的昵称（reply_to_nickname），没有父回复 id，前端只能把
 * 全部回复按时间平铺 —— 于是「在某条留言下点回复」写出来的内容会落到整页最底部，
 * 读者看不出它在回哪一条。现在后端存了 parent_id，这里负责把它还原成
 * 「一条留言 + 挂在它下面的所有回复」。
 *
 * 展示口径是**两层**（不是无限嵌套）：每条顶层留言下面直接铺开它整棵子树，
 * 深层回复靠「回复 @某人」标注看出具体在回谁。这样既满足「回复与留言一一对应」，
 * 又不会在手机上缩进到看不清。
 */

export interface ReplyLike {
  id: string;
  /** 被回复的那条回复 id；空 = 直接回复帖子本身 */
  parent_id?: string;
  created_at?: string;
}

export interface ReplyThread<T extends ReplyLike> {
  /** 顶层留言 */
  root: T;
  /** 挂在它下面的全部回复（含深层），按时间正序 */
  descendants: T[];
}

/**
 * 把扁平回复列表还原成「顶层留言 + 其下回复」的分组。
 *
 * 两条兜底规则，都为了保证**任何一条回复都不会从页面上消失**：
 *  1. 父回复不在当前列表里（分页只取了前 100 条、或父回复已被删除）→ 按顶层展示；
 *  2. 数据异常形成环（a 回 b、b 回 a，没有真正的顶层）→ 也要作为顶层露出来。
 */
export function buildReplyThreads<T extends ReplyLike>(replies: T[]): ReplyThread<T>[] {
  const byId = new Map<string, T>();
  const orderById = new Map<string, number>();
  replies.forEach((r, i) => {
    byId.set(r.id, r);
    orderById.set(r.id, i);
  });

  // 父回复 id → 它的直接子回复（保持传入顺序，也就是时间正序）
  const childrenOf = new Map<string, T[]>();
  const roots: T[] = [];
  for (const r of replies) {
    const pid = r.parent_id;
    const hasParent = !!pid && pid !== r.id && byId.has(pid);
    if (!hasParent) {
      roots.push(r);
      continue;
    }
    const list = childrenOf.get(pid as string);
    if (list) list.push(r);
    else childrenOf.set(pid as string, [r]);
  }

  const visited = new Set<string>();
  const threads: ReplyThread<T>[] = [];

  const buildThread = (root: T) => {
    visited.add(root.id);
    const descendants: T[] = [];
    // 广度优先收完整棵子树；visited 同时防环（数据异常时不至于死循环）
    const queue = [...(childrenOf.get(root.id) ?? [])];
    while (queue.length > 0) {
      const cur = queue.shift() as T;
      if (visited.has(cur.id)) continue;
      visited.add(cur.id);
      descendants.push(cur);
      const kids = childrenOf.get(cur.id);
      if (kids) queue.push(...kids);
    }
    // 同一层留言下面可能混着「回给不同人」的回复，统一按时间正序展示；
    // created_at 缺失或相等时退回原始下标，保证顺序稳定
    descendants.sort((a, b) => {
      const ta = a.created_at || '';
      const tb = b.created_at || '';
      if (ta !== tb) return ta < tb ? -1 : 1;
      return (orderById.get(a.id) ?? 0) - (orderById.get(b.id) ?? 0);
    });
    threads.push({ root, descendants });
  };

  for (const root of roots) {
    if (!visited.has(root.id)) buildThread(root);
  }
  // 兜底 2：仍未被访问到的（环）也各自当成一条顶层留言展示
  for (const r of replies) {
    if (!visited.has(r.id)) buildThread(r);
  }

  return threads;
}
