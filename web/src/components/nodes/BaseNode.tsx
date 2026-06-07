import { memo, type FC, type ReactNode } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Badge, Tooltip } from 'antd';
import {
  LoadingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import type { NodeExecutionStatus, LibTVNodeData } from '@/types/canvas';
import { NODE_TYPE_CONFIG, type NodeType } from '@/types/canvas';

interface BaseNodeProps {
  id: string;
  data: LibTVNodeData;
  selected?: boolean;
  children: ReactNode;
}

const statusIconMap: Record<NodeExecutionStatus, ReactNode> = {
  idle: null,
  pending: <ClockCircleOutlined className="text-gray-400" />,
  running: <LoadingOutlined className="text-blue-500 animate-spin" />,
  success: <CheckCircleOutlined className="text-green-500" />,
  failed: <CloseCircleOutlined className="text-red-500" />,
};

const statusColorMap: Record<NodeExecutionStatus, string> = {
  idle: 'default',
  pending: 'processing',
  running: 'processing',
  success: 'success',
  failed: 'error',
};

export const BaseNode = memo<BaseNodeProps>(function BaseNode({
  data,
  selected,
  children,
}) {
  const nodeType = data.type as NodeType;
  const config = NODE_TYPE_CONFIG[nodeType];
  const status = data.status;

  return (
    <div
      className={`
        min-w-[200px] w-full rounded-lg border-2 bg-white shadow-sm
        transition-shadow duration-150
        ${selected ? 'shadow-lg ring-2 ring-blue-400' : 'hover:shadow-md'}
      `}
      style={{ borderColor: config.color }}
    >
      {/* 节点头部 */}
      <div
        className="flex items-center justify-between px-3 py-1.5 rounded-t-md text-white text-sm font-medium"
        style={{ backgroundColor: config.color }}
      >
        <span className="truncate">{data.label || config.label}</span>
        {status !== 'idle' && (
          <Badge status={statusColorMap[status] as 'default' | 'processing' | 'success' | 'error'} />
        )}
      </div>

      {/* 节点内容 */}
      <div className="px-3 py-2 text-xs text-gray-600">
        {children}
      </div>

      {/* 错误信息 */}
      {data.error && (
        <div className="px-3 pb-2 text-xs text-red-500 truncate">
          {data.error}
        </div>
      )}

      {/* 输入 Handle */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white"
      />

      {/* 输出 Handle */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white"
      />
    </div>
  );
});
