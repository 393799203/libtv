import { memo, useMemo, useState, useEffect } from 'react';
import { SoundOutlined } from '@ant-design/icons';
import type { ModelOption, ResolutionOption } from '@/types/prompt';
import type { NodeType } from '@/types/canvas';
import { RESOLUTION_OPTIONS, VIDEO_RESOLUTION_OPTIONS, ASPECT_RATIO_ROWS, WAN3_VIDEO_ASPECT_RATIOS, buildDurationOptions } from '@/configs/promptConfig';
import { pricingApi, type NodePriceGroup, type PriceModelItem } from '@/services/pricingApi';
import { useModelStore } from '@/stores/modelStore';

// 价格列表全局只请求一次（画布上可能同时存在多个工具栏实例）；
// 失败时清空缓存，允许下次挂载时重试
// 按渠道缓存：电信用户看到电信价格，华数用户看到华数价格（后端按登录用户渠道返回）
let pricingNodesPromise: Promise<NodePriceGroup[]> | null = null;
function loadPricingNodes(): Promise<NodePriceGroup[]> {
  if (!pricingNodesPromise) {
    pricingNodesPromise = pricingApi
      .list()
      .then((res) => res.nodes || [])
      .catch((err) => {
        pricingNodesPromise = null;
        throw err;
      });
  }
  return pricingNodesPromise;
}

/**
 * 在价格分组中查找视频模型指定分辨率的单价条目。
 * 分辨率两侧统一小写比较（后端可能返回 720P/1080P/4k 等任意大小写）。
 */
function findVideoPricing(
  pricingNodes: NodePriceGroup[],
  modelId: string,
  resolution: string,
): PriceModelItem | null {
  const videoGroup = pricingNodes.find((n) => n.node_type === 'video');
  if (!videoGroup || videoGroup.billing_type !== 'per_second') return null;
  const res = resolution.toLowerCase();
  return (
    videoGroup.models.find(
      (m) => m.model_id === modelId && (m.resolution || '').toLowerCase() === res,
    ) ?? null
  );
}

