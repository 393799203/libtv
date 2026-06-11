import type { NodeType, LibTVNodeData, LibTVNode } from '@/types/canvas';
import type { XYPosition } from '@xyflow/react';

// 各类型节点的默认尺寸
const DEFAULT_STYLE: Record<NodeType, React.CSSProperties> = {
  text: { width: 280, height: 280 },
  image: { width: 280 },
  video: { width: 320, height: 180 },
  audio: { width: 280, height: 200 },
  script: { width: 280, height: 200 },
};

/**
 * 统一创建节点工厂 — 所有节点只走这一套逻辑
 * @param nodeType 节点类型
 * @param position 画布位置
 * @param overrides 可选覆盖（id / data / style）
 */
export function createNode(
  nodeType: NodeType,
  position: XYPosition,
  overrides?: {
    id?: string;
    data?: Partial<LibTVNodeData>;
    style?: React.CSSProperties;
  },
): LibTVNode {
  return {
    id: overrides?.id ?? `${nodeType}-${Date.now()}`,
    type: nodeType,
    position,
    data: {
      ...createDefaultNodeData(nodeType),
      ...overrides?.data,
    } as LibTVNodeData,
    style: {
      ...DEFAULT_STYLE[nodeType],
      ...overrides?.style,
    },
  };
}

// 创建节点默认数据
export function createDefaultNodeData(nodeType: NodeType): LibTVNodeData {
  const baseData = {
    status: 'idle' as const,
    error: undefined,
  };

  switch (nodeType) {
    case 'text':
      return {
        ...baseData,
        type: 'text',
        label: '文本节点',
        content: '',
      };
    case 'image':
      return {
        ...baseData,
        type: 'image',
        label: '图像节点',
        prompt: '',
        negativePrompt: '',
        model: 'stable-diffusion',
        width: 1024,
        height: 1024,
        imageUrl: undefined,
      };
    case 'video':
      return {
        ...baseData,
        type: 'video',
        label: '视频节点',
        prompt: '',
        model: 'kling',
        duration: 5,
        fps: 24,
        videoUrl: undefined,
      };
    case 'audio':
      return {
        ...baseData,
        type: 'audio',
        label: '音频节点',
        text: '',
        voice: 'default',
        speed: 1.0,
        audioUrl: undefined,
      };
    case 'script':
      return {
        ...baseData,
        type: 'script',
        label: '脚本节点',
        scriptContent: '',
        shots: [],
      };
  }
}
