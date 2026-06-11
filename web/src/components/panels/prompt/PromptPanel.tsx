import { memo, useState, useCallback, useMemo } from 'react';
import { ArrowsAltOutlined, ShrinkOutlined } from '@ant-design/icons';
import { useCanvasStore } from '@/stores/canvasStore';
import { PROMPT_PANEL_CONFIGS } from '@/configs/promptConfig';
import type {
  UpstreamInput,
  MentionMarker,
  ResolutionOption,
} from '@/types/prompt';
import type { NodeType, LibTVNodeData, LibTVNode, LibTVEdge } from '@/types/canvas';
import { PromptUpstreamBar } from './PromptUpstreamBar';
import { PromptEditor } from './PromptEditor';
import { PromptToolbar } from './PromptToolbar';
import { VideoModeSelector } from './VideoPromptControls';
import type { VideoMode } from '@/types/canvas';

interface PromptPanelProps {
  nodeId: string;
  nodeType: NodeType;
  data: LibTVNodeData;
  onUpdate: (data: Partial<LibTVNodeData>) => void;
}

/**
 * 从画布数据中提取当前节点的上游输入
 */
function getUpstreamInputs(
  nodeId: string,
  nodes: LibTVNode[],
  edges: LibTVEdge[]
): UpstreamInput[] {
  const incomingEdges = edges.filter((e) => e.target === nodeId);

  // 按类型独立计数，确保"图片1"、"图片2"连续编号
  const typeCounters: Record<string, number> = {};

  return incomingEdges
    .map((edge) => {
      const sourceNode = nodes.find((n) => n.id === edge.source);
      if (!sourceNode) return null;

      // 过滤掉风格图片节点（ID 以"style-"开头）
      if (sourceNode.id.startsWith('style-')) return null;

      const d = sourceNode.data;
      // 当前类型的序号 +1
      typeCounters[d.type] = (typeCounters[d.type] || 0) + 1;
      const num = typeCounters[d.type];

      switch (d.type) {
        case 'image':
          return {
            nodeId: sourceNode.id,
            nodeType: 'image',
            label: `图片${num}`,
            thumbnail: d.imageUrl,
            previewUrl: d.imageUrl,
          };
        case 'video':
          return {
            nodeId: sourceNode.id,
            nodeType: 'video',
            label: `视频${num}`,
            thumbnail: undefined,
            previewUrl: d.videoUrl,
          };
        case 'text':
          return {
            nodeId: sourceNode.id,
            nodeType: 'text',
            label: d.label || `文本${num}`,
            textSnippet: d.content?.slice(0, 500),
          };
        case 'script':
          return {
            nodeId: sourceNode.id,
            nodeType: 'script',
            label: '脚本',
            textSnippet: d.scriptContent?.slice(0, 500),
          };
        default:
          return null;
      }
    })
    .filter(Boolean) as UpstreamInput[];
}

