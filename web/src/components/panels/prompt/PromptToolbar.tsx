import { memo, useMemo, useState, useEffect } from 'react';
import {
  LinkOutlined,
  BarChartOutlined,
  RobotOutlined,
  VideoCameraOutlined,
  ThunderboltOutlined,
  CloudOutlined,
  AudioOutlined,
  SoundOutlined,
  AudioMutedOutlined,
} from '@ant-design/icons';
import type { ModelOption, ResolutionOption } from '@/types/prompt';
import type { NodeType } from '@/types/canvas';
import { RESOLUTION_OPTIONS, VIDEO_RESOLUTION_OPTIONS, ASPECT_RATIO_ROWS } from '@/configs/promptConfig';
import { pricingApi, type NodePriceGroup, type PriceModelItem } from '@/services/pricingApi';

// 价格列表全局只请求一次（画布上可能同时存在多个工具栏实例）；
// 失败时清空缓存，允许下次挂载时重试
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

// 模型图标映射（匹配截图中的图标风格）
const MODEL_ICON_MAP: Record<string, React.ReactNode> = {
  link: <LinkOutlined style={{ fontSize: 16 }} />,
  'bar-chart': <BarChartOutlined style={{ fontSize: 16 }} />,
  robot: <RobotOutlined style={{ fontSize: 16 }} />,
  'video-camera': <VideoCameraOutlined style={{ fontSize: 16 }} />,
  thunderbolt: <ThunderboltOutlined style={{ fontSize: 16 }} />,
  cloud: <CloudOutlined style={{ fontSize: 16 }} />,
  audio: <AudioOutlined style={{ fontSize: 16 }} />,
  sound: <SoundOutlined style={{ fontSize: 16 }} />,
};

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
  // 音频节点专属：输入字符数（用于计算费用）
  charCount?: number;
}

// ==================== 模型选择器（截图2）====================

