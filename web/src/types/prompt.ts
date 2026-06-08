import type { NodeType } from './canvas';

// 上游输入类型
export interface UpstreamInput {
  nodeId: string;
  nodeType: 'image' | 'video' | 'text' | 'script';
  label: string;
  thumbnail?: string;
  previewUrl?: string;
  textSnippet?: string;
}

// 模型选项
export interface ModelOption {
  value: string;
  label: string;
  icon?: string;           // 图标名称
  duration?: number;       // 预估耗时（秒）
  description?: string;    // 副标题描述
  tag?: string;            // 标签（如"限时5折"）
  tagColor?: string;       // 标签颜色
}

// 分辨率选项
export type ResolutionOption = '1K' | '2K' | '4K';

// 比例选项
export type AspectRatioOption =
  | 'free'     // 自适应
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
  acceptedInputs: ('image' | 'video' | 'text' | 'script')[];
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
