import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import { Select, Segmented, Tooltip } from 'antd';
import {
  FormatPainterOutlined,
  ThunderboltOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import { BaseNode } from './BaseNode';
import type { EnhanceNodeData } from '@/types/canvas';
import { useCanvasStore } from '@/stores/canvasStore';
import { useNodeGeneration } from '@/hooks/useNodeGeneration';
import { getUpstreamOf } from '@/utils/topology';
import {
  enhanceApi,
  FALLBACK_ENHANCE_CHANNELS,
  type EnhanceChannelsResult,
} from '@/services/enhanceApi';

type EnhanceNodeType = Node<EnhanceNodeData, 'enhance'>;

/**
 * 清晰化节点（P0 本地档）。
 *
 * 设计要点：它是**独立节点**，不是视频节点上的一个开关 ——
 * 因此可以对画布上任何已生成的片段重做清晰化（不必重新生成、不重复扣费），
 * 也可以同一片段反复试档位做 A/B。
 *
 * 渠道与档位**都不是这个文件写死的**：它们来自后端 enhance.yaml（经 /enhance/providers 下发），
 * 运营加渠道/改档位/换文案后重启后端即生效，前端不用发版。这里只负责渲染与把选择写进节点数据。
 */
export const EnhanceNode = memo<NodeProps<EnhanceNodeType>>(function EnhanceNode({ id, data, selected }) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const { generate, isGenerating, progress } = useNodeGeneration({ nodeId: id });

  // 显示原片还是增强后（对比用）
  const [showSource, setShowSource] = useState(false);

  // 渠道 + 档位清单：以后端配置为准
  const [channelList, setChannelList] = useState<EnhanceChannelsResult>(FALLBACK_ENHANCE_CHANNELS);
  useEffect(() => {
    let alive = true;
    void enhanceApi.listChannels().then((res) => {
      if (alive) setChannelList(res);
    });
    return () => { alive = false; };
  }, []);

  const channels = channelList.channels;
  const availableChannels = channels.filter((c) => c.available);
  // 只有一条可用渠道时不渲染下拉：给用户一个没得选的控件只是占地方（今天就是这种情况）。
  // P1 接入云端档后可用渠道变成 ≥2，下拉自动出现，这里不用改。
  // 判据用「可用」而非「已注册」：注册了但未开通的渠道选不了，不该为它撑出下拉。
  const showChannelSelect = availableChannels.length > 1;
  const selectedChannel =
    channels.find((c) => c.id === (data.provider || channelList.defaultChannel)) ?? channels[0];

  // 档位：该渠道提供的档位。节点数据里的 mode（老画布是 level）若不在其中，
  // 就回落到该渠道的默认档 —— 只影响显示，后端执行时同样会做一遍解析
  const modes = selectedChannel?.modes ?? [];
  const storedMode = data.mode ?? data.level;
  const mode =
    modes.find((m) => m.id === storedMode)?.id
    ?? modes.find((m) => m.default)?.id
    ?? modes[0]?.id
    ?? storedMode
    ?? '';

  // 上游是否已连好带视频的节点：没连上游时给明确提示，避免用户点了没反应
  const upstreamHasVideo = useMemo(() => {
    const upstreamIds = getUpstreamOf(id, nodes, edges);
    return upstreamIds.some((nid) => {
      const n = nodes.find((x) => x.id === nid);
      const d = (n?.data ?? {}) as Record<string, unknown>;
      return typeof d.videoUrl === 'string' && d.videoUrl.length > 0;
    });
  }, [id, nodes, edges]);

  const handleModeChange = useCallback(
    (value: string) => {
      if (isGenerating) return;
      updateNodeData(id, { mode: value } as Partial<EnhanceNodeData>);
    },
    [id, isGenerating, updateNodeData]
  );

  const handleChannelChange = useCallback(
    (value: string) => {
      if (isGenerating) return;
      // 换渠道时把档位清成新渠道默认档：旧渠道的档位 ID 在新渠道大概率不存在，
      // 留着它会显示成一个后端会拒绝的组合
      const next = channels.find((c) => c.id === value);
      const nextMode = next?.modes.find((m) => m.default)?.id ?? next?.modes[0]?.id ?? '';
      updateNodeData(id, { provider: value, mode: nextMode } as Partial<EnhanceNodeData>);
    },
    [id, isGenerating, updateNodeData, channels]
  );

  const handleRun = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    void generate();
  }, [generate]);

  // 档位展示名优先用后端回写的（配置里的 label），没有则按当前选择显示
  const appliedModeLabel =
    (data.enhanceModeLabel as string | undefined)
    ?? modes.find((m) => m.id === (data.enhanceRequestedMode ?? data.enhanceLevel))?.label
    ?? modes.find((m) => m.id === mode)?.label;
  const elapsedMs = typeof data.enhanceElapsedMs === 'number' ? (data.enhanceElapsedMs as number) : undefined;
  const srcSize = data.enhanceSourceSize as string | undefined;
  const dstSize = data.enhanceTargetSize as string | undefined;
  const displayUrl = showSource ? data.sourceUrl : data.videoUrl;

  return (
    <BaseNode id={id} data={data} selected={selected}>
      <div className="w-full flex flex-col gap-2">
        {/* 工具条：渠道 + 档位 + 运行，全部压在一行。
            竖着堆三行会把节点撑得很高，画布上一屏看不到几个节点；
            顺序按「先选什么用什么处理 → 处理成什么样 → 开跑」来排 */}
        <div
          /* nodrag/nopan 是 React Flow 的约定（TextNode 编辑态同样写法）：
             少了它，在下拉上按下鼠标会被当成「拖节点」，antd 的下拉根本收不到点击 ——
             表现就是「点了没反应、打不开」。onMouseDownCapture 再兜一层。 */
          className="flex items-center gap-1.5 nodrag nopan"
          onMouseDownCapture={(e) => e.stopPropagation()}
        >
          {/* 渠道：≥2 条可用渠道才出现（选项与说明来自后端注册表） */}
          {showChannelSelect && (
          <div className="shrink-0 w-[150px]">
            <Select
              className="w-full"
              value={selectedChannel?.id}
              onChange={handleChannelChange}
              disabled={isGenerating}
              // 下拉比触发器宽：渠道说明有 60 多个字，挤在 120px 里会变成三行
              popupMatchSelectWidth={280}
              optionLabelProp="label"
              options={channels.map((c) => ({
                value: c.id,
                label: c.label,
                disabled: !c.available,
              }))}
              // 下拉里直接摊开渠道说明：用户不必悬停就能看到这条渠道的代价与边界
              optionRender={(opt) => {
                const c = channels.find((x) => x.id === String(opt.value));
                if (!c) return String(opt.label ?? '');
                return (
                  <div className="flex flex-col gap-0.5 py-0.5">
                    <span className="text-xs font-medium">
                      {c.label}
                      {!c.available && <span className="ml-1 text-[10px] font-normal text-gray-400">未开通</span>}
                    </span>
                    <span className="text-[10px] leading-snug text-gray-400 whitespace-normal">{c.description}</span>
                  </div>
                );
              }}
            />
          </div>
          )}

          {/* 档位：分段控件（比两个按钮省一半横向空间），宽度由内容决定 */}
          <div className="shrink-0">
          <Segmented
            value={mode}
            disabled={isGenerating || modes.length === 0}
            onChange={(v) => handleModeChange(String(v))}
            options={modes.map((m) => ({
              value: m.id,
              label: (
                <Tooltip title={m.description}>
                  <span className={isGenerating ? 'cursor-not-allowed' : 'cursor-pointer'}>{m.label}</span>
                </Tooltip>
              ),
            }))}
          />
          </div>

          {/* 运行：原来独占一行，现在收到同一排最右侧 */}
          <button
            className={`flex-1 min-w-0 h-8 px-2.5 text-xs font-medium rounded flex items-center justify-center gap-1 transition-colors ${
              isGenerating
                ? 'bg-sky-100 text-sky-400 cursor-not-allowed'
                : 'bg-sky-500 hover:bg-sky-600 text-white cursor-pointer'
            }`}
            onClick={handleRun}
            disabled={isGenerating}
          >
            <ThunderboltOutlined />
            {isGenerating
              ? `清晰化中…${progress > 0 ? ` ${progress}%` : ''}`
              : data.videoUrl
                ? '重新清晰化'
                : '开始清晰化'}
          </button>
        </div>

        {/* 结果 / 占位 */}
        {displayUrl ? (
          <div className="relative w-full rounded overflow-hidden bg-black">
            <video
              key={displayUrl}
              src={displayUrl}
              className="w-full max-h-64 object-contain"
              controls
              preload="metadata"
              playsInline
            />
            {/* 处理结果徽标：档位 + 尺寸 + 耗时，全部来自后端留痕，不猜 */}
            {appliedModeLabel && !showSource && (
              <span className="absolute top-1 left-1 flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-600/85 text-[10px] text-white">
                <FormatPainterOutlined />
                已清晰化 · {appliedModeLabel}
                {data.enhanceProviderLabel ? ` · ${data.enhanceProviderLabel}` : ''}
                {dstSize ? ` · ${dstSize}` : ''}
                {elapsedMs ? ` · ${(elapsedMs / 1000).toFixed(1)}s` : ''}
              </span>
            )}
            {showSource && (
              <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/70 text-[10px] text-white">
                原片
              </span>
            )}
          </div>
        ) : (
          <div className="w-full h-32 rounded-lg bg-gray-50 flex flex-col items-center justify-center gap-1.5">
            <FormatPainterOutlined className="text-3xl text-gray-300" />
            <span className="text-xs text-gray-400">
              {upstreamHasVideo ? '点「开始清晰化」处理上游视频' : '把视频节点连到左侧输入'}
            </span>
          </div>
        )}

        {/* 尺寸变化 + 原片对比 */}
        {(srcSize || dstSize) && data.videoUrl && (
          <div className="flex items-center justify-between text-[11px] text-gray-500">
            <span className="tabular-nums">
              {srcSize}{dstSize && srcSize !== dstSize ? ` → ${dstSize}` : ''}
            </span>
            {data.sourceUrl && (
              <button
                className="flex items-center gap-1 text-sky-600 hover:text-sky-700 cursor-pointer nodrag nopan"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); setShowSource((v) => !v); }}
              >
                <SwapOutlined />
                {showSource ? '看增强后' : '看原片'}
              </button>
            )}
          </div>
        )}

        {data.status === 'failed' && data.error ? (
          /* 失败原因常常是可行动的（如「源视频超过本地档上限，请先剪切」），
             直接摊在节点上，而不是只藏在小红点的 tooltip 里 */
          <span className="text-[11px] leading-relaxed text-red-500 break-words">{String(data.error)}</span>
        ) : null}

        <Tooltip title={selectedChannel?.description}>
          <span className="text-[10px] text-gray-400 leading-tight cursor-help">
            {selectedChannel?.id === 'ffmpeg'
              ? '本机处理 · 不额外扣积分 · 不补帧'
              : selectedChannel?.label ?? '本机处理 · 不额外扣积分'}
            {!showChannelSelect ? ' · 更多渠道后续接入' : ''}
          </span>
        </Tooltip>
      </div>
    </BaseNode>
  );
});