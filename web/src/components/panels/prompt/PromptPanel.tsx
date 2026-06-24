import { memo, useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { useExecutionStore } from '@/stores/executionStore';
import { useNodeGeneration } from '@/hooks/useNodeGeneration';
import { nodeRegistry } from '@/plugins/registry';
import type {
  UpstreamInput,
  MentionMarker,
  ResolutionOption,
} from '@/types/prompt';
import type { NodeType, LibTVNodeData, LibTVNode, LibTVEdge } from '@/types/canvas';
import { PromptUpstreamBar } from './PromptUpstreamBar';
import { PromptEditor, type PromptEditorHandle } from './PromptEditor';
import { PromptToolbar } from './PromptToolbar';
import { DownstreamConfirmBar } from './DownstreamConfirmBar';
import { VideoModeSelector } from './VideoPromptControls';
import { AudioPromptControls, type AudioTagInsert } from './AudioPromptControls';
import type { VideoMode } from '@/types/canvas';
import type { AudioNodeData } from '@/types/canvas';

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
        case 'audio':
          return {
            nodeId: sourceNode.id,
            nodeType: 'audio',
            label: d.label || `音频${num}`,
            previewUrl: d.audioUrl,
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
  const [isFullscreen] = useState(false);

  // 编辑器 ref，用于插入停顿/语气词
  const editorRef = useRef<PromptEditorHandle>(null);

  // 从全局 store 获取节点和边，用于计算上游输入
  // 注意：zustand 默认用 Object.is 比较，选择器内不能返回新对象/数组
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const projectId = useCanvasStore((s) => s.projectId);

  // 节点生成 hook — 统一入口（处理单点生成 + 下游 stale 标记 + SSE 订阅）
  const {
    downstreamIds,
    isGenerating: hookIsGenerating,
    error: hookError,
    generate,
    regenerateDownstream,
  } = useNodeGeneration({ nodeId });

  // 从 plugin registry 读配置（统一来源，后续加节点类型无需改 PromptPanel）
  const config = nodeRegistry.get(nodeType).promptConfig;

  // 上游输入列表（useMemo 稳定引用，避免子组件无效重渲染）
  const upstreamInputs = useMemo(
    () => getUpstreamInputs(nodeId, nodes, edges),
    [nodeId, nodes, edges]
  );

  // 从节点 data 恢复 prompt + mentions（只取 prompt 字段，不 fallback 到 content）
  // mentions 是 @ 引用的元数据列表，存到 data.mentions 里，与 prompt 中的 [[m:ID]] 占位符一一对应
  const initialPrompt = ('prompt' in data ? (data as { prompt?: string }).prompt : '') || '';
  const initialMentions = ('mentions' in data && Array.isArray((data as { mentions?: unknown }).mentions)
    ? ((data as { mentions: MentionMarker[] }).mentions || [])
    : []);
  const [promptText, setPromptText] = useState(initialPrompt);
  const [mentions, setMentions] = useState<MentionMarker[]>(initialMentions);

  // 切换节点时重置本地状态为新节点的数据（useState 只初始化一次，不会随 nodeId 变化重新执行）
  useEffect(() => {
    const newPrompt = ('prompt' in data ? (data as { prompt?: string }).prompt : '') || '';
    const newMentions = ('mentions' in data && Array.isArray((data as { mentions?: unknown }).mentions)
      ? ((data as { mentions: MentionMarker[] }).mentions || [])
      : []);
    setPromptText(newPrompt);
    setMentions(newMentions);
  }, [nodeId]);
  const [selectedModel, setSelectedModel] = useState(config.defaultModel);
  const [selectedResolution, setSelectedResolution] = useState<ResolutionOption>((config.defaultResolution as ResolutionOption) || '1K');
  const [selectedAspectRatio, setSelectedAspectRatio] = useState<string>(config.defaultAspectRatio);
  const [isGenerating, setIsGenerating] = useState(false);
  // 下游确认条：执行完后弹出
  const [showDownstreamConfirm, setShowDownstreamConfirm] = useState(false);

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

  // 音频节点专属：音色和语速
  const [selectedVoice, setSelectedVoice] = useState(
    nodeType === 'audio' ? ((data as AudioNodeData).voice || 'default') : 'default'
  );
  const [selectedSpeed, setSelectedSpeed] = useState(
    nodeType === 'audio' ? ((data as AudioNodeData).speed || 1.0) : 1.0
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

  // 发送生成 — 通过 useNodeGeneration 统一入口
  const handleGenerate = useCallback(async () => {
    if (!projectId) {
      console.error('projectId 不存在，无法执行工作流');
      return;
    }

    // 1) 同步本地状态到节点 data（通过 onUpdate 传出来）
    //    mentions 跟 prompt 一起持久化，避免 reload 后 [[m:ID]] 找不到对应元数据
    if (nodeType === 'text' || nodeType === 'image' || nodeType === 'video' || nodeType === 'audio' || nodeType === 'script') {
      onUpdate({
        prompt: promptText,
        mentions,
        model: selectedModel,
      } as Partial<LibTVNodeData>);
    }

    setIsGenerating(true);

    // 2) 调统一入口（自动：写下游 stale → 存盘 → 调后端 → 订阅 SSE）
    await generate({ mode: 'single' });
    // isGenerating 由下面 useEffect 在终态时清掉
  }, [projectId, nodeId, nodeType, promptText, mentions, selectedModel, onUpdate, generate]);

  // 监听执行状态：终态时关掉 loading + 弹下游确认条
  const executionStatus = useExecutionStore((s) => s.status);
  const lastError = useExecutionStore((s) => s.lastError);
  useEffect(() => {
    if (executionStatus === 'completed' || executionStatus === 'failed') {
      setIsGenerating(false);
      useExecutionStore.getState().setGeneratingNodeId(null);
      // 仅当有下游且执行成功时弹确认条
      if (executionStatus === 'completed' && downstreamIds.length > 0) {
        setShowDownstreamConfirm(true);
      }
    }
  }, [executionStatus, downstreamIds.length]);

  // 点击"重新生成下游"
  const handleRegenerateDownstream = useCallback(() => {
    setShowDownstreamConfirm(false);
    regenerateDownstream();
  }, [regenerateDownstream]);

  // 关闭下游确认条
  const handleDismissConfirm = useCallback(() => {
    setShowDownstreamConfirm(false);
  }, []);

  const panelClass = isFullscreen
    ? 'fixed inset-4 z-50 bg-white rounded-2xl shadow-2xl flex flex-col p-5'
    : 'bg-white rounded-xl shadow-lg border border-gray-100 w-[580px] flex flex-col px-2 py-2';

  return (
    <div className={panelClass}>

      {/* 错误提示条（lastError 有值时显示） */}
      {lastError && (
        <div className="mb-2 px-3 py-2 rounded-md bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 mt-1.5 flex-shrink-0" />
          <span className="flex-1 break-all">{lastError}</span>
          <button
            onClick={() => useExecutionStore.getState().setLastError(null)}
            className="text-red-500 hover:text-red-700 flex-shrink-0"
            title="关闭"
          >
            ✕
          </button>
        </div>
      )}

      {/* 下游确认条：执行完当前节点后，提示下游可能被影响 */}
      {showDownstreamConfirm && downstreamIds.length > 0 && (
        <DownstreamConfirmBar
          count={downstreamIds.length}
          onRegenerate={handleRegenerateDownstream}
          onDismiss={handleDismissConfirm}
        />
      )}

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
          ref={editorRef}
        />
      </div>

      {/* 音频节点：停顿 + 语气词控件 */}
      {nodeType === 'audio' && (
        <AudioPromptControls onInsertTag={(tag: AudioTagInsert) => editorRef.current?.insertTagAtCursor(tag.html, tag.text)} />
      )}

      {/* 第三层：底部工具栏 */}
      <PromptToolbar
        models={config.availableModels}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        selectedResolution={selectedResolution}
        onResolutionChange={setSelectedResolution}
        selectedAspectRatio={selectedAspectRatio}
        onAspectRatioChange={setSelectedAspectRatio}
        isGenerating={isGenerating || hookIsGenerating}
        onGenerate={handleGenerate}
        nodeType={nodeType}
        cameraMode={cameraMode}
        onCameraModeChange={setCameraMode}
        selectedVoice={selectedVoice}
        onVoiceChange={setSelectedVoice}
        selectedSpeed={selectedSpeed}
        onSpeedChange={setSelectedSpeed}
      />
    </div>
  );
});
