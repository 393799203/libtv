import { useCanvasStore } from '@/stores/canvasStore';
import type { VideoNodeData, VideoReshootState } from '@/types/canvas';

/**
 * 局部更新节点的 `reshoot`，**字段取的是此刻画布上的值**。
 *
 * 为什么必须走这里（线上踩过的坑）：片段条那套东西是异步补齐的 —— 建节点时先只有区间，
 * 时长探测回来后补 `durationSeconds`，缩略图那支慢接口回来后补 `filmstripUrl`。
 * 如果缩略图的回调里用**它自己闭包里的 reshoot**去展开（`{...reshoot, filmstripUrl}`），
 * 那它写回的就是"建节点那一刻"的旧对象：**把刚补上的 durationSeconds 抹掉、把用户拖过的区间退回默认值**。
 * 表现就是用户报的那两条：
 *   - 缩略图加载出来后，两个把手不见了（durationSeconds 没了 → 条认为"不知道视频多长" → 把手禁用+置灰）
 *   - 拖过的区间没有同步进提示词（区间被打回 00:00 - 00:05，和提示词里的时间对不上）
 * 所以这个函数的唯一职责就是：**永远基于当下的数据合并**，绝不基于闭包快照。
 */
export function patchReshoot(nodeId: string, fields: Partial<VideoReshootState>): boolean {
  const store = useCanvasStore.getState();
  const node = store.nodes.find((n) => n.id === nodeId);
  const cur = (node?.data as VideoNodeData | undefined)?.reshoot;
  if (!cur) return false;
  store.updateNodeMeta(nodeId, { reshoot: { ...cur, ...fields } } as never);
  return true;
}

/** 读当下画布上的 reshoot（异步回调里要用最新的，不要用闭包里的） */
export function readReshoot(nodeId: string): VideoReshootState | undefined {
  const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
  return (node?.data as VideoNodeData | undefined)?.reshoot;
}

/**
 * 同一支源视频的缩略图条只需要算一次。
 *
 * 后端算这条要 30 秒左右（源站限速 1.26MB/s，那支测试片 37MB），而"同一支视频上再拉一个重拍节点"
 * 是常见动作。所以先看看画布上有没有**同一 sourceUrl** 已经算好的缩略图，有就直接抄过来，
 * 一秒都不用等。没有才去请求。
 */
export function findFilmstripFor(sourceUrl: string | undefined, exceptNodeId: string): string | undefined {
  if (!sourceUrl) return undefined;
  for (const node of useCanvasStore.getState().nodes) {
    if (node.id === exceptNodeId) continue;
    const r = (node.data as VideoNodeData | undefined)?.reshoot;
    if (r?.sourceUrl === sourceUrl && r.filmstripUrl) return r.filmstripUrl;
  }
  return undefined;
}