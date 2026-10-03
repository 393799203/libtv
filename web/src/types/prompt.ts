import type { NodeType } from './canvas';

// 上游输入类型
export interface UpstreamInput {
  nodeId: string;
  nodeType: 'image' | 'video' | 'text' | 'script' | 'audio' | 'previz';
  label: string;
  /** 图片类缩略（previz 用其白模静帧） */
  thumbnail?: string;
  /** 视频类预览地址（previz 用其白片） */
  previewUrl?: string;
  textSnippet?: string;
}

// 模型选项
export interface ModelOption {
  value: string;           // 模型ID（用于显示和匹配）
  modelId: string;         // 实际调用API时使用的model_id
  label: string;
  icon?: string;           // 图标名称
  duration?: number;       // 预估耗时（秒）
  description?: string;    // 副标题描述
  tag?: string;            // 标签（如"限时5折"）
  tagColor?: string;       // 标签颜色
  isDefault?: boolean;     // 是否为默认模型（从后端配置读取）
  resolutions?: string[];  // 支持的分辨率列表（视频模型用，来自后端 models.yaml）
  /** 视频时长范围 [min,max]（秒），来自后端 models.yaml 的 duration_range */
  durationRange?: number[];
  /** 所属渠道（wasu/dianxin）：切换渠道后用于判断旧模型是否仍可用（渠道不同即置灰） */
  provider?: string;
}

// 分辨率选项（图片节点用 1K/2K/4K，视频节点用 480p/720p/1080p/4K）
export type ResolutionOption = '1K' | '2K' | '4K' | '480p' | '720p' | '1080p';

// 比例选项
export type AspectRatioOption =
  | 'adaptive' // 自适应（历史值 'free' 由 normalizeAspectRatio 兼容）
  | '1:1'
  | '9:16'
  | '16:9'
  | '3:4'
  | '4:3'
  | '3:2'
  | '2:3'
  | '4:5'
  | '5:4'
  | '8:1'
  | '1:8'
  | '4:1'
  | '1:4'
  | '21:9';

// 底部工具栏控件类型
export type ToolbarControl =
  | 'model'
  | 'aspectRatio'
  | 'camera'
  | 'viewMode'
  | 'negativePrompt'
  | 'voice'
  | 'speed'
  | 'duration'
  | 'count'
  | 'tokenCount'
  | 'referenceToggle';

// 每种节点对应的提示词面板配置
export interface PromptPanelConfig {
  // previz（白模预演）：产出白片视频 / 白模静帧，可作为视频或图片参考被下游消费
  acceptedInputs: ('image' | 'video' | 'text' | 'script' | 'audio' | 'previz')[];
  defaultModel: string;
  defaultResolution: ResolutionOption;
  defaultAspectRatio: AspectRatioOption;
  availableModels: ModelOption[];
  toolbarControls: ToolbarControl[];
  placeholder: string;
  maxLength: number;
}

// @ 引用标记（内嵌在 prompt 文本中）
export interface MentionMarker {
  id: string;            // 唯一 ID
  nodeId: string;        // 引用的上游节点 ID
  label: string;         // 显示文本，如 "图片1"
  nodeType: UpstreamInput['nodeType'];
}