// 展开指示箭头（替代原来的文本 "^"）
function ChevronIcon({ className = '' }: { className?: string }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className={className}>
      <path d="M2 6.5L5 3.5L8 6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// 清晰度的描述性副标签（纯展示文案）
const RESOLUTION_META: Record<string, string> = {
  '480p': '流畅',
  '720p': '高清',
  '1080p': '超清',
  '1K': '标准',
  '2K': '高清',
  '4K': '极致',
};

interface PromptToolbarProps {
  models: ModelOption[];
  selectedModel: string;
  onModelChange: (model: string) => void;
  selectedResolution: ResolutionOption;
  onResolutionChange: (res: ResolutionOption) => void;
  selectedAspectRatio: string;
  onAspectRatioChange: (ratio: string) => void;
  selectedQuality?: string;
  onQualityChange?: (quality: string) => void;
  isGenerating?: boolean;
  onGenerate?: (count?: number) => void;
  nodeType?: NodeType;
  // 音频节点专属：音色、语速、风格、语气词
  selectedVoice?: string;
  onVoiceChange?: (voice: string) => void;
  selectedSpeed?: number;
  onSpeedChange?: (speed: number) => void;
  selectedStyle?: string;
  onStyleChange?: (style: string) => void;
  selectedTone?: string;
  onToneChange?: (tone: string) => void;
  // 视频节点专属：时长（秒）
  selectedDuration?: number;
  onDurationChange?: (duration: number) => void;
  // 视频节点专属：是否生成音频
  generateAudio?: boolean;
  onGenerateAudioChange?: (enabled: boolean) => void;
  // 视频节点专属：是否已引用音频节点（引用后声音开关强制开启，不可关闭）
  audioReferenced?: boolean;
  // 音频节点专属：输入字符数（用于计算费用）
  charCount?: number;
  /**
   * 节点记录的模型渠道（wasu/dianxin）：仅当节点确实保存过该字段时才参与判定。
   * - undefined：节点未记录渠道（新节点，或渠道记录功能上线前的历史节点）
   *   → 不做渠道判定，仅按"模型在当前渠道是否存在"判断可用性（避免误伤历史节点）
   * - 已记录且与当前渠道不一致：置灰并要求重新选择，同时拦截生成
   */
  storedModelChannel?: string;
}

// ==================== 统一控件样式（工具栏视觉语言）====================

// 触发按钮：紧凑、浅圆角、悬浮高亮
const TBTN = 'flex items-center gap-1 px-2 py-1 rounded-lg text-[12px] text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-all duration-150 cursor-pointer';
// 触发按钮中"当前值"强调
const TVAL = 'font-medium text-gray-800';
// 下拉面板：统一圆角/阴影/边框
const TDROP = 'absolute bottom-full left-0 mb-1.5 bg-white rounded-xl shadow-lg border border-gray-200/80 ring-1 ring-black/5 overflow-hidden z-30';
// 下拉项：紧凑
const TITEM = 'w-full px-3 py-1.5 text-left text-[12px] text-gray-600 hover:bg-gray-50 transition-colors';
// 下拉项选中态
const TITEM_ACTIVE = 'bg-blue-50 text-blue-700 font-medium';
// 下拉分组头
const TGP = 'px-3 py-1 text-[10px] text-gray-400 bg-gray-50 sticky top-0 font-medium tracking-wide';

// ==================== 模型选择器（截图2）====================

const ModelSelector = memo(function ModelSelector({
  models,
  value,
  onChange,
  channel = 'wasu',
  storedModelChannel,
}: {
  models: ModelOption[];
  value: string;
  onChange: (v: string) => void;
  /** 当前最终渠道（wasu/dianxin）：用于判断旧渠道模型是否仍可用 */
  channel?: string;
  /** 节点当初保存模型时的渠道；与当前渠道不一致 → 强制重新选择 */
  storedModelChannel?: string;
}) {
  const [open, setOpen] = useState(false);
  const currentModel = models.find((m) => m.value === value);
  // 置灰条件（任一命中即不可用）：
  //   1) 模型 ID 不在当前渠道列表中
  //   2) 列表中该模型的 provider 与当前渠道不一致（同名模型跨渠道场景）
  //   3) 节点当初保存模型时的渠道与当前渠道不一致（渠道切换后必须重新选择，
  //      避免"直接点生成"悄悄用新渠道的同名模型出图）
  const unavailable = !!value && (
    !currentModel
    || (currentModel.provider && currentModel.provider !== channel)
    || (storedModelChannel !== undefined && storedModelChannel !== channel)
  );

  return (
    <div className="relative">
      {/* 触发按钮：当前模型名 + 小箭头，悬浮有质感 */}
      <button
        className={`flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-lg transition-all duration-150 cursor-pointer group ${
          unavailable
            ? 'text-red-500'
            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-800'
        }`}
        onClick={() => setOpen(!open)}
        title={unavailable ? '当前模型在当前渠道不可用，请重新选择' : undefined}
      >
        {/* 模型名（带品牌色小圆点） */}
        <span className="flex items-center gap-1.5 min-w-0">
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              unavailable ? 'bg-red-400' : currentModel ? 'bg-blue-400' : 'bg-gray-300'
            }`}
          />
          <span className={`max-w-[120px] truncate text-[12px] ${unavailable ? 'line-through' : TVAL}`}>
            {unavailable ? `${value}（渠道不可用）` : currentModel?.label || '选择模型'}
          </span>
        </span>
        <ChevronIcon className="text-gray-400 w-3 h-3 shrink-0 transition-transform duration-150 group-hover:translate-y-px" />
      </button>

      {/* 下拉面板：精致卡片 */}
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className={`${TDROP} w-[260px]`}>
            {/* 面板头：标题 + 当前渠道提示 */}
            <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
              <span className="text-[10px] font-semibold text-gray-400 tracking-wider uppercase">选择模型</span>
              <span className="text-[10px] text-gray-300">本渠道可用</span>
            </div>
            {/* 当前渠道不可用模型提示 */}
            {unavailable && (
              <div className="px-3 py-1.5 bg-red-50 border-b border-red-100 text-[11px] text-red-500 leading-snug">
                当前模型在本渠道不可用，请重新选择
              </div>
            )}
            <div className="max-h-64 overflow-y-auto py-1">
              {models.map((model) => {
                const active = value === model.value;
                return (
                  <button
                    key={model.value}
                    className={`${TITEM} group/item border-l-2 transition-all ${
                      active
                        ? 'border-blue-500 bg-blue-50/70'
                        : 'border-transparent hover:bg-gray-50'
                    }`}
                    onClick={() => {
                      onChange(model.value);
                      setOpen(false);
                    }}
                  >
                    {/* 名称 + tag + 对勾 */}
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={`text-[12px] truncate ${active ? 'text-blue-700 font-medium' : 'text-gray-700'}`}>
                        {model.label}
                      </span>
                      {model.tag && (
                        <span
                          className="px-1 py-px rounded text-[9px] font-medium leading-none shrink-0"
                          style={{
                            backgroundColor: `${model.tagColor || '#f59e0b'}15`,
                            color: model.tagColor || '#f59e0b',
                          }}
                        >
                          {model.tag}
                        </span>
                      )}
                      <span className="ml-auto shrink-0">
                        {active && (
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-blue-500">
                            <path d="M2.5 6.5L5 9L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                    </div>
                    {/* 描述：最多两行，精致小字 */}
                    {model.description && (
                      <div className="text-[10px] text-gray-400 mt-0.5 pr-4 line-clamp-2 leading-snug">
                        {model.description}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
});

// ==================== 分辨率+比例选择器（截图3 样式）====================

// 比例图标：按真实宽高比绘制矩形示意。
// 采用「填充块 + 细描边」，形状一眼可辨（纯描边在极小尺寸下会显得单薄）；
// 极端比例（1:2 / 2:1）保底最小厚度，避免退化成一条线。
// active：选中态（深色实心）；size：卡片内更大、触发按钮上更小
function RatioIcon({ value, active, size = 22 }: { value: string; active: boolean; size?: number }) {
  // 自适应：虚线框 + 淡填充
  if (value === 'free') {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
        <rect x="3.4" y="3.4" width={size - 6.8} height={size - 6.8} rx="2.6"
          stroke={active ? '#111827' : '#CBD5E1'} strokeWidth={active ? 1.7 : 1.3}
          strokeDasharray="4 2.6"
          fill={active ? 'rgba(17,24,39,0.07)' : 'none'} />
      </svg>
    );
  }

  const [w, h] = value.split(':').map(Number);
  if (!w || !h) return null;

  const ratio = w / h;
  const box = size - 7; // 比例框最长边（四周留白）
  let iw: number, ih: number;
  if (ratio >= 1) {
    iw = box;
    ih = box / ratio;
  } else {
    ih = box;
    iw = box * ratio;
  }
  iw = Math.max(iw, 6);
  ih = Math.max(ih, 6);
  const ox = (size - iw) / 2;
  const oy = (size - ih) / 2;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
      <rect x={ox} y={oy} width={iw} height={ih} rx={Math.min(iw, ih) * 0.18}
        fill={active ? '#111827' : '#F1F5F9'}
        stroke={active ? '#111827' : '#CBD5E1'}
        strokeWidth={active ? 1.5 : 1}
      />
    </svg>
  );
}

// 卡片内的区块标题图标（小、灰、跟随文字基线）
const ResSectionIcon = (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" className="text-gray-400">
    <rect x="1.3" y="2.3" width="11.4" height="9.4" rx="1.7" stroke="currentColor" strokeWidth="1.2" />
    <path d="M4.3 5.5h5.4M4.3 7.5h3.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);
const RatioSectionIcon = (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" className="text-gray-400">
    <rect x="1.3" y="3.7" width="11.4" height="6.6" rx="1.7" stroke="currentColor" strokeWidth="1.2" />
  </svg>
);

// 区块标题：小图标 + 标题 + 右侧当前值 chip
function SectionHeader({ icon, title, chip }: { icon: React.ReactNode; title: string; chip?: string }) {
  return (
    <div className="mb-2.5 flex items-center justify-between">
      <span className="flex items-center gap-1.5 text-[12px] font-semibold text-gray-800">
        {icon}
        {title}
      </span>
      {chip && (
        <span className="rounded-md bg-gray-100/90 px-1.5 py-[3px] text-[10px] font-medium leading-none text-gray-500 tabular-nums">
          {chip}
        </span>
      )}
    </div>
  );
}

const AspectRatioSelector = memo(function AspectRatioSelector({
  resolution,
  aspectRatio,
  selectedModelId,
  nodeType,
  models,
  onResolutionChange,
  onAspectRatioChange,
  pricingNodes,
  selectedDuration,
}: {
  resolution: ResolutionOption;
  aspectRatio: string;
  selectedModelId?: string;
  nodeType: NodeType;
  models: ModelOption[];
  onResolutionChange: (r: ResolutionOption) => void;
  onAspectRatioChange: (r: string) => void;
  pricingNodes?: NodePriceGroup[];
  selectedDuration?: number;
}) {
  const [open, setOpen] = useState(false);
  const isVideo = nodeType === 'video';

  // 分辨率选项：统一由模型配置驱动（后端 models.yaml 的 resolutions）——
  // 图片与视频同一套规则；模型未配置时回退各自默认全集
  const modelResolutions = selectedModelId
    ? models.find((m) => m.value === selectedModelId)?.resolutions
    : undefined;
  const resolutionOptions: readonly string[] = modelResolutions && modelResolutions.length > 0
    ? modelResolutions
    : (isVideo ? VIDEO_RESOLUTION_OPTIONS : RESOLUTION_OPTIONS);

  // 视频节点：wan3.0（阿里万相）仅支持部分比例，其余模型不限制
  const allowedAspectRatios: readonly string[] | null =
    isVideo && !!selectedModelId && selectedModelId.includes('wan3.0') ? WAN3_VIDEO_ASPECT_RATIOS : null;

  // 当前比例不被模型支持时自动回退到自适应（free），与分辨率回退同理
  const effectiveAspectRatio =
    allowedAspectRatios && !allowedAspectRatios.includes(aspectRatio) ? 'free' : aspectRatio;

  // 回退值与父组件状态不一致时回写，保证生成时提交的比例与 UI 显示一致
  useEffect(() => {
    if (effectiveAspectRatio !== aspectRatio) {
      onAspectRatioChange(effectiveAspectRatio);
    }
  }, [effectiveAspectRatio, aspectRatio, onAspectRatioChange]);

  // 比例网格按模型过滤（保留占位元素维持布局）
  const aspectRatioRows = allowedAspectRatios
    ? ASPECT_RATIO_ROWS.map((row) => row.filter((item) => !item.value || allowedAspectRatios.includes(item.value)))
    : ASPECT_RATIO_ROWS;

  // 当前分辨率不在模型支持列表时自动回退到第一个可用项（图片/视频同一套逻辑）
  const resolutionFallback = !resolutionOptions.includes(resolution)
    ? (resolutionOptions[0] ?? resolution)
    : null;
  const effectiveResolution: string = resolutionFallback ?? resolution;

  // 回退值与父组件状态不一致时回写，保证生成时提交的分辨率与 UI 显示一致
  useEffect(() => {
    if (effectiveResolution !== resolution) {
      onResolutionChange(effectiveResolution as ResolutionOption);
    }
  }, [effectiveResolution, resolution, onResolutionChange]);

  return (
    <div className="relative">
      {/* 触发按钮 */}
      <button
        className={TBTN}
        onClick={() => setOpen(!open)}
      >
        <RatioIcon value={effectiveAspectRatio} active={true} />
        <span className={TVAL}>{effectiveAspectRatio}</span>
        <span className="px-1.5 py-px rounded-md bg-gray-100 text-[10px] font-semibold text-gray-500 leading-relaxed">
          {effectiveResolution}
        </span>
        <ChevronIcon className="text-gray-400" />
      </button>

      {/* 弹出面板 */}
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 z-30 mb-2 w-[358px] rounded-2xl border border-gray-100/90 bg-white p-4 shadow-[0_16px_44px_-14px_rgba(15,23,42,0.28)] ring-1 ring-black/[0.03]">
            {/* 清晰度 */}
            <div>
              <SectionHeader
                icon={ResSectionIcon}
                title="清晰度"
                chip={isVideo ? `按 ${selectedDuration && selectedDuration > 0 ? selectedDuration : 4}s 预估` : undefined}
              />
              <div className="flex gap-2">
                {resolutionOptions.map((res) => {
                  const isActive = effectiveResolution === res;
                  // 视频节点：查找该分辨率对应的单价和预估费用
                  let resPriceLabel: string | null = null;
                  if (isVideo && pricingNodes && selectedModelId) {
                    const realModelId = models.find((m) => m.value === selectedModelId)?.modelId || selectedModelId;
                    const priceItem = findVideoPricing(pricingNodes, realModelId, res);
                    if (priceItem && priceItem.price > 0) {
                      const dur = selectedDuration && selectedDuration > 0 ? selectedDuration : 4;
                      resPriceLabel = `${Math.ceil(priceItem.price * dur)} 积分`;
                    }
                  }
                  const isPrice = !!resPriceLabel;
                  const subText = isPrice ? (resPriceLabel as string) : (RESOLUTION_META[res] || '');
                  return (
                    <button
                      key={res}
                      className={`relative flex-1 rounded-xl border px-1 py-2.5 text-center transition-all duration-150 ${
                        isActive
                          ? 'border-gray-900 bg-gradient-to-b from-gray-800 to-gray-950 text-white shadow-md'
                          : 'border-gray-200/90 bg-white text-gray-700 hover:-translate-y-px hover:border-gray-300 hover:bg-gray-50/70 hover:shadow-sm'
                      }`}
                      onClick={() => { onResolutionChange(res as ResolutionOption); setOpen(false); }}
                    >
                      <div className="text-[13px] font-semibold leading-none tracking-tight">{res}</div>
                      <div className={`mt-1.5 text-[10px] leading-none tabular-nums ${
                        isActive
                          ? (isPrice ? 'text-amber-300' : 'text-gray-400')
                          : (isPrice ? 'font-medium text-amber-600' : 'text-gray-400')
                      }`}>
                        {subText}
                      </div>
                    </button>
                  );
                })}
              </div>
              {resolutionFallback && (
                <div className="mt-2 text-[11px] text-amber-600">
                  当前模型不支持 {resolution} 清晰度，已自动切换至 {resolutionFallback}
                </div>
              )}
            </div>

            <div className="my-3.5 h-px bg-gradient-to-r from-gray-100 via-gray-100 to-transparent" />

            {/* 比例网格 */}
            <div>
              <SectionHeader
                icon={RatioSectionIcon}
                title="比例"
                chip={effectiveAspectRatio === 'free' ? '自适应' : effectiveAspectRatio}
              />
              <div className="grid grid-cols-5 gap-2">
                {aspectRatioRows.flat().map((item, index) => {
                  // 占位：空值渲染为透明占位元素
                  if (!item.value) {
                    return <div key={`placeholder-${index}`} />;
                  }
                  const isActive = effectiveAspectRatio === item.value;
                  return (
                    <button
                      key={item.value}
                      title={item.label}
                      className={`group relative flex flex-col items-center justify-center gap-1.5 rounded-xl border py-2.5 transition-all duration-150 ${
                        isActive
                          ? 'border-gray-900/85 bg-gray-900/[0.06] shadow-[inset_0_0_0_1px_rgba(17,24,39,0.04)]'
                          : 'border-gray-200/90 bg-white hover:-translate-y-px hover:border-gray-300 hover:bg-gray-50/70 hover:shadow-sm'
                      }`}
                      onClick={() => { onAspectRatioChange(item.value); setOpen(false); }}
                    >
                      <RatioIcon value={item.value} active={isActive} size={24} />
                      <span
                        className={`text-[11px] leading-none tracking-tight transition-colors ${
                          isActive ? 'font-semibold text-gray-900' : 'text-gray-500 group-hover:text-gray-700'
                        }`}
                      >
                        {item.label}
                      </span>
                    </button>
                  );
                })}
              </div>
              {allowedAspectRatios && (
                <div className="mt-2 text-[11px] text-amber-600">万相 Wan 3.0 仅支持以上比例</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
});

// ==================== 主工具栏（截图1 底部）====================

// 视频时长选项由模型配置驱动：后端 models.yaml 的 duration_range（每个视频模型显式声明），
// 前端统一用 buildDurationOptions 生成，未配置的模型回退默认 4-15 秒

// 音色选项（仅列出 qwen3-tts-instruct-flash 支持的音色，来自阿里云百炼官方非实时音色列表）
// 不支持的音色（Katerina/Ryan/Aiden/Andre 及全部方言）已移除，
// 后端对旧数据有 qwen3-tts-flash 回退兜底
const VOICE_OPTIONS = [
  // —— 普通话·女声 ——
  { value: 'Cherry', label: '芊悦（阳光女声）', group: '普通话·女声' },
  { value: 'Serena', label: '苏瑶（温柔女声）', group: '普通话·女声' },
  { value: 'Maia', label: '四月（知性女声）', group: '普通话·女声' },
  { value: 'Chelsie', label: '千雪（二次元女声）', group: '普通话·女声' },
  { value: 'Momo', label: '茉兔（撒娇女声）', group: '普通话·女声' },
  { value: 'Vivian', label: '十三（可爱女声）', group: '普通话·女声' },
  { value: 'Bella', label: '萌宝（萝莉女声）', group: '普通话·女声' },
  { value: 'Mia', label: '乖小妹（温顺女声）', group: '普通话·女声' },
  { value: 'Nini', label: '邻家妹妹（软萌女声）', group: '普通话·女声' },
  { value: 'Stella', label: '少女阿月（甜妹女声）', group: '普通话·女声' },
  { value: 'Bunny', label: '萌小姬（萝莉女声）', group: '普通话·女声' },
  { value: 'Seren', label: '小婉（助眠女声）', group: '普通话·女声' },
  { value: 'Elias', label: '墨讲师（知性女声）', group: '普通话·女声' },
  // —— 普通话·男声 ——
  { value: 'Ethan', label: '晨煦（阳光男声）', group: '普通话·男声' },
  { value: 'Moon', label: '月白（帅气男声）', group: '普通话·男声' },
  { value: 'Kai', label: '凯（沉稳男声）', group: '普通话·男声' },
  { value: 'Nofish', label: '不吃鱼（设计师男声）', group: '普通话·男声' },
  { value: 'Neil', label: '阿闻（新闻男声）', group: '普通话·男声' },
  { value: 'Mochi', label: '沙小弥（童声男声）', group: '普通话·男声' },
  { value: 'Pip', label: '顽屁小孩（调皮童声）', group: '普通话·男声' },
  // —— 角色扮演 ——
  { value: 'Eldric Sage', label: '沧明子（睿智老者）', group: '角色扮演' },
  { value: 'Bellona', label: '燕铮莺（热血女将）', group: '角色扮演' },
  { value: 'Vincent', label: '田叔（沙哑烟嗓）', group: '角色扮演' },
  { value: 'Arthur', label: '徐大爷（质朴乡音）', group: '角色扮演' },
];

// 语速选项
const SPEED_OPTIONS = [
  { value: 0.5, label: '0.5x 慢速' },
  { value: 0.75, label: '0.75x' },
  { value: 1.0, label: '1.0x 正常' },
  { value: 1.25, label: '1.25x' },
  { value: 1.5, label: '1.5x 快速' },
  { value: 2.0, label: '2.0x' },
];

// 风格选项（写入 instructions，由 Qwen3-TTS Instruct 模型解析）
const STYLE_OPTIONS = [
  { value: '', label: '默认' },
  { value: '情感温暖、亲切自然', label: '温暖亲切' },
  { value: '沉稳庄重、正式播报', label: '沉稳正式' },
  { value: '活泼开朗、充满活力', label: '活泼开朗' },
  { value: '深情悲伤、低沉缓慢', label: '深情悲伤' },
  { value: '神秘紧张、悬疑感', label: '神秘紧张' },
  { value: '幽默诙谐、轻松愉快', label: '幽默诙谐' },
  { value: '慷慨激昂、热血振奋', label: '慷慨激昂' },
  { value: '温柔舒缓、治愈安慰', label: '温柔治愈' },
  { value: '新闻播报、字正腔圆', label: '新闻播报' },
  { value: '旁白叙事、娓娓道来', label: '旁白叙事' },
];

// 语气词选项（写入 instructions，不再插入提示词）
// 拆分为"情绪"与"语态"两组，均为可全局生效的语气描述词，
// 后端会拼成"带有X的语气"写入 TTS instructions
const TONE_OPTIONS = [
  { value: '', label: '默认', group: '' },
  // —— 情绪 ——
  { value: '喜悦', label: '喜悦', group: '情绪' },
  { value: '悲伤', label: '悲伤', group: '情绪' },
  { value: '愤怒', label: '愤怒', group: '情绪' },
  { value: '惊讶', label: '惊讶', group: '情绪' },
  { value: '恐惧', label: '恐惧', group: '情绪' },
  { value: '厌恶', label: '厌恶', group: '情绪' },
  { value: '期待', label: '期待', group: '情绪' },
  { value: '失落', label: '失落', group: '情绪' },
  { value: '焦急', label: '焦急', group: '情绪' },
  { value: '羞涩', label: '羞涩', group: '情绪' },
  { value: '得意', label: '得意', group: '情绪' },
  { value: '疑惑', label: '疑惑', group: '情绪' },
  { value: '嘲讽', label: '嘲讽', group: '情绪' },
  { value: '冷漠', label: '冷漠', group: '情绪' },
  // —— 语态 ——
  { value: '坚定', label: '坚定', group: '语态' },
  { value: '镇定', label: '镇定', group: '语态' },
  { value: '犹豫', label: '犹豫', group: '语态' },
  { value: '严肃', label: '严肃', group: '语态' },
  { value: '俏皮', label: '俏皮', group: '语态' },
  { value: '低语', label: '低语', group: '语态' },
  { value: '呐喊', label: '呐喊', group: '语态' },
  { value: '哭腔', label: '哭腔', group: '语态' },
  { value: '笑腔', label: '笑腔', group: '语态' },
  { value: '叹息', label: '叹息', group: '语态' },
  { value: '嘟囔', label: '嘟囔', group: '语态' },
];

// 按 group 字段分组（空 group 的项不进分组，由调用方单独渲染）
function groupOptions<T extends { group: string }>(options: T[]): Array<[string, T[]]> {
  const map = new Map<string, T[]>();
  for (const o of options) {
    if (!o.group) continue;
    if (!map.has(o.group)) map.set(o.group, []);
    map.get(o.group)!.push(o);
  }
  return Array.from(map.entries());
}

// 按分组整理音色 / 语气词（模块级常量，无需 useMemo）
const VOICE_GROUPS = groupOptions(VOICE_OPTIONS);
const TONE_GROUPS = groupOptions(TONE_OPTIONS);

export const PromptToolbar = memo<PromptToolbarProps>(function PromptToolbar({
  models,
  selectedModel,
  onModelChange,
  selectedResolution,
  onResolutionChange,
  selectedAspectRatio,
  onAspectRatioChange,
  isGenerating = false,
  onGenerate,
  nodeType = 'image',
  selectedVoice = 'default',
  onVoiceChange,
  selectedSpeed = 1.0,
  onSpeedChange,
  selectedStyle = '',
  onStyleChange,
  selectedTone = '',
  onToneChange,
  selectedDuration = 5,
  onDurationChange,
  generateAudio = true,
  onGenerateAudioChange,
  audioReferenced = false,
  charCount = 0,
  storedModelChannel,
}) {
  const isVideo = nodeType === 'video';
  const isAudio = nodeType === 'audio';
  // 当前最终渠道（wasu/dianxin），传给模型选择器做置灰判断
  const currentChannel = useModelStore((s) => s.channel);
  // 当前所选模型是否因渠道变更而不可用（与 ModelSelector 判定一致）：用于拦截生成
  const modelUnavailable = !!selectedModel && (() => {
    const m = models.find((x) => x.value === selectedModel);
    if (!m) return true;
    if (m.provider && m.provider !== currentChannel) return true;
    if (storedModelChannel !== undefined && storedModelChannel !== currentChannel) return true;
    return false;
  })();
  const [durationOpen, setDurationOpen] = useState(false);
  // 视频时长选项：以所选模型的 duration_range 配置为准
  // （如 wan3.0-video 2-30s、cdance2.5-0807 4-30s、seedance 2.0 系列 4-15s）
  const durationOptions = buildDurationOptions(models.find((m) => m.value === selectedModel));

  // 音色选择器状态
  const [voiceOpen, setVoiceOpen] = useState(false);
  // 语速选择器状态
  const [speedOpen, setSpeedOpen] = useState(false);
  // 风格选择器状态
  const [styleOpen, setStyleOpen] = useState(false);
  // 语气词选择器状态
  const [toneOpen, setToneOpen] = useState(false);

  // 价格数据（模块级 promise 缓存，全局只请求一次；卸载后不再 setState）
  const [pricingNodes, setPricingNodes] = useState<NodePriceGroup[]>([]);
  useEffect(() => {
    let cancelled = false;
    loadPricingNodes()
      .then((nodes) => { if (!cancelled) setPricingNodes(nodes); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // 计算当前模型的费用
  const estimatedCost = useMemo(() => {
    if (pricingNodes.length === 0) return null;
    // 找到当前节点类型对应的价格分组
    const nodeGroup = pricingNodes.find((n) => n.node_type === nodeType);
    if (!nodeGroup) return null;
    // 找到当前模型的价格
    const currentModelId = models.find((m) => m.value === selectedModel)?.modelId || selectedModel;
    // 视频节点：按分辨率匹配价格（同一模型不同分辨率价格不同）
    if (nodeGroup.billing_type === 'per_second' && nodeType === 'video') {
      const modelPrice = findVideoPricing(pricingNodes, currentModelId, selectedResolution);
      if (!modelPrice) return null;
      const price = modelPrice.price;
      if (price === 0) return 0;
      return Math.ceil(price * selectedDuration);
    }
    const modelPrice = nodeGroup.models.find((m) => m.model_id === currentModelId);
    if (!modelPrice) return null;
    const price = modelPrice.price;
    if (price === 0) return 0;
    // 按秒计费：视频节点，费用 = 单价 × 时长
    if (nodeGroup.billing_type === 'per_second') {
      return Math.ceil(price * selectedDuration);
    }
    // 按字计费：音频节点，费用 = 单价 × (字符数 / 100)
    if (nodeGroup.billing_type === 'per_char') {
      if (charCount <= 0) return 0;
      return Math.ceil(price * charCount / 100);
    }
    // 按次计费：直接返回单价
    return price;
  }, [pricingNodes, nodeType, selectedModel, models, selectedDuration, selectedResolution, charCount]);

  return (
    <div className="flex items-center gap-1 pt-2 mt-0.5 border-t border-gray-100">
      {/* 模型选择器 */}
      <ModelSelector
        models={models}
        value={selectedModel}
        onChange={onModelChange}
        channel={currentChannel}
        storedModelChannel={storedModelChannel}
      />

      {/* 分隔 */}
      <span className="w-px h-4 bg-gray-200/70 mx-0.5" />

      {/* 音色选择器（仅音频节点，分组显示） */}
      {isAudio && (
        <div className="relative">
          <button
            onClick={() => setVoiceOpen(!voiceOpen)}
            className={TBTN}
          >
            <SoundOutlined className="text-gray-400 text-xs" />
            <span className={TVAL}>
              {VOICE_OPTIONS.find((v) => v.value === selectedVoice)?.label || '音色'}
            </span>
            <ChevronIcon className="text-gray-400 w-3 h-3" />
          </button>
          {voiceOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setVoiceOpen(false)} />
              <div className={`${TDROP} w-[160px] max-h-[320px] overflow-y-auto`}>
                {VOICE_GROUPS.map(([groupName, voices]) => (
                  <div key={groupName}>
                    <div className={TGP}>{groupName}</div>
                    {voices.map((opt) => (
                      <button
                        key={opt.value}
                        className={`${TITEM} ${selectedVoice === opt.value ? TITEM_ACTIVE : ''}`}
                        onClick={() => { onVoiceChange?.(opt.value); setVoiceOpen(false); }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* 语速选择器（仅音频节点） */}
      {isAudio && (
        <div className="relative">
          <button
            onClick={() => setSpeedOpen(!speedOpen)}
            className={TBTN}
          >
            <span className={TVAL}>{selectedSpeed}x</span>
            <ChevronIcon className="text-gray-400 w-3 h-3" />
          </button>
          {speedOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setSpeedOpen(false)} />
              <div className={`${TDROP} w-[120px]`}>
                {SPEED_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={`${TITEM} ${selectedSpeed === opt.value ? TITEM_ACTIVE : ''}`}
                    onClick={() => { onSpeedChange?.(opt.value); setSpeedOpen(false); }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* 风格选择器（仅音频节点，写入 instructions） */}
      {isAudio && (
        <div className="relative">
          <button
            onClick={() => setStyleOpen(!styleOpen)}
            className={TBTN}
          >
            <span className={TVAL}>
              {STYLE_OPTIONS.find((s) => s.value === selectedStyle)?.label || '风格'}
            </span>
            <ChevronIcon className="text-gray-400 w-3 h-3" />
          </button>
          {styleOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setStyleOpen(false)} />
              <div className={`${TDROP} w-[130px]`}>
                {STYLE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={`${TITEM} ${selectedStyle === opt.value ? TITEM_ACTIVE : ''}`}
                    onClick={() => { onStyleChange?.(opt.value); setStyleOpen(false); }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* 语气词选择器（仅音频节点，紧邻风格选择器，写入 instructions，不再插入提示词） */}
      {isAudio && (
        <div className="relative">
          <button
            onClick={() => setToneOpen(!toneOpen)}
            className={TBTN}
          >
            <span className="font-mono text-[10px] text-orange-400 shrink-0">（）</span>
            <span className={TVAL}>
              {TONE_OPTIONS.find((t) => t.value === selectedTone)?.label || '语气词'}
            </span>
            <ChevronIcon className="text-gray-400 w-3 h-3" />
          </button>
          {toneOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setToneOpen(false)} />
              <div className={`${TDROP} w-[128px] max-h-[320px] overflow-y-auto`}>
                {/* 默认项 */}
                <button
                  className={`${TITEM} ${selectedTone === '' ? TITEM_ACTIVE : ''}`}
                  onClick={() => { onToneChange?.(''); setToneOpen(false); }}
                >
                  默认
                </button>
                {TONE_GROUPS.map(([groupName, tones]) => (
                  <div key={groupName}>
                    <div className={TGP}>{groupName}</div>
                    {tones.map((opt) => (
                      <button
                        key={opt.value}
                        className={`${TITEM} ${selectedTone === opt.value ? TITEM_ACTIVE : ''}`}
                        onClick={() => { onToneChange?.(opt.value); setToneOpen(false); }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* 分辨率/比例（仅图片/视频节点） */}
      {(nodeType === 'image' || nodeType === 'video') && (
        <AspectRatioSelector
          resolution={selectedResolution}
          aspectRatio={selectedAspectRatio}
          selectedModelId={selectedModel}
          nodeType={nodeType}
          models={models}
          onResolutionChange={onResolutionChange}
          onAspectRatioChange={onAspectRatioChange}
          pricingNodes={pricingNodes}
          selectedDuration={selectedDuration}
        />
      )}

      {/* 分隔（仅视频节点，图片节点已移除摄像机/全景按钮） */}
      {nodeType === 'video' && (
        <span className="w-px h-4 bg-gray-200 mx-0.5" />
      )}

      {/* 右侧区域 */}
      <div className="flex items-center gap-0.5 ml-auto">
        {/* 视频时长选择器（仅视频节点，显示在生成按钮左侧） */}
        {isVideo && (
          <div className="relative mr-1">
            <button
              onClick={() => setDurationOpen(!durationOpen)}
              className={`${TBTN} text-gray-500`}
              title="视频时长（秒）"
            >
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="5.5" stroke="#6B7280" strokeWidth="1.3" />
                <path d="M7 4v3l2 1.5" stroke="#6B7280" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className={TVAL}>{selectedDuration}s</span>
              <ChevronIcon className="text-gray-400 w-3 h-3" />
            </button>
            {durationOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setDurationOpen(false)} />
                <div className={`${TDROP} right-0 w-[64px] max-h-[260px] overflow-y-auto`}>
                  {durationOptions.map((opt) => (
                    <button
                      key={opt}
                      className={`${TITEM} ${selectedDuration === opt ? TITEM_ACTIVE : ''}`}
                      onClick={() => {
                        onDurationChange?.(opt);
                        setDurationOpen(false);
                      }}
                    >
                      {opt}s
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* 声音开关（仅视频节点，时长选择器右侧；已引用音频节点时锁定开启） */}
        {isVideo && (
          <button
            onClick={() => {
              if (audioReferenced) return;
              onGenerateAudioChange?.(!generateAudio);
            }}
            disabled={audioReferenced}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg transition-colors cursor-pointer mr-1 ${
              generateAudio
                ? 'bg-gray-100 text-gray-700'
                : 'text-gray-400 hover:bg-gray-100/80'
            } ${audioReferenced ? 'opacity-60 cursor-not-allowed' : ''}`}
            title={
              audioReferenced
                ? '已引用音频节点，声音自动开启（不可关闭）'
                : generateAudio
                  ? '声音：开（点击关闭）'
                  : '声音：关（点击开启）'
            }
          >
            {generateAudio
              ? <SoundOutlined style={{ fontSize: 14 }} />
              : <AudioMutedOutlined style={{ fontSize: 14 }} />}
            <span className="text-[12px]">
              {audioReferenced ? '声音(音频参考)' : generateAudio ? '声音' : '静音'}
            </span>
          </button>
        )}

        {/* 费用提示（生成按钮左侧） */}
        {estimatedCost !== null && estimatedCost > 0 && (
          <span className="text-[11px] text-gray-500 mr-1.5 whitespace-nowrap">
            {estimatedCost} 积分
          </span>
        )}

        {/* 生成按钮：模型因渠道变更不可用时拦截，必须先重新选择模型 */}
        <button
          className="h-8 px-3.5 rounded-xl bg-gradient-to-br from-gray-800 to-gray-950 text-white flex items-center justify-center hover:from-gray-700 hover:to-gray-900 active:scale-95 transition-all duration-150 flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm text-[13px] font-medium tracking-wide"
          onClick={() => onGenerate?.(1)}
          disabled={isGenerating || modelUnavailable}
          title={modelUnavailable ? '模型在当前渠道不可用，请先重新选择模型' : undefined}
        >
          {isGenerating ? '生成中…' : modelUnavailable ? '请重选模型' : '生成'}
        </button>
      </div>
    </div>
  );
});
