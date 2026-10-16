import { memo, useState, useRef, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Tooltip } from 'antd';
import { LoadingOutlined, WarningOutlined } from '@ant-design/icons';
import type { LibTVNodeData } from '@/types/canvas';
import { NODE_TYPE_CONFIG, type NodeType } from '@/types/canvas';
import { useCanvasStore } from '@/stores/canvasStore';
import { NodeLoadingState } from './NodeLoadingState';
import { describeNodeError, refundText, type DescribedNodeError } from '@/utils/nodeErrorText';

/**
 * 「生成中」的等待预期文案（按节点类型）。
 *
 * 只有视频写：它是分钟级等待（实测一条 9 秒 480p 跑了 182s，高清晰度/长镜头更久），
 * 而图片、清晰化、分镜提取都是秒级 —— 给它们挂「十几分钟」只会让用户以为更慢。
 */
const WAIT_HINTS: Partial<Record<NodeType, string>> = {
  video: '请耐心等待：通常需要 3–10 分钟，长镜头或高清晰度可能十几分钟\n可以先去做别的，页面开着就行，完成后会自动出现',
};

/**
 * 错误的「详情」悬浮内容：人话在上，给运营看的原始文案在下。
 * 原始文案（含上游字段路径、错误码、JSON）不丢，但不占节点上的位置 —— 用户看的是上面两行。
 */
