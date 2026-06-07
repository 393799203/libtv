import type { NodeType, LibTVNodeData } from '@/types/canvas';

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
