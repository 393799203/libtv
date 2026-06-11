import type { Node, Edge } from '@xyflow/react';

// 节点类型枚举
export type NodeType = 'text' | 'image' | 'video' | 'audio' | 'script';

// 节点执行状态
export type NodeExecutionStatus = 'idle' | 'pending' | 'running' | 'success' | 'failed';

// 文本节点数据
export interface TextNodeData extends Record<string, unknown> {
  type: 'text';
  label: string;
  content: string;       // 节点展示的内容（由AI生成或手动编辑）
  prompt: string;        // 提示词（用户输入，用于AI生成内容）
  isEditing?: boolean;
  status: NodeExecutionStatus;
  error?: string;
}

// 图像节点数据
export interface ImageNodeData extends Record<string, unknown> {
  type: 'image';
  label: string;
  prompt: string;
  negativePrompt?: string;
  model: string;
  width: number;
  height: number;
  imageUrl?: string;
  status: NodeExecutionStatus;
  error?: string;
  // 风格关联字段（选中风格时持久化到节点数据）
  styleId?: string;
  styleName?: string;
  styleImageUrl?: string;
}

// 视频生成模式
export type VideoMode = 'text-to-video' | 'universal-ref' | 'first-last-frame' | 'video-ref';

// 视频节点数据
export interface VideoNodeData extends Record<string, unknown> {
  type: 'video';
  label: string;
  prompt: string;
  model: string;
  duration: number;
  fps: number;
  videoUrl?: string;
  videoMode?: VideoMode;       // 视频生成模式
  referenceImages?: string[];   // 参考图片 URL 列表（全能参考/首尾帧模式）
  status: NodeExecutionStatus;
  error?: string;
}

// 音频节点数据
export interface AudioNodeData extends Record<string, unknown> {
  type: 'audio';
  label: string;
  text: string;
  voice: string;
  speed: number;
  audioUrl?: string;
  status: NodeExecutionStatus;
  error?: string;
}

// 脚本节点数据
export interface ScriptNodeData extends Record<string, unknown> {
  type: 'script';
  label: string;
  scriptContent: string;
  shots: ScriptShot[];
  status: NodeExecutionStatus;
  error?: string;
}

// 分镜数据
export interface ScriptShot {
  id: string;
  shotNumber: number;
  description: string;
  dialogue?: string;
  cameraMovement?: string;
  duration?: number;
  imageUrl?: string;
}

// 节点数据联合类型
export type LibTVNodeData =
  | TextNodeData
  | ImageNodeData
  | VideoNodeData
  | AudioNodeData
  | ScriptNodeData;

// 画布节点类型
export type LibTVNode = Node<LibTVNodeData, NodeType>;

// 数据流连线数据
export interface DataFlowEdgeData extends Record<string, unknown> {
  label?: string;
  animated?: boolean;
}

// 画布连线类型
export type LibTVEdge = Edge<DataFlowEdgeData>;

// 画布数据（持久化格式）
export interface CanvasData {
  nodes: LibTVNode[];
  edges: LibTVEdge[];
  viewport: {
    x: number;
    y: number;
    zoom: number;
  };
}

// Handle 位置定义
export const HANDLE_POSITIONS = {
  input: 'left' as const,
  output: 'right' as const,
};

// 节点类型配置
export const NODE_TYPE_CONFIG: Record<NodeType, { label: string; color: string; icon: string }> = {
  text: { label: '文本', color: '#8b5cf6', icon: 'FileTextOutlined' },
  image: { label: '图像', color: '#3b82f6', icon: 'PictureOutlined' },
  video: { label: '视频', color: '#ef4444', icon: 'VideoCameraOutlined' },
  audio: { label: '音频', color: '#10b981', icon: 'AudioOutlined' },
  script: { label: '脚本', color: '#f59e0b', icon: 'CodeOutlined' },
};