function NodeErrorDetail({ info }: { info: DescribedNodeError }) {
  const refund = refundText(info.refund);
  return (
    <div className="max-w-[420px] text-xs">
      <div className="font-medium text-red-500">{info.title}</div>
      {info.hint ? <div className="mt-1 leading-snug">{info.hint}</div> : null}
      {refund ? <div className="mt-1 text-[11px] opacity-80">{refund}</div> : null}
      <div className="mt-2 border-t border-current/20 pt-2 text-[11px] opacity-80">
        <div className="mb-0.5">详情（排查用，可直接复制）：</div>
        <div className="max-h-[220px] overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-snug">
          {info.detail}
        </div>
        {info.detail !== info.raw ? (
          <div className="mt-1 max-h-[160px] overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-snug opacity-70">
            {info.raw}
          </div>
        ) : null}
      </div>
    </div>
  );
}

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
  /** 加载态最小高度（画布流坐标像素）：媒体节点传入按长宽比算出的高度，
   *  避免"首次生成"时节点比产出后矮/高（详见 NodeLoadingState.minHeight） */
  loadingMinHeight?: number;
  /** 隐藏输入 Handle（如白模预演节点不连上游） */
  hideInputHandle?: boolean;
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
  loadingMinHeight,
  hideInputHandle,
}) {
  const nodeType = data.type as NodeType;
  const config = NODE_TYPE_CONFIG[nodeType];
  // 支持覆盖头部颜色（风格节点用紫色）
  const effectiveColor = headerColor || config.color;
  const status = data.status;
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);

  /**
   * 失败原因翻译成用户能看懂的话。
   * 后端原样透传的错误里混着上游字段路径与错误码（如 content[6].image_url.url、
   * InvalidParameter.WidthTooSmall），用户看不懂；这里只保留"我该改什么 + 钱退没退"。
   * 尺寸类错误还会顺着节点引用的素材查出具体是哪一张太小（见 nodeErrorText.ts）。
   */
  const nodeError = useMemo(() => {
    if (status !== 'failed' || !data.error) return null;
    const raw = String(data.error);
    let smallRefs: { label: string; size: string }[] = [];
    if (/WidthTooSmall|宽度和高度需在|Width must be between/i.test(raw)) {
      const mentions = (data as { mentions?: { nodeId: string; label?: string }[] }).mentions ?? [];
      const all = useCanvasStore.getState().nodes;
      smallRefs = mentions.flatMap((m) => {
        const ref = all.find((n) => n.id === m.nodeId);
        const w = Number((ref?.data as { width?: number } | undefined)?.width ?? 0);
        const h = Number((ref?.data as { height?: number } | undefined)?.height ?? 0);
        if (!w || !h) return [];
        if (w >= 300 && h >= 300) return [];
        return [{ label: m.label || (ref?.data.label as string) || '引用图', size: `${w}×${h}` }];
      });
    }
    return describeNodeError(raw, { smallRefs });
  }, [status, data]);

  // 是否已有上一次的产出。用来区分两种情况：
  // - 首次生成（无旧结果）：显示统一加载态
  // - 重新生成（有旧结果）：保留旧结果半透明做对照 + 叠加"重新生成中"遮罩
  const hasExistingOutput = (() => {
    const d = data as Record<string, unknown>;
    switch (nodeType) {
      case 'image':
        return Boolean(d.imageUrl);
      case 'video':
      case 'previz':
      case 'enhance':
        return Boolean(d.videoUrl);
      case 'audio':
        return Boolean(d.audioUrl);
      case 'text':
        return Boolean(d.content);
      case 'script':
        // 剧本节点有两种产出：正文 scriptContent + 分镜列表 shots。
        // 任一存在都算"有旧结果"，只生成了分镜的情况不能漏判。
        return Boolean(d.scriptContent) || (Array.isArray(d.shots) && d.shots.length > 0);
      default:
        return false;
    }
  })();

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
        min-w-[200px] w-full rounded-[0.5rem] bg-white border-gray-200 overflow-visible shadow-[var(--dv-hairline),var(--dv-elev-1)]
        transition-all duration-150 relative flex flex-col pt-8 group
        ${selected ? 'ring-2 border-cyan-400 shadow-[var(--dv-hairline),var(--dv-elev-3)]' : 'ring-1 ring-white/10 hover:shadow-[var(--dv-hairline),var(--dv-elev-2)]'}
        ${status === 'failed' ? 'ring-2 ring-red-400/70 border-red-300 shadow-[0_0_0_3px_rgba(239,68,68,0.12)]' : ''}
        ${className || ''}
      `}
    >
      {/* 节点头部 — 负 margin 使其视觉上在节点上方 */}
      <div
        className={`-mt-8 flex items-center justify-between py-1 px-3 text-[13px] font-medium text-gray-700`}
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
                title={nodeError ? <NodeErrorDetail info={nodeError} /> : String(data.error)}
                placement="bottom"
                overlayInnerStyle={{ maxWidth: 460, width: 'auto' }}
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
        {(status === 'running' || status === 'pending') ? (
          hasExistingOutput ? (
            /* 重新生成：保留上一次的产出做对照（半透明、不可交互），叠加遮罩说明正在重跑。
               直接清空换成加载态会让用户以为结果丢了；跑完后由 SSE 回填替换。
               ⚠️ 这层壳不能再加 position（relative/absolute 都不行）：内容区里有节点
               （如剧本/文本节点）用 absolute inset-0 撑满内容区，多一层定位壳会把它们的
               基准换成这层高度为 0 的壳，旧内容会被压成一行并冒出滚动条。 */
            <>
              <div className="opacity-40 pointer-events-none select-none" aria-hidden="true">
                {children}
              </div>
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-md bg-white/45 backdrop-blur-[1px]">
                <LoadingOutlined className="text-xl text-blue-500 animate-spin" />
                <span className="text-[11px] font-medium text-blue-600">
                  {status === 'pending' ? '等待生成中...' : '重新生成中...'}
                </span>
                {data.progressMessage ? (
                  <span className="text-[10px] text-gray-500">{data.progressMessage}</span>
                ) : null}
                {WAIT_HINTS[nodeType] ? (
                  <span className="text-[10px] leading-snug text-gray-400 text-center max-w-[240px] whitespace-pre-line">
                    {WAIT_HINTS[nodeType]}
                  </span>
                ) : null}
              </div>
            </>
          ) : (
            /* 首次生成：没有旧结果可留，显示统一加载态 */
            <NodeLoadingState
              status={status}
              hint={WAIT_HINTS[nodeType]}
              minHeight={loadingMinHeight}
              statusText={(data.progressMessage as string | undefined) || (status === 'pending' ? '等待生成中...' : `正在生成${config.label}...`)}
              iconBgColor={nodeType === 'text' ? 'bg-purple-100' : nodeType === 'image' ? 'bg-green-100' : nodeType === 'video' ? 'bg-red-100' : nodeType === 'audio' ? 'bg-emerald-100' : 'bg-blue-100'}
              iconColor={nodeType === 'text' ? 'text-purple-500' : nodeType === 'image' ? 'text-green-500' : nodeType === 'video' ? 'text-red-500' : nodeType === 'audio' ? 'text-emerald-500' : 'text-blue-500'}
            />
          )
        ) : (
          children
        )}
      </div>

      {/* 失败原因：直接摊在节点上（只藏在小红点 tooltip 里用户根本看不到）。
          显示的是翻译后的「人话」，原始报错在悬浮详情里，不占这里的版面。 */}
      {nodeError && (
        <Tooltip
          title={<NodeErrorDetail info={nodeError} />}
          placement="bottom"
          overlayInnerStyle={{ maxWidth: 460, width: 'auto' }}
        >
          <div className="mx-3 mb-2 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 cursor-help">
            <div className="flex items-start gap-1.5">
              <WarningOutlined className="mt-[2px] shrink-0 text-[11px] text-red-500" />
              <div className="min-w-0">
                <div className="text-[11px] font-medium leading-snug text-red-600">{nodeError.title}</div>
                {nodeError.hint ? (
                  <div className="mt-0.5 text-[10px] leading-snug text-red-500/90">{nodeError.hint}</div>
                ) : null}
                {refundText(nodeError.refund) ? (
                  <div className="mt-0.5 text-[10px] leading-snug text-gray-500">
                    {refundText(nodeError.refund)}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </Tooltip>
      )}

      {/* 输入 Handle（左耳）：锚定在节点左边缘中心（连线从边框连出），hover 节点时 ease 弹出 */}
      {!hideInputHandle && (
        <Handle
          type="target"
          position={Position.Left}
          className="libtv-handle libtv-handle-left"
        >
          {/* 不可见的抓取区：比可见圆圈更大、且整体偏节点外侧（CSS 里定义） */}
          <span className="libtv-handle-hit" aria-hidden />
        </Handle>
      )}

      {/* 输出 Handle（右耳）：锚定在节点右边缘中心 */}
      <Handle
        type="source"
        position={Position.Right}
        className="libtv-handle libtv-handle-right"
      >
        <span className="libtv-handle-hit" aria-hidden />
      </Handle>
    </div>
  );
});
