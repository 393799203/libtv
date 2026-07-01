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
}) {
  const isPending = status === 'pending';
  const isRunning = status === 'running';

  // 默认状态文字
  const displayText = statusText || (isPending ? '等待生成中...' : '正在生成...');

  return (
    <div className="flex flex-col items-center justify-center h-full py-6 px-4 min-h-[200px]">
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
      </div>
    </div>
  );
});