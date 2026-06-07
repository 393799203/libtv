import { TextNode } from './TextNode';
import { ImageNode } from './ImageNode';
import { VideoNode } from './VideoNode';
import { AudioNode } from './AudioNode';
import { ScriptNode } from './ScriptNode';

// 性能优化：nodeTypes 必须在组件外部定义，避免每次渲染重新创建
export const nodeTypes = {
  text: TextNode,
  image: ImageNode,
  video: VideoNode,
  audio: AudioNode,
  script: ScriptNode,
} as const;
