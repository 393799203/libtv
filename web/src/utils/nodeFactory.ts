import type { NodeType, LibTVNodeData, LibTVNode } from '@/types/canvas';
import type { XYPosition } from '@xyflow/react';

// 各类型节点的默认尺寸
const DEFAULT_STYLE: Record<NodeType, React.CSSProperties> = {
  text: { width: 320, height: 300, minWidth: 320, minHeight: 200 },
  image: { width: 320, minHeight: 190 },
  video: { width: 480 },
  audio: { width: 320 },
  script: { width: 320 },
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
        label: '剧本',
        content: '',
        prompt: '',
        model: '',
      };
    case 'image':
      return {
        ...baseData,
        type: 'image',
        label: '图片',
        prompt: '',
        negativePrompt: '',
        model: '',
        resolution: '1K',
        aspectRatio: '16:9',
        quality: '标准画质',
        // width和height不设置默认值，让系统从resolution和aspectRatio计算
        imageUrl: undefined,
      };
    case 'video':
      return {
        ...baseData,
        type: 'video',
        label: '视频',
        prompt: '',
        model: '',
        duration: 5,
        fps: 24,
        resolution: '720p',
        aspectRatio: '16:9',
        videoUrl: undefined,
        generateAudio: true,  // 默认开启声音生成
      };
    case 'audio':
      return {
        ...baseData,
        type: 'audio',
        label: '音频',
        prompt: '',
        text: '',
        voice: 'Cherry',
        speed: 1.0,
        model: '',
        duration: 0,
        audioUrl: undefined,
      };
    case 'script':
      return {
        ...baseData,
        type: 'script',
        label: '分镜脚本',
        prompt: '',
        model: '',
        scriptContent: '',
        shots: [],
        characters: [],
        scenes: [],
        props: [],
        currentStep: 1,
        author: undefined,
        createdAt: new Date().toISOString(),
      };
  }
}
