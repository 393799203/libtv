import type {
  PromptPanelConfig,
  ModelOption,
} from '@/types/prompt';
import type { NodeType } from '@/types/canvas';

// ==================== 分辨率选项 ====================

export const RESOLUTION_OPTIONS = ['1K', '2K', '4K'] as const;

// 视频节点分辨率选项（值直接传给后端）
export const VIDEO_RESOLUTION_OPTIONS = ['480p', '720p', '1080p', '4K'] as const;
export type VideoResolutionOption = typeof VIDEO_RESOLUTION_OPTIONS[number];

// wan3.0（阿里万相）支持的画幅比例（其余视频模型不限制；free=自适应，后端映射为 adaptive）
export const WAN3_VIDEO_ASPECT_RATIOS = ['free', '16:9', '4:3', '1:1', '3:4', '9:16'] as const;

// ==================== 画质选项 ====================

export const QUALITY_OPTIONS = ['低画质', '标准画质', '高画质'] as const;

// ==================== 比例选项（按行排列，精确匹配截图）====================

export const ASPECT_RATIO_ROWS: Array<Array<{ value: string; label: string }>> = [
  // 第1行：自适应 + 常用竖屏/横屏
  [
    { value: 'free', label: '自适应' },
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
    acceptedInputs: ['image', 'text', 'script'],
    defaultModel: 'doubao-seedream-5.0-lite',  // 默认模型 ID（豆包 Seedream 5.0 Lite）
    defaultResolution: '2K',
    defaultAspectRatio: '16:9',
    availableModels: [],  // 空数组，由组件从 Store 动态获取
    toolbarControls: ['model', 'aspectRatio', 'negativePrompt', 'count', 'tokenCount'],
    placeholder: '描述你想生成的图像，可 @ 引用上游图片或文本...',
    maxLength: 2000,
  },
  video: {
    acceptedInputs: ['image', 'video', 'text', 'script', 'audio'],
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
    defaultResolution: '1K',
    defaultAspectRatio: 'free',
    availableModels: [],
    toolbarControls: ['model', 'tokenCount'],
    placeholder: '写下你想讲的故事、场景或角色设定...',
    maxLength: 4000,
  },
  audio: {
    acceptedInputs: ['text', 'script'],
    defaultModel: 'audio-default',
    defaultResolution: '1K',
    defaultAspectRatio: 'free',
    availableModels: [],
    toolbarControls: ['model', 'voice', 'speed'],
    placeholder: '输入要转换为语音的文本...',
    maxLength: 5000,
  },
  script: {
    acceptedInputs: ['text'],
    defaultModel: 'script-default',
    defaultResolution: '1K',
    defaultAspectRatio: 'free',
    availableModels: [],
    toolbarControls: ['model', 'tokenCount'],
    placeholder: '连接上游文本节点后，点击生成剧本分镜...',
    maxLength: 8000,
  },
  // 白模预演节点不使用提示词面板，仅占位满足 Record 穷尽检查
  previz: {
    acceptedInputs: [],
    defaultModel: '',
    defaultResolution: '1K',
    defaultAspectRatio: 'free',
    availableModels: [],
    toolbarControls: [],
    placeholder: '',
    maxLength: 0,
  },
};