const ModelSelector = memo(function ModelSelector({
  models,
  value,
  onChange,
}: {
  models: ModelOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const currentModel = models.find((m) => m.value === value);

  return (
    <div className="relative">
      {/* 触发按钮 */}
      <button
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-gray-100/80 transition-colors cursor-pointer"
        onClick={() => setOpen(!open)}
      >
        <span className="text-gray-600">
          {MODEL_ICON_MAP[currentModel?.icon || ''] || <RobotOutlined style={{ fontSize: 16 }} />}
        </span>
        <span className="text-[13px] font-medium text-gray-800">{currentModel?.label || '选择模型'}</span>
        <ChevronIcon className="text-gray-400 ml-0.5" />
      </button>

      {/* 下拉面板：截图2 样式 */}
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 mb-2 w-[288px] bg-white rounded-xl shadow-2xl border border-gray-100 ring-1 ring-black/5 overflow-hidden z-30">
            {models.map((model) => (
              <button
                key={model.value}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                  value === model.value ? 'bg-gray-100' : 'hover:bg-gray-50'
                }`}
                onClick={() => {
                  onChange(model.value);
                  setOpen(false);
                }}
              >
                {/* 左侧图标 */}
                <span className="text-gray-600 w-6 flex-shrink-0 flex justify-center">
                  {MODEL_ICON_MAP[model.icon || ''] || <RobotOutlined style={{ fontSize: 17 }} />}
                </span>

                {/* 中间：名称 + 描述 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[14px] font-medium text-gray-800">{model.label}</span>
                    {model.tag && (
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] font-medium leading-none"
                        style={{
                          backgroundColor: `${model.tagColor || '#f59e0b'}15`,
                          color: model.tagColor || '#f59e0b',
                        }}
                      >
                        {model.tag}
                      </span>
                    )}
                  </div>
                  {model.description && (
                    <div className="text-[12px] text-gray-400 mt-0.5 leading-tight">
                      {model.description}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
});

// ==================== 分辨率+比例选择器（截图3 样式）====================

// 比例图标：根据宽高比绘制精确的矩形示意
function RatioIcon({ value, active }: { value: string; active: boolean }) {
  if (value === 'free') {
    return (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="3" y="3" width="14" height="14" rx="1.5"
          stroke={active ? '#111827' : '#D1D5DB'} strokeWidth="1.5" strokeDasharray="3 2" fill="none" />
      </svg>
    );
  }

  const [w, h] = value.split(':').map(Number);
  const ratio = w / h;
  const size = 18;
  let iw, ih;
  if (ratio >= 1) {
    iw = size;
    ih = size / ratio;
  } else {
    ih = size;
    iw = size * ratio;
  }
  const ox = (size - iw) / 2;
  const oy = (size - ih) / 2;

  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <rect x={ox + 1} y={oy + 1} width={iw - 2} height={ih - 2}
        rx={Math.min(iw, ih) * 0.15}
        stroke={active ? '#111827' : '#9CA3AF'} strokeWidth={active ? 1.8 : 1.3}
        fill={active ? 'rgba(17,24,39,0.06)' : 'white'} />
    </svg>
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

  // 分辨率选项：
  // - 视频节点：根据选中模型的 resolutions 动态过滤；模型未配置则用默认全集
  // - 图片节点：固定 1K/2K/4K
  const modelResolutions = isVideo && selectedModelId
    ? models.find((m) => m.value === selectedModelId)?.resolutions
    : undefined;
  const resolutionOptions: readonly string[] = isVideo
    ? (modelResolutions && modelResolutions.length > 0 ? modelResolutions : VIDEO_RESOLUTION_OPTIONS)
    : RESOLUTION_OPTIONS;

  // 图片节点：doubao-seedream 系列不支持 1K
  const is1KDisabled = !isVideo && !!selectedModelId && selectedModelId.startsWith('doubao-seedream');

  // 当前分辨率不可用时自动回退：
  // - 图片：1K 被禁用时回退到 2K
  // - 视频：当前值不在模型支持列表时回退到第一个可用项
  let effectiveResolution: string = resolution;
  if (isVideo) {
    if (!resolutionOptions.includes(resolution)) {
      effectiveResolution = resolutionOptions[0] ?? resolution;
    }
  } else if (is1KDisabled && resolution === '1K') {
    effectiveResolution = '2K';
  }

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
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-gray-100/80 transition-colors cursor-pointer"
        onClick={() => setOpen(!open)}
      >
        <RatioIcon value={aspectRatio} active={true} />
        <span className="text-[13px] font-medium text-gray-800">{aspectRatio}</span>
        <span className="px-1.5 py-px rounded-md bg-gray-100 text-[10px] font-semibold text-gray-500 leading-relaxed">
          {effectiveResolution}
        </span>
        <ChevronIcon className="text-gray-400" />
      </button>

      {/* 弹出面板 */}
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 mb-2 w-[352px] bg-white rounded-2xl shadow-2xl border border-gray-100 ring-1 ring-black/5 p-4 z-30">
            {/* 清晰度 */}
            <div>
              <div className="flex items-baseline justify-between mb-2.5">
                <span className="text-[12px] font-semibold text-gray-800">清晰度</span>
                {isVideo && <span className="text-[10px] text-gray-400">按当前时长预估</span>}
              </div>
              <div className="flex gap-2">
                {resolutionOptions.map((res) => {
                  const disabled = !isVideo && is1KDisabled && res === '1K';
                  const isActive = effectiveResolution === res;
                  // 视频节点：查找该分辨率对应的单价和预估费用
                  let resPriceLabel: string | null = null;
                  if (isVideo && pricingNodes && selectedModelId) {
                    const realModelId = models.find((m) => m.value === selectedModelId)?.modelId || selectedModelId;
                    const priceItem = findVideoPricing(pricingNodes, realModelId, res);
                    if (priceItem && priceItem.price > 0) {
                      const dur = selectedDuration && selectedDuration > 0 ? selectedDuration : 4;
                      resPriceLabel = `${Math.ceil(priceItem.price * dur)}积分`;
                    }
                  }
                  return (
                    <button
                      key={res}
                      title={disabled ? '当前模型不支持该清晰度' : undefined}
                      className={`flex-1 rounded-xl border py-2 text-center transition-all ${
                        isActive
                          ? 'border-gray-900 bg-gray-900 text-white shadow-sm'
                          : disabled
                            ? 'border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed'
                            : 'border-gray-200 bg-white text-gray-700 hover:border-gray-400 hover:shadow-sm'
                      }`}
                      onClick={() => { if (!disabled) { onResolutionChange(res as ResolutionOption); setOpen(false); } }}
                      disabled={disabled}
                    >
                      <div className="text-[13px] font-semibold leading-none">{res}</div>
                      <div className={`text-[10px] leading-none mt-1.5 ${isActive ? 'text-gray-300' : disabled ? 'text-gray-300' : 'text-gray-400'}`}>
                        {resPriceLabel && !disabled ? resPriceLabel : (RESOLUTION_META[res] || '')}
                      </div>
                    </button>
                  );
                })}
              </div>
              {is1KDisabled && (
                <div className="text-[11px] text-amber-600 mt-2">当前模型不支持 1K 清晰度，已自动切换至 2K</div>
              )}
            </div>

            <div className="my-3.5 h-px bg-gray-100" />

            {/* 比例网格 */}
            <div>
              <div className="flex items-baseline justify-between mb-2.5">
                <span className="text-[12px] font-semibold text-gray-800">比例</span>
                <span className="text-[10px] text-gray-400">当前 {aspectRatio === 'free' ? '自适应' : aspectRatio}</span>
              </div>
              <div className="grid grid-cols-5 gap-2">
                {ASPECT_RATIO_ROWS.flat().map((item, index) => {
                  // 占位：空值渲染为透明占位元素
                  if (!item.value) {
                    return <div key={`placeholder-${index}`} />;
                  }
                  const isActive = aspectRatio === item.value;
                  return (
                    <button
                      key={item.value}
                      className={`rounded-xl transition-all flex flex-col items-center justify-center gap-1.5 py-2 ${
                        isActive
                          ? 'border-[1.5px] border-gray-900 bg-gray-900/[0.05] shadow-sm'
                          : 'border border-gray-200 bg-white hover:border-gray-400 hover:shadow-sm'
                      }`}
                      onClick={() => { onAspectRatioChange(item.value); setOpen(false); }}
                    >
                      <RatioIcon value={item.value} active={isActive} />
                      <span
                        className={`text-[11px] leading-none ${
                          isActive ? 'font-semibold text-gray-900' : 'text-gray-500'
                        }`}
                      >
                        {item.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
});

// ==================== 主工具栏（截图1 底部）====================

// 视频时长选项：4-15 秒（火山引擎 doubao-seedance-2.0 官方限制）
const DURATION_OPTIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

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
  charCount = 0,
}) {
  const isVideo = nodeType === 'video';
  const isAudio = nodeType === 'audio';
  const [durationOpen, setDurationOpen] = useState(false);

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
    <div className="flex items-center gap-0.5 pt-2.5 mt-0.5 border-t border-gray-100">
      {/* 模型选择器 */}
      <ModelSelector
        models={models}
        value={selectedModel}
        onChange={onModelChange}
      />

      {/* 分隔 */}
      <span className="w-px h-4 bg-gray-200 mx-0.5" />

      {/* 音色选择器（仅音频节点，分组显示） */}
      {isAudio && (
        <div className="relative">
          <button
            onClick={() => setVoiceOpen(!voiceOpen)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-gray-100/80 transition-colors cursor-pointer text-[13px]"
          >
            <SoundOutlined className="text-gray-500 text-xs" />
            <span className="text-gray-800 font-medium">
              {VOICE_OPTIONS.find((v) => v.value === selectedVoice)?.label || '音色'}
            </span>
            <ChevronIcon className="text-gray-400" />
          </button>
          {voiceOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setVoiceOpen(false)} />
              <div className="absolute bottom-full left-0 mb-2 w-[160px] max-h-[320px] overflow-y-auto bg-white rounded-xl shadow-2xl border border-gray-100 ring-1 ring-black/5 z-30">
                {VOICE_GROUPS.map(([groupName, voices]) => (
                  <div key={groupName}>
                    <div className="px-3 py-1 text-[10px] text-gray-400 bg-gray-50 sticky top-0">{groupName}</div>
                    {voices.map((opt) => (
                      <button
                        key={opt.value}
                        className={`w-full px-3 py-1.5 text-left text-[13px] transition-colors ${
                          selectedVoice === opt.value ? 'bg-gray-100 font-medium' : 'hover:bg-gray-50'
                        }`}
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
            className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-gray-100/80 transition-colors cursor-pointer text-[13px]"
          >
            <span className="text-gray-600">{selectedSpeed}x</span>
            <ChevronIcon className="text-gray-400" />
          </button>
          {speedOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setSpeedOpen(false)} />
              <div className="absolute bottom-full left-0 mb-2 w-[120px] bg-white rounded-xl shadow-2xl border border-gray-100 ring-1 ring-black/5 overflow-hidden z-30">
                {SPEED_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={`w-full px-3 py-1.5 text-left text-[13px] transition-colors ${
                      selectedSpeed === opt.value ? 'bg-gray-100 font-medium' : 'hover:bg-gray-50'
                    }`}
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
            className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-gray-100/80 transition-colors cursor-pointer text-[13px]"
          >
            <span className="text-gray-800 font-medium">
              {STYLE_OPTIONS.find((s) => s.value === selectedStyle)?.label || '风格'}
            </span>
            <ChevronIcon className="text-gray-400" />
          </button>
          {styleOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setStyleOpen(false)} />
              <div className="absolute bottom-full left-0 mb-2 w-[130px] bg-white rounded-xl shadow-2xl border border-gray-100 ring-1 ring-black/5 overflow-hidden z-30">
                {STYLE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={`w-full px-3 py-1.5 text-left text-[13px] transition-colors ${
                      selectedStyle === opt.value ? 'bg-gray-100 font-medium' : 'hover:bg-gray-50'
                    }`}
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
            className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-gray-100/80 transition-colors cursor-pointer text-[13px]"
          >
            <span className="font-mono text-[10px] text-orange-500">（）</span>
            <span className="text-gray-800 font-medium">
              {TONE_OPTIONS.find((t) => t.value === selectedTone)?.label || '语气词'}
            </span>
            <ChevronIcon className="text-gray-400" />
          </button>
          {toneOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setToneOpen(false)} />
              <div className="absolute bottom-full left-0 mb-2 w-[128px] max-h-[320px] overflow-y-auto bg-white rounded-xl shadow-2xl border border-gray-100 ring-1 ring-black/5 z-30">
                {/* 默认项 */}
                <button
                  className={`w-full px-3 py-1.5 text-left text-[13px] transition-colors ${
                    selectedTone === '' ? 'bg-gray-100 font-medium' : 'hover:bg-gray-50'
                  }`}
                  onClick={() => { onToneChange?.(''); setToneOpen(false); }}
                >
                  默认
                </button>
                {TONE_GROUPS.map(([groupName, tones]) => (
                  <div key={groupName}>
                    <div className="px-3 py-1 text-[10px] text-gray-400 bg-gray-50 sticky top-0">{groupName}</div>
                    {tones.map((opt) => (
                      <button
                        key={opt.value}
                        className={`w-full px-3 py-1.5 text-left text-[13px] transition-colors ${
                          selectedTone === opt.value ? 'bg-gray-100 font-medium' : 'hover:bg-gray-50'
                        }`}
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
              className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-gray-100/80 transition-colors cursor-pointer text-[13px] text-gray-600"
              title="视频时长（4-15秒）"
            >
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="5.5" stroke="#6B7280" strokeWidth="1.3" />
                <path d="M7 4v3l2 1.5" stroke="#6B7280" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="font-medium text-gray-800">{selectedDuration}s</span>
              <ChevronIcon className="text-gray-400" />
            </button>
            {durationOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setDurationOpen(false)} />
                <div className="absolute bottom-full right-0 mb-2 w-[64px] bg-white rounded-xl shadow-2xl border border-gray-100 ring-1 ring-black/5 overflow-hidden z-30 max-h-[260px] overflow-y-auto">
                  {DURATION_OPTIONS.map((opt) => (
                    <button
                      key={opt}
                      className={`w-full px-3 py-1.5 text-left text-[13px] transition-colors ${
                        selectedDuration === opt ? 'bg-gray-100 font-medium text-gray-900' : 'text-gray-600 hover:bg-gray-50'
                      }`}
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

        {/* 声音开关（仅视频节点，时长选择器右侧） */}
        {isVideo && (
          <button
            onClick={() => onGenerateAudioChange?.(!generateAudio)}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg transition-colors cursor-pointer text-[13px] mr-1 ${
              generateAudio
                ? 'bg-gray-100 text-gray-800'
                : 'text-gray-400 hover:bg-gray-100/80'
            }`}
            title={generateAudio ? '声音：开（点击关闭）' : '声音：关（点击开启）'}
          >
            {generateAudio
              ? <SoundOutlined style={{ fontSize: 14 }} />
              : <AudioMutedOutlined style={{ fontSize: 14 }} />}
            <span className="text-[12px]">{generateAudio ? '声音' : '静音'}</span>
          </button>
        )}

        {/* 费用提示（生成按钮左侧） */}
        {estimatedCost !== null && estimatedCost > 0 && (
          <span className="text-[11px] text-gray-500 mr-1.5 whitespace-nowrap">
            {estimatedCost} 积分
          </span>
        )}

        {/* 生成按钮 */}
        <button
          className="h-8 px-3.5 rounded-xl bg-gradient-to-br from-gray-800 to-gray-950 text-white flex items-center justify-center hover:from-gray-700 hover:to-gray-900 active:scale-95 transition-all duration-150 flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm text-[13px] font-medium tracking-wide"
          onClick={() => onGenerate?.(1)}
          disabled={isGenerating}
        >
          {isGenerating ? '生成中…' : '生成'}
        </button>
      </div>
    </div>
  );
});
