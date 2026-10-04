import type {
  PromptPanelConfig,
  ModelOption,
} from '@/types/prompt';
import type { NodeType } from '@/types/canvas';

// ==================== 分辨率选项 ====================

// 图片分辨率档位。'1K' 已下线（2026-10）：它在上游是按像素计费的廉价档，
// 挂在同一个价上卖既拉低毛利、又让「标准/高清/极致」三档说不清贵在哪，
// 因此统一收敛为 2K / 4K 两档（老画布里残留的 '1K' 仍能正常生成与计费，见 executor 的兼容分支）
export const RESOLUTION_OPTIONS = ['2K', '4K'] as const;

// 视频节点分辨率选项（值直接传给后端）
export const VIDEO_RESOLUTION_OPTIONS = ['480p', '720p', '1080p', '4K'] as const;
export type VideoResolutionOption = typeof VIDEO_RESOLUTION_OPTIONS[number];

// wan3.0（阿里万相）支持的画幅比例（其余视频模型不限制）。
// 'adaptive' = 自适应：这是上游（火山 Seedance / 阿里万相）认的协议值，画布与后端都用它。
// 历史上这个枚举叫 'free'，已统一改名 —— 老画布里的 'free' 由 normalizeAspectRatio 兼容。
export const WAN3_VIDEO_ASPECT_RATIOS = ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16'] as const;

// ==================== 视频时长范围 ====================

/**
 * 视频时长默认范围（秒，闭区间）：模型未在 models.yaml 配置 duration_range 时使用。
 * 每个视频模型都应在后端 models.yaml 显式声明自己的 duration_range，
 * 前端一律以配置为准（与渠道无关，同名模型同范围），不再按模型名硬编码
 */
export const DEFAULT_VIDEO_DURATION_RANGE: [number, number] = [4, 15];

/** 取模型的视频时长范围（秒），配置缺失/非法时回退默认值 */
export function videoDurationRange(model?: Pick<ModelOption, 'durationRange'>): [number, number] {
  const r = model?.durationRange;
  if (r && r.length >= 2 && r[1] > r[0]) return [r[0], r[1]];
  return DEFAULT_VIDEO_DURATION_RANGE;
}

/** 按模型配置生成可选时长列表（秒），如 [2,30] → [2,3,…,30] */
export function buildDurationOptions(model?: Pick<ModelOption, 'durationRange'>): number[] {
  const [min, max] = videoDurationRange(model);
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}

// ==================== 画质选项 ====================

export const QUALITY_OPTIONS = ['低画质', '标准画质', '高画质'] as const;

/**
 * 画幅比例归一化：把历史枚举值 'free'（以及空值）统一成 'adaptive'。
 *
 * 为什么需要：'free' 是早期的画布内部值，现在统一成上游协议同名的 'adaptive'。
 * 线上已落库的画布里没有任何 'free'（改名前统计：画布表 0 条、执行快照 0 条），
 * 所以只是防御性兼容 —— 万一有本地草稿或旧版本前端写入过 'free'，读的时候要对上。
 */
export function normalizeAspectRatio(value?: string | null): string {
  if (!value || value === 'free') return 'adaptive';
  return value;
}

/**
 * 画幅比例的**显示**文案：'adaptive'（以及历史值 'free'）要显示成「自适应」。
 *
 * 枚举值必须和上游协议同名（adaptive），但界面上不能把协议词直接摊给用户看 ——
 * 比例按钮上原来渲染的是原始值，于是显示成 "free"（像"免费"）、改名后又显示成
 * "adaptive"（英文协议词）。凡是把比例当文本显示的地方，一律走这个函数。
 */
export function aspectRatioLabel(value?: string | null): string {
  const v = normalizeAspectRatio(value);
  if (v === 'adaptive') return '自适应';
  return v;
}

// ==================== 比例选项（按行排列，精确匹配截图）====================

