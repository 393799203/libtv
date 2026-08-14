import { memo, useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { useNodeGeneration } from '@/hooks/useNodeGeneration';
import { useModels } from '@/hooks/useModels';
import { nodeRegistry } from '@/plugins/registry';
import { VIDEO_RESOLUTION_OPTIONS } from '@/configs/promptConfig';
import type {
  UpstreamInput,
  MentionMarker,
  ResolutionOption,
} from '@/types/prompt';
import type { NodeType, LibTVNodeData, LibTVNode, LibTVEdge } from '@/types/canvas';
import { PromptUpstreamBar } from './PromptUpstreamBar';
import { PromptEditor, type PromptEditorHandle } from './PromptEditor';
import { PromptToolbar } from './PromptToolbar';
import { VideoModeSelector } from './VideoPromptControls';
import type { VideoMode, ScriptNodeData, ScriptShot } from '@/types/canvas';
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
            // ✅ 优先使用真实名字（如"角色-南方"、"场景-办公室"），没有名字才使用编号
            label: d.label || `图片${num}`,
            thumbnail: d.imageUrl,
            previewUrl: d.imageUrl,
          };
        case 'video':
          return {
            nodeId: sourceNode.id,
            nodeType: 'video',
            label: d.label || `视频${num}`,
            thumbnail: undefined,
            previewUrl: d.videoUrl,
          };
        case 'text':
          return {
            nodeId: sourceNode.id,
            nodeType: 'text',
            label: d.label || `文本${num}`,
            textSnippet: d.content && d.content.length > 500 ? d.content.slice(0, 500) + '…' : d.content?.slice(0, 500),
          };
        case 'script':
          return {
            nodeId: sourceNode.id,
            nodeType: 'script',
            label: '脚本',
            textSnippet: d.scriptContent && d.scriptContent.length > 500 ? d.scriptContent.slice(0, 500) + '…' : d.scriptContent?.slice(0, 500),
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

  // 编辑器 ref，用于快捷导入/提取最新文本
  const editorRef = useRef<PromptEditorHandle>(null);

  // 从全局 store 获取节点和边，用于计算上游输入
  // 注意：zustand 默认用 Object.is 比较，选择器内不能返回新对象/数组
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const projectId = useCanvasStore((s) => s.projectId);

  // 节点生成 hook — 统一入口（处理单点生成 + SSE 订阅）
  const {
    isGenerating: hookIsGenerating,
    error: hookError,
    generate,
    clearError,
  } = useNodeGeneration({ nodeId });

  // 从 plugin registry 读配置（统一来源，后续加节点类型无需改 PromptPanel）
  const config = nodeRegistry.get(nodeType).promptConfig;

  // 从后端 API 动态获取模型列表
  const availableModels = useModels(nodeType);

  // 上游输入列表（useMemo 稳定引用，避免子组件无效重渲染）
  const upstreamInputs = useMemo(
    () => getUpstreamInputs(nodeId, nodes, edges),
    [nodeId, nodes, edges]
  );

  // 手动创建的视频节点：从上游图片节点反查关联分镜的最终提示词
  const importablePrompts = useMemo(() => {
    if (nodeType !== 'video' || nodeId.startsWith('shot-video-')) return [];
    const result: { label: string; prompt: string; duration?: number }[] = [];
    for (const input of upstreamInputs) {
      if (input.nodeType !== 'image') continue;
      // 分镜图片节点 ID 格式: shot-image-{shotId}-{scriptNodeId}
      const match = input.nodeId.match(/^shot-image-(.+)-(script-.+)$/);
      if (!match) continue;
      const [, shotId, scriptNodeId] = match;
      const scriptNode = nodes.find((n) => n.id === scriptNodeId);
      if (!scriptNode || scriptNode.type !== 'script') continue;
      const scriptData = scriptNode.data as ScriptNodeData;
      const shot = (scriptData.shots || []).find((s: ScriptShot) => s.id === shotId);
      if (shot?.finalPrompt) {
        // 有上游图片参考时，只需要运动提示词（画面由参考图提供）
        const prompt = shot.motionPrompt?.trim()
          ? `视频运动提示词：${shot.motionPrompt.trim()}`
          : shot.finalPrompt;
        result.push({ label: `分镜${shot.shotNumber}提示词`, prompt, duration: shot.duration });
      }
    }
    return result;
  }, [nodeType, nodeId, upstreamInputs, nodes]);

  // 导入提示词（填充后隐藏按钮）
  const [promptImported, setPromptImported] = useState(false);
  const handleImportPrompt = useCallback((prompt: string, duration?: number) => {
    // 去掉分镜提示词中的 (@类型-名称) 标签
    const cleanPrompt = prompt.replace(/[（(]@[^\）)]+[）)]/g, '').trim();
    setPromptText(cleanPrompt);
    setMentions([]);
    editorRef.current?.setValue(cleanPrompt);
    setPromptImported(true);
    // 立即保存到节点 data，确保生成时能读到 prompt
    const updateData: Partial<LibTVNodeData> = { prompt: cleanPrompt, mentions: [] };
    if (duration && duration > 0) {
      const clampedDuration = Math.min(Math.max(duration, 4), 15);
      setSelectedDuration(clampedDuration);
      (updateData as Record<string, unknown>).duration = clampedDuration;
    }
    onUpdate(updateData);
  }, [onUpdate]);

  // 从节点 data 恢复 prompt + mentions（只取 prompt 字段，不 fallback 到 content）
  // mentions 是 @ 引用的元数据列表，存到 data.mentions 里，与 prompt 中的 [[m:ID]] 占位符一一对应
  const initialPrompt = ('prompt' in data ? (data as { prompt?: string }).prompt : '') || '';
  const initialMentions = ('mentions' in data && Array.isArray((data as { mentions?: unknown }).mentions)
    ? ((data as { mentions: MentionMarker[] }).mentions || [])
    : []);
  const [promptText, setPromptText] = useState(initialPrompt);
  const [mentions, setMentions] = useState<MentionMarker[]>(initialMentions);

  // 模型选择状态（使用动态模型列表）
  // 初始化时：如果节点data中有model（modelId），根据modelId找到对应的模型value
  // 否则使用配置的默认模型
  const initialModel = ('model' in data && (data as { model?: string }).model)
    ? (() => {
        const savedModelId = (data as { model: string }).model;
        // 根据保存的modelId找到对应的模型配置
        const matchedModel = availableModels.find(m => m.modelId === savedModelId);
        return matchedModel?.value || config.defaultModel;
      })()
    : config.defaultModel;
  const [selectedModel, setSelectedModel] = useState(initialModel);

  // 切换节点时重置本地状态为新节点的数据（useState 只初始化一次，不会随 nodeId 变化重新执行）
  useEffect(() => {
    const newPrompt = ('prompt' in data ? (data as { prompt?: string }).prompt : '') || '';
    const newMentions = ('mentions' in data && Array.isArray((data as { mentions?: unknown }).mentions)
      ? ((data as { mentions: MentionMarker[] }).mentions || [])
      : []);

    // ✅ 只在值真正变化时才更新状态，避免无限循环
    setPromptText(prev => prev !== newPrompt ? newPrompt : prev);
    setMentions(prev => {
      // 简单比较：长度和第一个元素
      if (prev.length !== newMentions.length) return newMentions;
      if (prev.length > 0 && prev[0].nodeId !== newMentions[0]?.nodeId) return newMentions;
      return prev;
    });

    // 恢复节点数据中的模型选择：根据保存的modelId找到对应的value
    if ('model' in data && (data as { model?: string }).model) {
      const savedModelId = (data as { model: string }).model;
      const matchedModel = availableModels.find(m => m.modelId === savedModelId);
      if (matchedModel) {
        setSelectedModel(prev => prev !== matchedModel.value ? matchedModel.value : prev);
      }
    } else {
      // 新节点没有保存的 model，使用配置的默认模型（避免保留上个节点的选择）
      setSelectedModel(prev => prev !== config.defaultModel ? config.defaultModel : prev);
    }

    // 图片节点：恢复节点数据中的分辨率、比例、画质
    if (nodeType === 'image') {
      if ('resolution' in data && (data as any).resolution) {
        setSelectedResolution(prev => prev !== (data as any).resolution ? (data as any).resolution : prev);
      }
      if ('aspectRatio' in data && (data as any).aspectRatio) {
        setSelectedAspectRatio(prev => prev !== (data as any).aspectRatio ? (data as any).aspectRatio : prev);
      }
      if ('quality' in data && (data as any).quality) {
        setSelectedQuality(prev => prev !== (data as any).quality ? (data as any).quality : prev);
      }
    }

    // 视频节点：恢复节点数据中的时长（4-15秒规范化）
    if (nodeType === 'video') {
      const d = (data as { duration?: number }).duration;
      if (d && d > 0) {
        const normalized = d < 4 ? 4 : d > 15 ? 15 : d;
        setSelectedDuration(prev => prev !== normalized ? normalized : prev);
      }
      // 恢复声音开关（未设置时默认开启）
      const ga = (data as { generateAudio?: boolean }).generateAudio;
      const gaVal = ga !== false;
      setGenerateAudio(prev => prev !== gaVal ? gaVal : prev);
    }

    // 音频节点：恢复节点数据中的音色、语速、风格、语气词
    if (nodeType === 'audio') {
      const v = (data as AudioNodeData).voice;
      if (v) setSelectedVoice(prev => prev !== v ? v : prev);
      const s = (data as AudioNodeData).speed;
      if (s) setSelectedSpeed(prev => prev !== s ? s : prev);
      const st = ((data as any).style as string) || '';
      setSelectedStyle(prev => prev !== st ? st : prev);
      const tn = ((data as any).tone as string) || '';
      setSelectedTone(prev => prev !== tn ? tn : prev);
    }
  }, [nodeId, data, nodeType, availableModels]);

  // 当模型列表加载完成时，自动选择默认模型或合适的模型
  // 只在初始化时或当前模型不在可用列表中时才重置，避免强制重置用户的选择
  useEffect(() => {
    if (availableModels.length > 0) {
      // 检查当前选中的模型是否在可用列表中
      const currentModelAvailable = availableModels.find(m => m.value === selectedModel);

      // 如果当前模型不在可用列表中，才重置到默认模型
      if (!currentModelAvailable) {
        const defaultModel = availableModels.find(m => m.isDefault === true);
        setSelectedModel(defaultModel ? defaultModel.value : availableModels[0].value);
      }
    }
  }, [availableModels, nodeType]); // 移除 selectedModel 依赖，避免每次切换都重置

  // 图片节点专属参数：优先从节点data中读取，否则使用配置默认值
  const initialResolution = ('resolution' in data && (data as any).resolution)
    ? (data as any).resolution as ResolutionOption
    : (config.defaultResolution as ResolutionOption) || '1K';
  const initialAspectRatio = ('aspectRatio' in data && (data as any).aspectRatio)
    ? (data as any).aspectRatio
    : config.defaultAspectRatio;
  const initialQuality = ('quality' in data && (data as any).quality)
    ? (data as any).quality
    : '标准画质';

  const [selectedResolution, setSelectedResolution] = useState<ResolutionOption>(initialResolution);
  const [selectedAspectRatio, setSelectedAspectRatio] = useState<string>(initialAspectRatio);
  const [selectedQuality, setSelectedQuality] = useState<string>(initialQuality);

  // 视频节点：模型切换后，若当前分辨率不在新模型支持的列表中，自动切换到第一个可用项
  // 避免向后端发送模型不支持的分辨率
  useEffect(() => {
    if (nodeType !== 'video') return;
    const currentModel = availableModels.find((m) => m.value === selectedModel);
    const supported = currentModel?.resolutions;
    const opts = supported && supported.length > 0 ? supported : [...VIDEO_RESOLUTION_OPTIONS];
    if (!opts.includes(selectedResolution)) {
      setSelectedResolution(opts[0] as ResolutionOption);
    }
  }, [nodeType, selectedModel, availableModels, selectedResolution]);

  // 视频节点专属：生成模式（根据上游图片数量自动过滤可选模式）
  const [videoMode, setVideoMode] = useState<VideoMode>(
    nodeType === 'video' ? ((data as { videoMode?: VideoMode }).videoMode || 'text-to-video') : 'text-to-video'
  );
  // 视频节点专属：时长（4-15秒，从节点data读取，默认5秒）
  const [selectedDuration, setSelectedDuration] = useState<number>(
    nodeType === 'video'
      ? (() => {
          const d = (data as { duration?: number }).duration;
          if (!d || d <= 0) return 5;
          if (d < 4) return 4;
          if (d > 15) return 15;
          return d;
        })()
      : 5
  );
  // 视频节点专属：是否生成音频（默认开启）
  const [generateAudio, setGenerateAudio] = useState<boolean>(
    nodeType === 'video'
      ? ((data as { generateAudio?: boolean }).generateAudio !== false)
      : true
  );
  // 上游已连接的图片节点数量（用于控制模式可用性）
  const upstreamImageCount = useMemo(
    () => upstreamInputs.filter((i) => i.nodeType === 'image').length,
    [upstreamInputs]
  );
  // 上游已连接的视频节点数量（用于控制模式可用性）
  const upstreamVideoCount = useMemo(
    () => upstreamInputs.filter((i) => i.nodeType === 'video').length,
    [upstreamInputs]
  );

  // 音频节点专属：音色、语速、风格
  const [selectedVoice, setSelectedVoice] = useState(
    nodeType === 'audio' ? ((data as AudioNodeData).voice || 'default') : 'default'
  );
  const [selectedSpeed, setSelectedSpeed] = useState(
    nodeType === 'audio' ? ((data as AudioNodeData).speed || 1.0) : 1.0
  );
  const [selectedStyle, setSelectedStyle] = useState(
    nodeType === 'audio' ? (((data as any).style as string) || '') : ''
  );
  // 音频节点专属：语气词（不再插入提示词，而是独立写入 TTS instructions）
  const [selectedTone, setSelectedTone] = useState(
    nodeType === 'audio' ? (((data as any).tone as string) || '') : ''
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

  // 移除 @ 引用（用于风格图删除/切换时自动清理）
  const handleRemoveMention = useCallback(
    (nodeId: string) => {
      const removed = mentions.find(m => m.nodeId === nodeId);
      if (!removed) return;
      // 从 mentions 数组中移除
      setMentions(prev => prev.filter(m => m.nodeId !== nodeId));
      // 从 promptText 中移除对应的标记（兼容 [[m:id]] 和 @label 两种格式）
      setPromptText(prev => {
        let result = prev;
        const escapedId = removed.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        result = result.replace(new RegExp(`\\[\\[m:${escapedId}\\]\\]`, 'g'), '');
        const escapedLabel = removed.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        result = result.replace(new RegExp(`\\s*@${escapedLabel}\\s*`, 'g'), ' ');
        return result.replace(/\s{2,}/g, ' ').trim();
      });
    },
    [mentions]
  );

  // 暂存：只保存到 zustand store 内存状态，不持久化到后端
  // 下次点击节点能取到最新内容，刷新页面回到之前后端持久化的状态
  const [savedFlash, setSavedFlash] = useState(false);
  const handleSaveDraft = useCallback(() => {
    const currentModel = availableModels.find(m => m.value === selectedModel);
    const modelIdToSave = currentModel?.modelId || selectedModel;
    // 直接从编辑器 DOM 提取最新文本，避免防抖延迟导致 promptText 为旧值
    const latestPrompt = editorRef.current?.getValue() ?? promptText;
    const updateData: Partial<LibTVNodeData> = {
      prompt: latestPrompt,
      mentions,
      model: modelIdToSave,
    };
    if (nodeType === 'image' || nodeType === 'video') {
      (updateData as any).resolution = selectedResolution;
      (updateData as any).aspectRatio = selectedAspectRatio;
    }
    if (nodeType === 'image') {
      (updateData as any).quality = selectedQuality;
    }
    if (nodeType === 'video') {
      (updateData as any).videoMode = videoMode;
      (updateData as any).duration = selectedDuration;
      (updateData as any).generateAudio = generateAudio;
    }
    onUpdate(updateData);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  }, [availableModels, selectedModel, promptText, mentions, nodeType, selectedResolution, selectedAspectRatio, selectedQuality, videoMode, selectedDuration, generateAudio, onUpdate]);

  // 发送生成 — 通过 useNodeGeneration 统一入口
  const handleGenerate = useCallback(async (count?: number) => {
    console.log('[PromptPanel] handleGenerate count=', count);
    if (!projectId) {
      console.error('projectId 不存在，无法执行工作流');
      return;
    }

    // 1) 同步本地状态到节点 data（通过 onUpdate 传出来）
    //    mentions 跟 prompt 一起持久化，避免 reload 后 [[m:ID]] 找不到对应元数据
    if (nodeType === 'text' || nodeType === 'image' || nodeType === 'video' || nodeType === 'audio' || nodeType === 'script') {
      // 找到当前选中的模型配置，获取实际的modelId
      const currentModel = availableModels.find(m => m.value === selectedModel);
      const modelIdToSave = currentModel?.modelId || selectedModel;  // ✅ 保存modelId而不是ID

      const updateData: Partial<LibTVNodeData> = {
        prompt: editorRef.current?.getValue() ?? promptText,  // 直接从编辑器提取，避免防抖延迟
        mentions,
        model: modelIdToSave,  // ✅ 保存实际的model_id
      };

      // 图片/视频节点同步分辨率、比例字段；画质仅图片节点
      if (nodeType === 'image' || nodeType === 'video') {
        (updateData as any).resolution = selectedResolution;
        (updateData as any).aspectRatio = selectedAspectRatio;
      }
      if (nodeType === 'image') {
        (updateData as any).quality = selectedQuality;
        (updateData as any).count = count; // 生成数量
      }
      if (nodeType === 'video') {
        (updateData as any).videoMode = videoMode;
        (updateData as any).duration = selectedDuration;  // 视频时长（4-15秒）
        (updateData as any).generateAudio = generateAudio;  // 是否生成音频
      }
      if (nodeType === 'audio') {
        (updateData as any).voice = selectedVoice;  // ✅ 同步音色
        (updateData as any).speed = selectedSpeed;   // ✅ 同步语速
        (updateData as any).style = selectedStyle;   // ✅ 同步风格
        (updateData as any).tone = selectedTone;    // ✅ 同步语气词
      }

      onUpdate(updateData);
    }

    // 2) 调统一入口（自动：存盘 → 调后端 → 订阅 SSE）
    await generate({ mode: 'single' });
  }, [projectId, nodeId, nodeType, promptText, mentions, selectedModel, availableModels, selectedResolution, selectedAspectRatio, selectedQuality, selectedDuration, generateAudio, selectedVoice, selectedSpeed, selectedStyle, selectedTone, onUpdate, generate]);

  // 视频节点：时长调整后实时同步到节点 data（避免刷新丢失）
  const handleDurationChange = useCallback((duration: number) => {
    setSelectedDuration(duration);
    if (nodeType === 'video') {
      onUpdate({ duration } as Partial<LibTVNodeData>);
    }
  }, [nodeType, onUpdate]);

  // 图片/视频节点：长宽比切换后实时同步到节点 data（节点高度需根据比例动态变化）
  const handleAspectRatioChange = useCallback((ratio: string) => {
    setSelectedAspectRatio(ratio);
    if (nodeType === 'image' || nodeType === 'video') {
      onUpdate({ aspectRatio: ratio } as Partial<LibTVNodeData>);
    }
  }, [nodeType, onUpdate]);

  // 图片/视频节点：分辨率切换后实时同步到节点 data
  const handleResolutionChange = useCallback((res: ResolutionOption) => {
    setSelectedResolution(res);
    if (nodeType === 'image' || nodeType === 'video') {
      onUpdate({ resolution: res } as Partial<LibTVNodeData>);
    }
  }, [nodeType, onUpdate]);

  // 视频节点：声音开关切换后实时同步到节点 data
  const handleGenerateAudioChange = useCallback((enabled: boolean) => {
    setGenerateAudio(enabled);
    if (nodeType === 'video') {
      onUpdate({ generateAudio: enabled } as Partial<LibTVNodeData>);
    }
  }, [nodeType, onUpdate]);

  const panelClass = isFullscreen
    ? 'fixed inset-4 z-50 bg-white rounded-2xl shadow-2xl flex flex-col p-5'
    : 'bg-white rounded-xl shadow-lg border border-gray-100 w-[750px] flex flex-col px-2 py-2';

  return (
    <div className={panelClass}>

      {/* 错误提示条（hookError 有值时显示） */}
      {hookError && (
        <div className="mb-2 px-3 py-2 rounded-md bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 mt-1.5 flex-shrink-0" />
          <span className="flex-1 break-all">{hookError}</span>
          <button
            onClick={clearError}
            className="text-red-500 hover:text-red-700 flex-shrink-0"
            title="关闭"
          >
            ✕
          </button>
        </div>
      )}

      {/* 视频节点：模式选择器 + 快捷导入按钮 */}
      {nodeType === 'video' && (
        <div className="flex items-center justify-between">
          <VideoModeSelector value={videoMode} onChange={setVideoMode} imageCount={upstreamImageCount} videoCount={upstreamVideoCount} />
          <div className="flex items-center gap-1">
            {importablePrompts.length > 0 && !promptImported && (
              <div className="flex gap-1">
                {importablePrompts.map((item) => (
                  <button
                    key={item.label}
                    onClick={() => handleImportPrompt(item.prompt, item.duration)}
                    title={`导入${item.label}`}
                    className="px-2 py-0.5 text-xs rounded bg-black/70 text-white hover:bg-black opacity-60 hover:opacity-100 transition-opacity"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 第一层：上游输入区 */}
      <PromptUpstreamBar
        inputs={upstreamInputs}
        onInsertMention={handleInsertMention}
        onRemoveMention={handleRemoveMention}
        targetNodeId={nodeId}
        showStyleSelector={nodeType === 'image'}
      />

      {/* 第二层：提示词编辑区（暂存按钮悬浮在右下角） */}
      <div className="flex-1 min-w-0 px-2 relative">
        <PromptEditor
          value={promptText}
          mentions={mentions}
          placeholder={config.placeholder}
          maxLength={config.maxLength}
          upstreamInputs={upstreamInputs}
          syncKey={nodeId}
          onChange={handlePromptChange}
          ref={editorRef}
        />
        <button
          onClick={handleSaveDraft}
          title="暂存当前提示词"
          className={`absolute bottom-2 right-3 flex items-center justify-center w-6 h-6 rounded-md bg-white/80 backdrop-blur-sm transition-colors ${savedFlash ? 'text-green-500' : 'text-gray-400 hover:text-black hover:bg-gray-100'}`}
        >
          {savedFlash ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 8l3.5 3.5L13 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 3.5C3 2.67 3.67 2 4.5 2H10l3 3v7.5c0 .83-.67 1.5-1.5 1.5h-7C3.67 14 3 13.33 3 12.5v-9zM5 8h6M5 11h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </div>

      {/* 第三层：底部工具栏 */}
      <PromptToolbar
        models={availableModels}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        selectedResolution={selectedResolution}
        onResolutionChange={handleResolutionChange}
        selectedAspectRatio={selectedAspectRatio}
        onAspectRatioChange={handleAspectRatioChange}
        selectedQuality={selectedQuality}
        onQualityChange={setSelectedQuality}
        isGenerating={hookIsGenerating}
        onGenerate={handleGenerate}
        nodeType={nodeType}
        selectedVoice={selectedVoice}
        onVoiceChange={setSelectedVoice}
        selectedSpeed={selectedSpeed}
        onSpeedChange={setSelectedSpeed}
        selectedStyle={selectedStyle}
        onStyleChange={setSelectedStyle}
        selectedTone={selectedTone}
        onToneChange={setSelectedTone}
        selectedDuration={selectedDuration}
        onDurationChange={handleDurationChange}
        generateAudio={generateAudio}
        onGenerateAudioChange={handleGenerateAudioChange}
      />
    </div>
  );
});
