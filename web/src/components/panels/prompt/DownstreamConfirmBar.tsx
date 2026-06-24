import { memo } from 'react';

interface DownstreamConfirmBarProps {
  /** 下游节点数量 */
  count: number;
  /** 点击"重新生成下游" */
  onRegenerate: () => void;
  /** 点击"忽略"（仅关闭弹条） */
  onDismiss: () => void;
}

/**
 * 节点执行完后的下游确认条
 *
 * 当用户改了上游节点的 prompt 并重新生成后，下游节点的输出可能已过期。
 * 给用户两个选择：
 *  1) 重新生成下游 — 调后端 downstream 模式（startNode + BFS 后代）
 *  2) 忽略 — 关闭弹条，下游保留 stale 标（等用户手动处理）
 */
export const DownstreamConfirmBar = memo<DownstreamConfirmBarProps>(function DownstreamConfirmBar({
  count,
  onRegenerate,
  onDismiss,
}) {
  return (
    <div className="mb-2 px-3 py-2 rounded-md bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2 animate-in fade-in slide-in-from-top-1">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
      <span className="flex-1">
        已重新生成。<strong className="font-semibold">{count}</strong> 个下游节点的输出可能已过期。
      </span>
      <button
        onClick={onRegenerate}
        className="px-2 py-1 rounded bg-red-500 text-white text-[11px] font-medium hover:bg-red-600 transition-colors flex-shrink-0"
      >
        重新生成下游
      </button>
      <button
        onClick={onDismiss}
        className="px-2 py-1 rounded text-red-500 text-[11px] font-medium hover:bg-red-100 transition-colors flex-shrink-0"
        title="忽略（下游会保留待更新标）"
      >
        忽略
      </button>
    </div>
  );
});
