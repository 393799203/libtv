import type { Node, Edge } from '@xyflow/react';
import type { MentionMarker } from './prompt';

// 节点类型枚举
export type NodeType = 'text' | 'image' | 'video' | 'audio' | 'script' | 'previz' | 'enhance';

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
  /**
   * 节点所选模型所属的 AI 渠道（wasu/dianxin）。
   * 华数/电信存在同名模型（如 doubao-seedream-5.0-lite），仅凭 model 无法判断当初选的是哪个渠道；
   * 记录本字段后，渠道切换即可判定该模型需要重新选择（置灰并拦截生成）。
   * 历史节点无此字段 → 视为华数（历史数据均为华数时代创建）。
   */
  modelProvider?: string;
}

// 文本节点数据
export interface TextNodeData extends BaseNodeFields, Record<string, unknown> {
  type: 'text';
  label: string;
  content: string;       // 节点展示的内容（由AI生成或手动编辑）
  prompt: string;        // 提示词（用户输入，用于AI生成内容）
  model: string;         // 文本生成模型
  isEditing?: boolean;
}

// 图像节点数据
export interface ImageNodeData extends BaseNodeFields, Record<string, unknown> {
  type: 'image';
  label: string;
  prompt: string;
  negativePrompt?: string;
  model: string;
  resolution?: string;  // 清晰度：'1K' | '2K' | '4K'
  aspectRatio?: string;  // 比例：'16:9' | '9:16' | '1:1' 等
  quality?: string;     // 画质：'低画质' | '标准画质' | '高画质'
  imageUrl?: string;
  thumbUrl?: string;     // 640px webp 缩略图（画布展示用；老数据为空时回退原图）
  width?: number;       // 实际图片宽度（从后端生成结果获取）
  height?: number;      // 实际图片高度（从后端生成结果获取）
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
  generateAudio?: boolean;      // 是否生成音频（默认 true）
}

// 音频节点数据
export interface AudioNodeData extends BaseNodeFields, Record<string, unknown> {
  type: 'audio';
  label: string;
  prompt: string;          // 提示词（文本生成音频时使用）
  text: string;            // 上游文本节点传入的文本内容
  voice: string;           // 音色/语音模型
  speed: number;           // 语速
  style?: string;          // 风格描述（写入 TTS instructions）
  tone?: string;           // 语气词（如"笑声"/"叹息"，写入 TTS instructions，不再插入提示词）
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
  model: string;          // 脚本生成模型
  scriptContent: string;  // 生成的剧本正文
  shots: ScriptShot[];    // 生成的分镜列表
  characters: ScriptCharacter[]; // 角色列表
  scenes: ScriptScene[];         // 场景列表
  props: ScriptProp[];           // 道具列表
  currentStep: 1 | 2 | 3;
  author?: string;
  createdAt?: string;
}

// 角色/场景/道具资产项（用于准备资产步骤上传参考图）
export interface ScriptAssetItem {
  name: string;
  description: string;
  /** ✅ 关联的节点 ID（可指向图片/视频等任何节点类型） */
  nodeId?: string;
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
  visual: string;
  /** 镜别：中景/特写/全景/近景等 */
  shotSize: string;
  /** 运镜方式（融合角度：如"俯视推镜头"、"仰视摇镜头"等） */
  cameraMovement: string;
  /** 对白/旁白 */
  dialogue: string;
  /** 音效描述 */
  soundEffect: string;
  /** 光影氛围（如"柔和自然光"、"强烈对比光"、"温暖夕阳光"等） */
  lightingAtmosphere: string;
  /** 基调/风格提示方式 */
  toneHint: string;
  /** 生成的参考图 URL */
  imageUrl?: string;
  /** 画面提示词（第三阶段生成，基于表格数据重新生成，含 @ 引用） */
  storyboardPrompt?: string;
  /** 首尾帧模式的画面提示词（第 1 项=起始画面，第 2 项=结束画面；与参考模式各存各的） */
  storyboardPrompts?: string[];
  /** 运动提示词（第三阶段生成，基于表格数据重新生成） */
  motionPrompt?: string;
  /** 首尾帧模式的运动提示词（与参考模式各存各的；要求与起始/结束画面锚定） */
  dualMotionPrompt?: string;
  /** 该镜头选用的模式（1=参考模式，2=首尾帧模式），决定上面哪一组提示词生效 */
  refImageCount?: number;
  /** 最终合成提示词（画面提示词 + 运动提示词） */
  finalPrompt?: string;
}

// 白模预演节点数据
export interface PrevizNodeData extends BaseNodeFields, Record<string, unknown> {
  type: 'previz';
  label: string;
  scene?: string;     // 白模场景 JSON 字符串（见 pages/previz/types.ts 的 PrevizScene）
  videoUrl?: string;  // 导出的白片视频 URL（P4 阶段使用）
  stillUrl?: string;  // 导出的白模静帧 PNG URL（作为图生图/图生视频的构图参考）
}

// 清晰化节点数据（P0 本地档：本机 ffmpeg 去块/降噪/锐化，可放大到 720p）
export interface EnhanceNodeData extends BaseNodeFields, Record<string, unknown> {
  type: 'enhance';
  label: string;
  /** 清晰化渠道 ID（ffmpeg=本机档；渠道与档位都由后端 enhance.yaml 定义，见 /enhance/providers） */
  provider?: string;
  /** 档位 ID（clean/hd；将来云端档是 sr/interp 等）。空 = 用该渠道的默认档 */
  mode?: string;
  /** 旧字段：P0 首版把档位叫 level，老画布上还留着它，读时作为 mode 的兜底 */
  level?: string;
  /** hd 档目标短边，默认 720 */
  targetShortSide?: number;
  /** 显式指定源视频节点（不填则取上游连线） */
  sourceNodeId?: string;
  /** 清晰化结果 */
  videoUrl?: string;
  /** 原片地址（用于「原片/增强后」对比） */
  sourceUrl?: string;
  /** 实际生效的档位（后端回写，用于「已清晰化」徽标；用户改档位但没跑时以这个为准） */
  enhanceLevel?: string;
  /** 处理耗时（毫秒，后端回写） */
  enhanceElapsedMs?: number;
  /** 实际干活的渠道（后端回写，如 ffmpeg）与其展示名 */
  enhanceProvider?: string;
  enhanceProviderLabel?: string;
  enhanceChannel?: string;
  enhanceChannelLabel?: string;
  /** 档位 ID 与展示名（后端回写） */
  enhanceRequestedMode?: string;
  enhanceModeLabel?: string;
  /** 一句话结果说明，如「本机 FFmpeg · 1282x720 · 3.6s」 */
  enhanceNote?: string;
  /** 源尺寸/目标尺寸，如 854x480 → 1282x720（后端回写） */
  enhanceSourceSize?: string;
  enhanceTargetSize?: string;
}

// 节点数据联合类型
export type LibTVNodeData =
  | TextNodeData
  | ImageNodeData
  | VideoNodeData
  | AudioNodeData
  | ScriptNodeData
  | PrevizNodeData
  | EnhanceNodeData;

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
  script: { label: '分镜', color: '#f59e0b', icon: 'CodeOutlined' },
  previz: { label: '白模预演', color: '#64748b', icon: 'DeploymentUnitOutlined' },
  enhance: { label: '清晰化', color: '#0ea5e9', icon: 'FormatPainterOutlined' },
};