export const ASPECT_RATIO_ROWS: Array<Array<{ value: string; label: string }>> = [
  // 第1行：自适应 + 常用竖屏/横屏
  [
    { value: 'adaptive', label: '自适应' },
    { value: '1:1', label: '1:1' },
    { value: '1:2', label: '1:2' },
    { value: '2:1', label: '2:1' },
    { value: '9:16', label: '9:16' },
  ],
  // 第2行：常用比例（16:9 默认选中）
  [
    { value: '16:9', label: '16:9' },
    { value: '3:4', label: '3:4' },
    { value: '4:3', label: '4:3' },
    { value: '3:2', label: '3:2' },
    { value: '2:3', label: '2:3' },
  ],
  // 第3行：特殊比例
  [
    { value: '5:4', label: '5:4' },
    { value: '4:5', label: '4:5' },
    { value: '21:9', label: '21:9' },
    { value: '9:21', label: '9:21' },
    { value: '', label: '' }, // 占位对齐
  ],
];

// ==================== 各节点类型的面板配置 Map ====================

export const PROMPT_PANEL_CONFIGS: Record<NodeType, PromptPanelConfig> = {
  image: {
    // previz：白模预演的静帧可作构图参考（锁构图）
    acceptedInputs: ['image', 'text', 'script', 'previz'],
    defaultModel: 'doubao-seedream-5.0-lite',  // 默认模型 ID（豆包 Seedream 5.0 Lite）
    defaultResolution: '2K',
    defaultAspectRatio: '16:9',
    availableModels: [],  // 空数组，由组件从 Store 动态获取
    toolbarControls: ['model', 'aspectRatio', 'negativePrompt', 'count', 'tokenCount'],
    placeholder: '描述你想生成的图像，可 @ 引用上游图片或文本...',
    maxLength: 2000,
  },
  video: {
    // previz：白模预演的白片可作视频参考（走位/动作/镜头以此为准）
    acceptedInputs: ['image', 'video', 'text', 'script', 'audio', 'previz'],
    defaultModel: 'doubao-seedance-2.0-fast',  // 默认模型 ID（seedance2.0 fast）
    defaultResolution: '720p',
    defaultAspectRatio: '16:9',
    availableModels: [],
    toolbarControls: ['model', 'aspectRatio', 'camera', 'viewMode', 'duration', 'count', 'tokenCount'],
    placeholder: '描述视频内容、运镜方式、风格，可 @ 引用上游素材...',
    maxLength: 2000,
  },
  text: {
    acceptedInputs: ['text', 'script', 'image'],
    defaultModel: 'deepseek-v4-flash',
    defaultResolution: '2K',
    defaultAspectRatio: 'adaptive',
    availableModels: [],
    toolbarControls: ['model', 'tokenCount'],
    placeholder: '写下你想讲的故事、场景或角色设定...',
    maxLength: 4000,
  },
  audio: {
    acceptedInputs: ['text', 'script'],
    defaultModel: 'audio-default',
    defaultResolution: '2K',
    defaultAspectRatio: 'adaptive',
    availableModels: [],
    toolbarControls: ['model', 'voice', 'speed'],
    placeholder: '输入要转换为语音的文本...',
    maxLength: 5000,
  },
  script: {
    acceptedInputs: ['text'],
    defaultModel: 'script-default',
    defaultResolution: '2K',
    defaultAspectRatio: 'adaptive',
    availableModels: [],
    toolbarControls: ['model', 'tokenCount'],
    placeholder: '连接上游文本节点后，点击生成剧本分镜...',
    maxLength: 8000,
  },
  // 白模预演节点不使用提示词面板，仅占位满足 Record 穷尽检查
  previz: {
    acceptedInputs: [],
    defaultModel: '',
    defaultResolution: '2K',
    defaultAspectRatio: 'adaptive',
    availableModels: [],
    toolbarControls: [],
    placeholder: '',
    maxLength: 0,
  },
  // 清晰化节点不使用提示词面板（只吃上游视频 + 一个档位），仅占位满足 Record 穷尽检查。
  // acceptedInputs 仍按真实语义写：它接受视频（含白模白片），供连线校验使用
  enhance: {
    acceptedInputs: ['video', 'previz'],
    defaultModel: '',
    defaultResolution: '2K',
    defaultAspectRatio: 'adaptive',
    availableModels: [],
    toolbarControls: [],
    placeholder: '',
    maxLength: 0,
  },
};
