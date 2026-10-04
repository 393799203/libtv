import { memo } from 'react';
import { LoadingOutlined } from '@ant-design/icons';
import type { NodeExecutionStatus } from '@/types/canvas';

interface NodeLoadingStateProps {
  /** 节点执行状态 */
  status: NodeExecutionStatus;
  /** 自定义状态文字（可选，从progressMessage获取） */
  statusText?: string;
  /** 图标背景颜色（可选） */
  iconBgColor?: string;
  /** 图标颜色（可选） */
  iconColor?: string;
  /**
   * 最小高度（可选，画布流坐标像素）。
   * 媒体类节点在"首次生成"时不会渲染 children（图片/视频内容块），
   * 若只用默认的 200px，节点在生成前后会跳高/跳矮（视频节点差 70px，
   * 图片节点若产出非 16:9 差得更多）。传入选定长宽比算出的高度即可让
   * 加载态与产出后尺寸一致、不再跳动。
   */
  minHeight?: number;
  /**
   * 等待预期提示（可选，第二行小字）。
   *
   * 为什么要有：视频节点是**分钟级**的等待，而加载态只有一个转圈 + 「已运行 182s」——
   * 用户不知道还要多久，就会反复点生成、以为卡死了、或者干脆关页面走人。
   * 把「大概要多久、期间可以做什么」直接写在等待的地方，比事后解释有用。
   * 只给长耗时节点传（图片/清晰化是秒级，挂上「十几分钟」只会误导）。
   */
  hint?: string;
}

/**
 * 统一的节点loading状态显示组件
 * - 中间显示loading图标（旋转动画）
 * - 显示状态文字（从SSE接口的progressMessage获取，如"已运行 10s"）
 */
export const NodeLoadingState = memo<NodeLoadingStateProps>(function NodeLoadingState({
  status,
  statusText,
  iconBgColor = 'bg-blue-100',
  iconColor = 'text-blue-500',
  minHeight,
  hint,
}) {
  const isPending = status === 'pending';
  const isRunning = status === 'running';

  // 默认状态文字
  const displayText = statusText || (isPending ? '等待生成中...' : '正在生成...');

  return (
    <div
      className="flex flex-col items-center justify-center h-full py-6 px-4 min-h-[200px]"
      style={minHeight ? { minHeight } : undefined}
    >
      <div className="flex flex-col items-center gap-3 w-full">
        {/* 动画图标 */}
        <div className="relative w-12 h-12 flex items-center justify-center">
          <div className={`absolute inset-0 rounded-xl ${iconBgColor} animate-pulse`} />
          <LoadingOutlined className={`relative text-xl ${iconColor} animate-spin`} />
        </div>

        {/* ✅ 状态文字（包含执行时间，从progressMessage获取） */}
        <span className="text-xs font-medium text-gray-700">
          {displayText}
        </span>

        {/* 等待预期（长耗时节点专用）。
            注意与上一行的分工：上一行是**原有进度**（"已运行 182s"、"正在生成视频…"），
            格式、来源、位置全部保持不变 —— 这行只是它下面**新增**的一条预期说明，
            不替换、不合并，进度该多久报一次就还是多久报一次。 */}
        {hint && (
          <span className="text-[10px] leading-snug text-gray-400 text-center max-w-[240px] whitespace-pre-line">
            {hint}
          </span>
        )}
      </div>
    </div>
  );
});