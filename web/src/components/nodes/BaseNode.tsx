import { memo, useState, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Badge } from 'antd';
import type { NodeExecutionStatus, LibTVNodeData } from '@/types/canvas';
import { NODE_TYPE_CONFIG, type NodeType } from '@/types/canvas';
import { useCanvasStore } from '@/stores/canvasStore';

interface BaseNodeProps {
  id: string;
  data: LibTVNodeData;
  selected?: boolean;
  children: ReactNode;
  headerRight?: ReactNode;
  className?: string; // 允许子节点追加容器样式（如编辑模式 nodrag）
}

const statusColorMap: Record<NodeExecutionStatus, string> = {
  idle: 'default',
  pending: 'processing',
  running: 'processing',
  success: 'success',
  failed: 'error',
};

export const BaseNode = memo<BaseNodeProps>(function BaseNode({
  id,
  data,
  selected,
  children,
  headerRight,
  className,
}) {
  const nodeType = data.type as NodeType;
  const config = NODE_TYPE_CONFIG[nodeType];
  const status = data.status;
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);

  const [isRenaming, setIsRenaming] = useState(false);
  const [label, setLabel] = useState(data.label || config.label);
  const labelInputRef = useRef<HTMLInputElement>(null);

  const handleLabelChange = useCallback((val: string) => {
    setLabel(val);
  }, []);

  const handleLabelConfirm = useCallback(() => {
    setIsRenaming(false);
    const newLabel = label.trim() || config.label;
    setLabel(newLabel);
    updateNodeData(id, { label: newLabel } as Partial<LibTVNodeData>);
  }, [id, label, config.label, updateNodeData]);

  return (
    <div
      className={`
        min-w-[200px] w-full rounded-xl bg-white shadow-md border border-gray-200 overflow-hidden
        transition-all duration-150
        ${selected ? 'shadow-lg ring-2 ring-blue-400 border-blue-300' : 'hover:shadow-lg'}
        ${className || ''}
      `}
    >
      {/* 节点头部 */}
      <div
        className="flex items-center justify-between px-3 py-1.5 rounded-t-[10px] text-white text-sm font-medium"
        style={{ backgroundColor: config.color }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setIsRenaming(true);
        }}
      >
        <span className="truncate flex-1">
          {isRenaming ? (
            <input
              ref={labelInputRef}
              value={label}
              onChange={(e) => handleLabelChange(e.target.value)}
              onBlur={handleLabelConfirm}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleLabelConfirm();
                e.stopPropagation();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-xs text-gray-800 outline-none focus:border-blue-400"
              autoFocus
            />
          ) : (
            data.label || config.label
          )}
        </span>
        <div className="flex items-center gap-2 flex-shrink-0">
          {headerRight}
          {status !== 'idle' && (
            <Badge status={statusColorMap[status] as 'default' | 'processing' | 'success' | 'error'} />
          )}
        </div>
      </div>

      {/* 节点内容（flex-1 填充剩余空间，relative 供子节点绝对定位） */}
      <div className="px-3 py-2 text-xs text-gray-600 flex-1 min-h-0 relative">
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
        className="!bg-[var(--node-color)] libtv-handle"
        style={{ '--node-color': config.color } as React.CSSProperties}
      />

      {/* 输出 Handle */}
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-[var(--node-color)] libtv-handle"
        style={{ '--node-color': config.color } as React.CSSProperties}
      />
    </div>
  );
});
