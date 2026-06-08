import type {
  PromptPanelConfig,
  ModelOption,
} from '@/types/prompt';
import type { NodeType } from '@/types/canvas';

// ==================== 模型数据 ====================

export const IMAGE_MODELS: ModelOption[] = [
  {
    value: 'lib-image',
    label: 'Lib Image',
    icon: 'link',
    duration: 60,
  },
  {
    value: 'lib-navo-pro',
    label: 'Lib Navo Pro',
    icon: 'close',
    duration: 50,
  },
  {
    value: 'lib-navo-2',
    label: 'Lib Navo 2',
    icon: 'close',
    duration: 25,
    description: '支持联网搜索、文字准确、速度更快',
  },
  {
    value: 'seedream-4.6',
    label: 'Seedream 4.6',
    icon: 'bar-chart',
    duration: 20,
  },
  {
    value: 'seedream-5.0-lite',
    label: 'Seedream 5.0 Lite',
    icon: 'bar-chart',
    duration: 20,
  },
  {
    value: 'seedream-4.5',
    label: 'Seedream 4.5',
    icon: 'bar-chart',
    duration: 15,
    tag: '限时5折',
    tagColor: '#f59e0b',
  },
  {
    value: 'midjourney-v7',
    label: 'Midjourney V7',
    icon: 'robot',
    duration: 50,
  },
];

export const VIDEO_MODELS: ModelOption[] = [
  {
    value: 'kling-2.0',
    label: 'Kling 2.0',
    icon: 'video-camera',
    duration: 60,
  },
  {
    value: 'runway-gen3',
    label: 'Runway Gen3',
    icon: 'thunderbolt',
    duration: 45,
  },
  {
    value: 'sora',
    label: 'Sora',
    icon: 'cloud',
    duration: 120,
  },
];

export const TEXT_MODELS: ModelOption[] = [
  { value: 'gvlm-4', label: 'GVLM 4', icon: 'robot' },
  { value: 'claude', label: 'Claude', icon: 'message' },
  { value: 'gpt-4', label: 'GPT-4', icon: 'openai' },
];

export const AUDIO_MODELS: ModelOption[] = [
  { value: 'tts-1', label: 'TTS Pro', icon: 'audio' },
  { value: 'cosyvoice', label: 'CosyVoice', icon: 'sound' },
];

// ==================== 分辨率选项 ====================

export const RESOLUTION_OPTIONS = ['1K', '2K', '4K'] as const;

// ==================== 比例选项（按行排列） ====================

export const ASPECT_RATIO_ROWS: Array<Array<{ value: string; label: string }>> = [
  [
    { value: 'free', label: '自适应' },
    { value: '1:1', label: '1:1' },
    { value: '9:16', label: '9:16' },
    { value: '16:9', label: '16:9' },
    { value: '3:4', label: '3:4' },
  ],
  [
    { value: '4:3', label: '4:3' },
    { value: '3:2', label: '3:2' },
    { value: '2:3', label: '2:3' },
    { value: '4:5', label: '4:5' },
    { value: '5:4', label: '5:4' },
  ],
  [
    { value: '8:1', label: '8:1' },
    { value: '1:8', label: '1:8' },
    { value: '4:1', label: '4:1' },
    { value: '1:4', label: '1:4' },
    { value: '21:9', label: '21:9' },
  ],
];

// ==================== 各节点类型的面板配置 Map ====================

export const PROMPT_PANEL_CONFIGS: Record<NodeType, PromptPanelConfig> = {
  image: {
    acceptedInputs: ['image', 'text', 'script'],
    defaultModel: 'lib-navo-2',
    defaultResolution: '1K',
    defaultAspectRatio: '1:1',
    availableModels: IMAGE_MODELS,
    toolbarControls: ['model', 'aspectRatio', 'negativePrompt', 'count', 'tokenCount'],
    placeholder: '描述你想生成的图像，可 @ 引用上游图片或文本...',
    maxLength: 2000,
  },
  video: {
    acceptedInputs: ['image', 'video', 'text', 'script'],
    defaultModel: 'kling-2.0',
    defaultResolution: '1K',
    defaultAspectRatio: '9:16',
    availableModels: VIDEO_MODELS,
    toolbarControls: ['model', 'aspectRatio', 'camera', 'viewMode', 'duration', 'count', 'tokenCount'],
    placeholder: '描述视频内容、运镜方式、风格，可 @ 引用上游素材...',
    maxLength: 2000,
  },
  text: {
    acceptedInputs: ['text', 'script', 'image'],
    defaultModel: 'gvlm-4',
    defaultResolution: '1K',
    defaultAspectRatio: 'free',
    availableModels: TEXT_MODELS,
    toolbarControls: ['model', 'tokenCount'],
    placeholder: '写下你想讲的故事、场景或角色设定...',
    maxLength: 4000,
  },
  audio: {
    acceptedInputs: ['text', 'script'],
    defaultModel: 'tts-1',
    defaultResolution: '1K',
    defaultAspectRatio: 'free',
    availableModels: AUDIO_MODELS,
    toolbarControls: ['model', 'voice', 'speed'],
    placeholder: '输入要转换为语音的文本...',
    maxLength: 5000,
  },
  script: {
    acceptedInputs: ['text'],
    defaultModel: 'gvlm-4',
    defaultResolution: '1K',
    defaultAspectRatio: 'free',
    availableModels: TEXT_MODELS,
    toolbarControls: ['model', 'tokenCount'],
    placeholder: '描述故事大纲、场景、角色...',
    maxLength: 8000,
  },
};