export const PromptPanel = memo<PromptPanelProps>(function PromptPanel({
  nodeId,
  nodeType,
  data,
  onUpdate,
}) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  // 从全局 store 获取节点和边，用于计算上游输入
  // 注意：zustand 默认用 Object.is 比较，选择器内不能返回新对象/数组
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);

  // 当前节点类型的配置
  const config = PROMPT_PANEL_CONFIGS[nodeType];

  // 上游输入列表（useMemo 稳定引用，避免子组件无效重渲染）
  const upstreamInputs = useMemo(
    () => getUpstreamInputs(nodeId, nodes, edges),
    [nodeId, nodes, edges]
  );

  // 本地状态：提示词文本、@引用、模型、分辨率、比例
  // 从节点数据中读取初始值（只取 prompt 字段，不 fallback 到 content）
  const [promptText, setPromptText] = useState(
    ('prompt' in data ? (data as { prompt?: string }).prompt : '') || ''
  );
  const [mentions, setMentions] = useState<MentionMarker[]>([]);
  const [selectedModel, setSelectedModel] = useState(config.defaultModel);
  const [selectedResolution, setSelectedResolution] = useState<ResolutionOption>(config.defaultResolution);
  const [selectedAspectRatio, setSelectedAspectRatio] = useState<string>(config.defaultAspectRatio);
  const [isGenerating, setIsGenerating] = useState(false);

  // 图片节点专属：摄像机/全景模式
  const [cameraMode, setCameraMode] = useState<'normal' | 'camera' | 'panorama'>('normal');

  // 视频节点专属：生成模式（根据上游图片数量自动过滤可选模式）
  const [videoMode, setVideoMode] = useState<VideoMode>(
    nodeType === 'video' ? ((data as { videoMode?: VideoMode }).videoMode || 'text-to-video') : 'text-to-video'
  );
  // 上游已连接的图片节点数量（用于控制模式可用性）
  const upstreamImageCount = useMemo(
    () => upstreamInputs.filter((i) => i.nodeType === 'image').length,
    [upstreamInputs]
  );

  // 提示词文本变化
  const handlePromptChange = useCallback(
    (value: string, newMentions: MentionMarker[]) => {
      setPromptText(value);
      setMentions(newMentions);
    },
    []
  );

  // 从上游栏点击插入 @ 引用
  const handleInsertMention = useCallback(
    (input: UpstreamInput) => {
      const newMention: MentionMarker = {
        id: `${Date.now()}`,
        nodeId: input.nodeId,
        label: input.label,
        nodeType: input.nodeType,
      };
      setPromptText((prev) => prev + ` @${input.label} `);
      setMentions((prev) => [...prev, newMention]);
    },
    []
  );

  // 发送生成
  const handleGenerate = useCallback(async () => {
    setIsGenerating(true);
    try {
      // TODO: 调用后端 API 执行生成
      // 将 promptText、mentions（引用的节点ID）、model、resolution、aspectRatio 一并提交
      console.log('Generate:', {
        nodeId,
        nodeType,
        prompt: promptText,
        mentions,
        model: selectedModel,
        resolution: selectedResolution,
        aspectRatio: selectedAspectRatio,
        ...(nodeType === 'video' && {
          videoMode,
        }),
      });

      // 模拟延迟
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // 更新节点数据
      if (nodeType === 'image') {
        onUpdate({ prompt: promptText, model: selectedModel });
      } else if (nodeType === 'video') {
        onUpdate({ prompt: promptText, model: selectedModel, videoMode });
      } else if (nodeType === 'text') {
        onUpdate({ content: promptText });
      }
    } finally {
      setIsGenerating(false);
    }
  }, [
    nodeId,
    nodeType,
    promptText,
    mentions,
    selectedModel,
    selectedResolution,
    selectedAspectRatio,
    onUpdate,
  ]);

  const panelClass = isFullscreen
    ? 'fixed inset-4 z-50 bg-white rounded-2xl shadow-2xl flex flex-col p-5'
    : 'bg-white rounded-xl shadow-lg border border-gray-100 w-[580px] flex flex-col px-2 py-2';

  return (
    <div className={panelClass}>

      {/* 视频节点：模式选择器（根据上游图片数量自动过滤可选模式） */}
      {nodeType === 'video' && (
        <VideoModeSelector value={videoMode} onChange={setVideoMode} imageCount={upstreamImageCount} />
      )}

      {/* 第一层：上游输入区 */}
      <PromptUpstreamBar
        inputs={upstreamInputs}
        onInsertMention={handleInsertMention}
        targetNodeId={nodeId}
        showStyleSelector={nodeType === 'image' || nodeType === 'video'}
      />

      {/* 第二层：提示词编辑区 */}
      <div className="flex-1 min-w-0 px-2">
        <PromptEditor
          value={promptText}
          mentions={mentions}
          placeholder={config.placeholder}
          maxLength={config.maxLength}
          upstreamInputs={upstreamInputs}
          syncKey={nodeId}
          onChange={handlePromptChange}
          prefixTag={cameraMode === 'panorama' ? { label: '720全景', icon: '720' } : undefined}
        />
      </div>

      {/* 第三层：底部工具栏 */}
      <PromptToolbar
        models={config.availableModels}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        selectedResolution={selectedResolution}
        onResolutionChange={setSelectedResolution}
        selectedAspectRatio={selectedAspectRatio}
        onAspectRatioChange={setSelectedAspectRatio}
        isGenerating={isGenerating}
        onGenerate={handleGenerate}
        nodeType={nodeType}
        cameraMode={cameraMode}
        onCameraModeChange={setCameraMode}
      />
    </div>
  );
});
