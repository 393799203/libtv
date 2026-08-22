import type { NodeType, LibTVNodeData } from '@/types/canvas';
import type { NodeTypePlugin, OutputKind } from './types';
import {
  PROMPT_PANEL_CONFIGS,
  ASPECT_RATIO_ROWS,
  RESOLUTION_OPTIONS,
} from '@/configs/promptConfig';
import { createDefaultNodeData } from '@/utils/nodeFactory';
import { NODE_TYPE_CONFIG } from '@/types/canvas';

// 输出 kind 映射
const PRODUCES: Record<NodeType, { kind: OutputKind; fields: string[] }> = {
  text: { kind: 'text', fields: ['content'] },
  script: { kind: 'json', fields: ['shots', 'scriptContent'] },
  image: { kind: 'image', fields: ['imageUrl'] },
  video: { kind: 'video', fields: ['videoUrl'] },
  audio: { kind: 'audio', fields: ['audioUrl'] },
  previz: { kind: 'video', fields: ['videoUrl'] },  // 白模预演未来导出白片视频
};

// 为每个 NodeType 构造 plugin
function buildPlugin(type: NodeType): NodeTypePlugin {
  const config = NODE_TYPE_CONFIG[type];
  const prompt = PROMPT_PANEL_CONFIGS[type];

  return {
    type,
    label: config.label,
    color: config.color,
    icon: config.icon,
    defaultData: () => createDefaultNodeData(type) as LibTVNodeData,
    acceptsUpstream: prompt.acceptedInputs,
    produces: PRODUCES[type],
    promptConfig: {
      ...prompt,
      // 给 image / video 附上完整的分辨率/比例选项
      resolutions: ['image', 'video'].includes(type) ? RESOLUTION_OPTIONS : undefined,
      aspectRatioRows: ['image', 'video'].includes(type) ? ASPECT_RATIO_ROWS : undefined,
    },
  };
}

class NodeTypeRegistry {
  private plugins = new Map<NodeType, NodeTypePlugin>();

  constructor() {
    const types: NodeType[] = ['text', 'image', 'video', 'audio', 'script', 'previz'];
    types.forEach((t) => this.plugins.set(t, buildPlugin(t)));
  }

  get(type: NodeType): NodeTypePlugin {
    const p = this.plugins.get(type);
    if (!p) throw new Error(`[nodeRegistry] unknown node type: ${type}`);
    return p;
  }

  list(): NodeTypePlugin[] {
    return [...this.plugins.values()];
  }

  /** 校验两个节点之间是否可以连线（source 产出的 kind 是否被 target 接受） */
  validateConnection(source: NodeType, target: NodeType): boolean {
    return this.get(target).acceptsUpstream.includes(source);
  }
}

// 单例：组件中 import { nodeRegistry } from '@/plugins/registry'
export const nodeRegistry = new NodeTypeRegistry();

// 导出其他配置（保持兼容性）
export {
  ASPECT_RATIO_ROWS,
  RESOLUTION_OPTIONS,
};
