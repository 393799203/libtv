import { memo, useState, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Badge, Tooltip } from 'antd';
import type { NodeExecutionStatus, LibTVNodeData } from '@/types/canvas';
import { NODE_TYPE_CONFIG, type NodeType } from '@/types/canvas';
import { useCanvasStore } from '@/stores/canvasStore';

interface BaseNodeProps {
  id: string;
  data: LibTVNodeData;
  selected?: boolean;
  children: ReactNode;
  headerRight?: ReactNode;
  /** 覆盖头部背景色（如风格节点用紫色） */
  headerColor?: string;
  className?: string; // 允许子节点追加容器样式（如编辑模式 nodrag）
  /** 去掉内容区域 padding */
  noContentPadding?: boolean;
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
  headerColor,
  className,
  noContentPadding,
}) {
  const nodeType = data.type as NodeType;
  const config = NODE_TYPE_CONFIG[nodeType];
  // 支持覆盖头部颜色（风格节点用紫色）
  const effectiveColor = headerColor || config.color;
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
      data-stale={data.stale ? 'true' : undefined}
      className={`
        min-w-[200px] w-full rounded-xl bg-white shadow-md border border-gray-200 overflow-visible
        transition-all duration-150 relative flex flex-col pt-8
        ${selected ? 'shadow-lg ring-2 border-blue-300' : 'hover:shadow-lg'}
        ${data.stale ? 'ring-2 ring-red-400/70 border-red-300 shadow-[0_0_0_3px_rgba(239,68,68,0.12)]' : ''}
        ${className || ''}
      `}
    >
      {/* 节点头部 — 负 margin 使其视觉上在节点上方 */}
      <div
        className={`-mt-8 flex items-center justify-between py-1 px-3 text-sm font-medium text-gray-700`}
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
            status === 'failed' && data.error ? (
              <Tooltip
                title={data.error}
                placement="bottom"
                overlayInnerStyle={{ maxWidth: 400, width: 'auto' }}
              >
                <Badge status="error" />
              </Tooltip>
            ) : (
              <Badge status={statusColorMap[status] as 'default' | 'processing' | 'success' | 'error'} />
            )
          )}
        </div>
      </div>

      {/* stale 角标：上游重新生成时提示 */}
      {data.stale && (
        <div
          className="absolute top-1 right-1 z-10 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-medium shadow animate-pulse pointer-events-none"
          title="上游节点已重新生成，本节点输出可能已过期"
        >
          待更新
        </div>
      )}

      {/* 节点内容 */}
      <div className={`${noContentPadding ? '' : 'px-3 py-2'} text-xs text-gray-600 flex-1 relative`}>
        {(status === 'running' || status === 'pending') ? (
          // 统一骨架屏：所有节点 running/pending 时展示
          <div className={`flex flex-col h-full w-full justify-center gap-2 ${noContentPadding ? 'px-3 py-2' : 'px-4 py-3'}`}>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 flex-1">
              {Array.from({ length: 10 }).map((_, i) => (
                <div
                  key={i}
                  className="min-h-[18px] bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 rounded animate-pulse"
                  style={{ animationDelay: `${i * 60}ms` }}
                />
              ))}
            </div>
            <div className="text-xs text-gray-400 text-center animate-pulse flex-shrink-0">
              {(data.progressMessage as string | undefined) || '正在执行...'}
            </div>
          </div>
        ) : (
          children
        )}
      </div>

      {/* 输入 Handle */}
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-[var(--node-color)] libtv-handle"
        style={{ '--node-color': effectiveColor } as React.CSSProperties}
      />

      {/* 输出 Handle */}
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-[var(--node-color)] libtv-handle"
        style={{ '--node-color': effectiveColor } as React.CSSProperties}
      />
    </div>
  );
});
