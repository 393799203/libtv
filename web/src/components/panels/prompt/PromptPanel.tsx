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

  return incomingEdges
    .map((edge, index) => {
      const sourceNode = nodes.find((n) => n.id === edge.source);
      if (!sourceNode) return null;

      const d = sourceNode.data;

      switch (d.type) {
        case 'image':
          return {
            nodeId: sourceNode.id,
            nodeType: 'image',
            label: `图片${index + 1}`,
            thumbnail: d.imageUrl,
            previewUrl: d.imageUrl,
          };
        case 'video':
          return {
            nodeId: sourceNode.id,
            nodeType: 'video',
            label: `视频${index + 1}`,
            thumbnail: undefined,
            previewUrl: d.videoUrl,
          };
        case 'text':
          return {
            nodeId: sourceNode.id,
            nodeType: 'text',
            label: `文本${index + 1}`,
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
      });

      // 模拟延迟
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // 更新节点数据
      if (nodeType === 'image' || nodeType === 'video') {
        onUpdate({ prompt: promptText, model: selectedModel });
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
    : 'bg-white rounded-xl shadow-lg border border-gray-100 w-[520px] flex flex-col px-2 py-2';

  return (
    <div className={panelClass}>

      {/* 第一层：上游输入区 */}
      <PromptUpstreamBar
        inputs={upstreamInputs}
        onInsertMention={handleInsertMention}
        targetNodeId={nodeId}
      />

      {/* 第二层：提示词编辑区 */}
      <PromptEditor
        value={promptText}
        mentions={mentions}
        placeholder={config.placeholder}
        maxLength={config.maxLength}
        upstreamInputs={upstreamInputs}
        syncKey={nodeId}
        onChange={handlePromptChange}
      />

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
      />
    </div>
  );
});
