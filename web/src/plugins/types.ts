import type { NodeType, LibTVNodeData } from '@/types/canvas';

/**
 * 节点输出类型
 * - text   文本内容（content）
 * - image  图片 URL（imageUrl）
 * - video  视频 URL（videoUrl）
 * - audio  音频 URL（audioUrl）
 * - json   复杂结构（如分镜 shots）
 */
export type OutputKind = 'text' | 'image' | 'video' | 'audio' | 'json';

/**
 * 提示词面板配置（迁移自 configs/promptConfig.ts）
 * 后续 plugin 化后由每个 node plugin 提供自身配置
 */
export interface PromptPanelConfig {
  /** 允许的上游节点类型 */
  acceptedInputs: NodeType[];
  /** 默认模型 */
  defaultModel: string;
  /** 默认分辨率（无则填空） */
  defaultResolution: string;
  /** 默认画幅比例（'free' 表示自适应） */
  defaultAspectRatio: string;
  /** 可选模型列表 */
  availableModels: Array<{
    value: string;
    label: string;
    icon?: string;
    description?: string;
    duration?: number;
    tag?: string;
    tagColor?: string;
  }>;
  /** 工具栏要渲染哪些控件 */
  toolbarControls: string[];
  /** 占位文案 */
  placeholder: string;
  /** prompt 最大长度 */
  maxLength: number;
  /** 分辨率可选项（仅 image / video 实际用） */
  resolutions?: readonly string[];
  /** 画幅比例行（仅 image / video） */
  aspectRatioRows?: Array<Array<{ value: string; label: string }>>;
}

/**
 * 节点类型插件接口
 *
 * 一个 NodeTypePlugin 描述了"某类节点是什么"的所有知识：
 * - 显示配置（label / color / icon）
 * - 数据形状 / 默认值
 * - 连线约束（acceptsUpstream / produces）
 * - 提示词面板配置
 * - 自定义工具栏控件（customControls）
 * - 节点视图组件
 *
 * 前后端各维护一份 NodeTypePlugin（前端用于 UI，后端用于执行器），
 * 字段结构对齐，便于将来同步迁移（如 config-driven 节点）。
 */
export interface NodeTypePlugin {
  /** 节点类型 */
  type: NodeType;

  // === 显示 ===
  label: string;
  color: string;
  icon: string; // AntD icon 名

  // === 数据 ===
  defaultData: () => LibTVNodeData;

  // === 连线约束 ===
  /** 允许的上游节点类型 */
  acceptsUpstream: NodeType[];
  /** 本节点产出的数据类型 + 在 output map 中的 key */
  produces: { kind: OutputKind; fields: string[] };

  // === 提示词面板 ===
  promptConfig: PromptPanelConfig;
}
