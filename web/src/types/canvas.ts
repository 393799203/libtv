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
  prompt: string;          // 提示词（文本生成音频时使用）
  text: string;            // 上游文本节点传入的文本内容
  voice: string;           // 音色/语音模型
  speed: number;           // 语速
  model: string;           // 音频生成模型
  duration: number;        // 音频时长（秒）
  audioUrl?: string;       // 音频文件 URL
  audioName?: string;      // 音频名称（显示在头部）
  status: NodeExecutionStatus;
  error?: string;
}

// 脚本节点数据
export interface ScriptNodeData extends Record<string, unknown> {
  type: 'script';
  label: string;
  scriptContent: string;
  shots: ScriptShot[];
  /** 当前工作流步骤：1-确认镜头 / 2-准备资产 / 3-合成提示词 */
  currentStep: 1 | 2 | 3;
  /** 作者 */
  author?: string;
  /** 创建日期（ISO字符串） */
  createdAt?: string;
  status: NodeExecutionStatus;
  error?: string;
}

// 分镜数据（扩展版，匹配截图中的表格列）
export interface ScriptShot {
  id: string;
  shotNumber: number;
  /** 时长（秒） */
  duration: number;
  /** 画面提示词（AI生成，含高亮标记） */
  visualPrompt: string;
  /** 镜别：中景/特写/全景/近景等 */
  shotSize: string;
  /** 拍摄角度 */
  cameraAngle: string;
  /** 对白/旁白 */
  dialogue: string;
  /** 音效描述 */
  soundEffect: string;
  /** 运镜方式 */
  cameraMovement: string;
  /** 基调/风格提示方式 */
  toneHint: string;
  /** 生成的参考图 URL */
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
