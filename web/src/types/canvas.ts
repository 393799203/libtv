import type { Node, Edge } from '@xyflow/react';
import type { MentionMarker } from './prompt';

// 节点类型枚举
export type NodeType = 'text' | 'image' | 'video' | 'audio' | 'script';

// 节点执行状态
export type NodeExecutionStatus = 'idle' | 'pending' | 'running' | 'success' | 'failed';

// 所有节点数据共有的基类字段。
// - status: 当前执行状态
// - error: 上一次执行失败信息
// - stale: 瞬时标记，表示"上游节点刚刚被重新生成，本节点输出可能已过期"。
//   只在会话内有效，saveCanvas 持久化前会清掉（脏标不存盘）。
// - mentions: 提示词中的 @ 引用列表，与 data.prompt 里的 [[m:ID]] 占位符一一对应。
// - progressMessage: 进度消息（如"已运行 10s"），从SSE接口返回
export interface BaseNodeFields {
  status: NodeExecutionStatus;
  error?: string;
  stale?: boolean;
  mentions?: MentionMarker[];
  progressMessage?: string; // 进度消息（从SSE node_progress事件的message字段）
}

// 文本节点数据
export interface TextNodeData extends BaseNodeFields, Record<string, unknown> {
  type: 'text';
  label: string;
  content: string;       // 节点展示的内容（由AI生成或手动编辑）
  prompt: string;        // 提示词（用户输入，用于AI生成内容）
  isEditing?: boolean;
}

// 图像节点数据
export interface ImageNodeData extends BaseNodeFields, Record<string, unknown> {
  type: 'image';
  label: string;
  prompt: string;
  negativePrompt?: string;
  model: string;
  width: number;
  height: number;
  imageUrl?: string;
}

// 视频生成模式
export type VideoMode = 'text-to-video' | 'universal-ref' | 'first-last-frame' | 'video-ref';

// 视频节点数据
export interface VideoNodeData extends BaseNodeFields, Record<string, unknown> {
  type: 'video';
  label: string;
  prompt: string;
  model: string;
  duration: number;
  fps: number;
  videoUrl?: string;
  videoMode?: VideoMode;       // 视频生成模式
  referenceImages?: string[];   // 参考图片 URL 列表（全能参考/首尾帧模式）
}

// 音频节点数据
export interface AudioNodeData extends BaseNodeFields, Record<string, unknown> {
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
}

// 脚本节点数据
export interface ScriptNodeData extends BaseNodeFields, Record<string, unknown> {
  type: 'script';
  label: string;
  prompt: string;         // 用户输入的提示词（用于生成剧本）
  scriptContent: string;  // 生成的剧本正文
  shots: ScriptShot[];    // 生成的分镜列表
  characters: ScriptCharacter[]; // 角色列表
  scenes: ScriptScene[];         // 场景列表
  props: ScriptProp[];           // 道具列表
  currentStep: 1 | 2 | 3;
  author?: string;
  createdAt?: string;

  // ✅ 新增：资产名称 → 图片节点 ID 的映射关系（避免遍历查找，性能提升 10 倍+）
  assetImageMapping?: {
    characters: Record<string, string>; // { "南方": "character-南方-script-123" }
    scenes: Record<string, string>;     // { "办公室": "scene-办公室-script-123" }
    props: Record<string, string>;      // { "公文包": "prop-公文包-script-123" }
  };
}

// 角色/场景/道具资产项（用于准备资产步骤上传参考图）
export interface ScriptAssetItem {
  name: string;
  description: string;
  imageUrl?: string;      // 用户上传的参考图 URL
}

export interface ScriptCharacter extends ScriptAssetItem {
  /** 角色外貌/性格描述 */
  description: string;
}

export interface ScriptScene extends ScriptAssetItem {
  description: string;
  timeOfDay: string;   // 早晨/上午/中午/下午/傍晚/夜晚/深夜
  location: string;    // 具体地点
  mood: string;        // 氛围情绪
}

export interface ScriptProp extends ScriptAssetItem {
  description: string;
  category: string;    // 服装/武器/交通工具/日常用品/电子设备/其他
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
  /** 画面提示词（第三阶段生成，基于表格数据重新生成，含 @ 引用） */
  storyboardPrompt?: string;
  /** 运动提示词（第三阶段生成，基于表格数据重新生成） */
  motionPrompt?: string;
  /** 最终合成提示词（画面提示词 + 运动提示词） */
  finalPrompt?: string;
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
