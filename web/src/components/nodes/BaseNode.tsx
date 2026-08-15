import { memo, useState, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Tooltip } from 'antd';
import type { LibTVNodeData } from '@/types/canvas';
import { NODE_TYPE_CONFIG, type NodeType } from '@/types/canvas';
import { useCanvasStore } from '@/stores/canvasStore';
import { NodeLoadingState } from './NodeLoadingState';

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
      className={`
        min-w-[200px] w-full rounded-xl bg-white shadow-md border-gray-200 overflow-visible
        transition-all duration-150 relative flex flex-col pt-8 group
        ${selected ? 'shadow-lg ring-2 border-blue-300' : 'hover:shadow-lg'}
        ${status === 'failed' ? 'ring-2 ring-red-400/70 border-red-300 shadow-[0_0_0_3px_rgba(239,68,68,0.12)]' : ''}
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
                <span className="inline-block w-3 h-3 rounded-full bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.6)] cursor-help" />
              </Tooltip>
            ) : (
              <span
                className={`inline-block w-3 h-3 rounded-full ${
                  status === 'success' ? 'bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.5)]' :
                  status === 'pending' || status === 'running' ? 'bg-blue-500 animate-pulse shadow-[0_0_4px_rgba(59,130,246,0.6)]' :
                  status === 'failed' ? 'bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.6)]' :
                  'bg-gray-400'
                }`}
              />
            )
          )}
        </div>
      </div>

      {/* 节点内容 */}
      <div className={`${noContentPadding ? '' : 'px-3 py-2'} text-xs text-gray-600 flex-1 relative`}>
        {/* ✅ 统一loading状态显示：所有节点在pending/running时都显示统一的loading组件 */}
        {(status === 'running' || status === 'pending') ? (
          <NodeLoadingState
            status={status}
            statusText={(data.progressMessage as string | undefined) || (status === 'pending' ? '等待生成中...' : `正在生成${config.label}...`)}
            iconBgColor={nodeType === 'text' ? 'bg-purple-100' : nodeType === 'image' ? 'bg-green-100' : nodeType === 'video' ? 'bg-red-100' : nodeType === 'audio' ? 'bg-emerald-100' : 'bg-blue-100'}
            iconColor={nodeType === 'text' ? 'text-purple-500' : nodeType === 'image' ? 'text-green-500' : nodeType === 'video' ? 'text-red-500' : nodeType === 'audio' ? 'text-emerald-500' : 'text-blue-500'}
          />
        ) : (
          children
        )}
      </div>

      {/* 输入 Handle（左耳）：锚定在节点左边缘中心（连线从边框连出），hover 节点时 ease 弹出 */}
      <Handle
        type="target"
        position={Position.Left}
        className="libtv-handle libtv-handle-left"
      />

      {/* 输出 Handle（右耳）：锚定在节点右边缘中心 */}
      <Handle
        type="source"
        position={Position.Right}
        className="libtv-handle libtv-handle-right"
      />
    </div>
  );
});
