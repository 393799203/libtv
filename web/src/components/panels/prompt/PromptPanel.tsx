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

/**
 * 手动创建的视频节点：从上游图片节点反查关联分镜的最终提示词
 */
function computeImportablePrompts(
  nodeType: NodeType,
  nodeId: string,
  upstreamInputs: UpstreamInput[],
  nodes: LibTVNode[]
): { label: string; prompt: string; duration?: number }[] {
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
}

/**
 * 计算"上游签名"：把 getUpstreamInputs / computeImportablePrompts 实际读到的所有字段
 * 拼成字符串。zustand 用 Object.is 比较选择器结果，签名不变就不会触发面板重渲染——
 * 画布上其他节点的拖动 / SSE 进度写回都不会影响本面板。
 */
function computeUpstreamSignature(nodeId: string, nodes: LibTVNode[], edges: LibTVEdge[]): string {
  const parts: string[] = [];
  const seenNodes = new Set<string>();
  const addNode = (n: LibTVNode | undefined) => {
    if (!n || seenNodes.has(n.id)) return;
    seenNodes.add(n.id);
    const d = n.data as Record<string, unknown>;
    parts.push(
      `node:${n.id}|${n.type}|${d.type}|${d.label}|${d.imageUrl}|${d.videoUrl}|${d.content}|${d.scriptContent}|${d.audioUrl}`
    );
  };
  for (const e of edges) {
    if (e.target !== nodeId) continue;
    parts.push(`edge:${e.source}`);
    const src = nodes.find((n) => n.id === e.source);
    addNode(src);
    // 分镜图片节点关联的 script 节点：shots 里被读到的字段也纳入签名
    if (src && src.id.startsWith('shot-image-')) {
      const m = src.id.match(/^shot-image-(.+)-(script-.+)$/);
      const scriptNode = m ? nodes.find((n) => n.id === m[2]) : undefined;
      if (scriptNode) {
        addNode(scriptNode);
        const shots = (scriptNode.data as ScriptNodeData).shots || [];
        for (const s of shots) {
          parts.push(`shot:${s.id}|${s.shotNumber}|${s.finalPrompt}|${s.motionPrompt}|${s.duration}`);
        }
      }
    }
  }
  return parts.join('\n');
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

  // 上游签名订阅：只在面板实际依赖的上游字段变化时才重渲染，
  // 画布上无关节点的拖动 / SSE 进度写回不会触发本面板更新
  const upstreamSignature = useCanvasStore((s) => computeUpstreamSignature(nodeId, s.nodes, s.edges));
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

  // 上游输入 + 可导入提示词：签名不变时按需读 store（不订阅），useMemo 不重算
  const { upstreamInputs, importablePrompts } = useMemo(() => {
    const { nodes, edges } = useCanvasStore.getState();
    const inputs = getUpstreamInputs(nodeId, nodes, edges);
    return {
      upstreamInputs: inputs,
      importablePrompts: computeImportablePrompts(nodeType, nodeId, inputs, nodes),
    };
    // upstreamSignature 已覆盖这两个函数读到的所有字段（作为重算门控，eslint 认为它"多余"是有意为之）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, nodeType, upstreamSignature]);

  // 导入提示词（填充后隐藏按钮）
  const [promptImported, setPromptImported] = useState(false);
  const handleImportPrompt = useCallback((prompt: string, duration?: number) => {
    // 去掉分镜提示词中的 (@类型-名称) 标签
    const cleanPrompt = prompt.replace(/[（(]@[^\）)]+[）)]/g, '').trim();
    setPromptText(cleanPrompt);
    setMentions([]);
    promptTextRef.current = cleanPrompt;
    mentionsRef.current = [];
    editorRef.current?.setValue(cleanPrompt);
    setPromptImported(true);
    // 立即保存到节点 data，确保生成时能读到 prompt
    const updateData: Partial<LibTVNodeData> = { prompt: cleanPrompt, mentions: [] };
    if (duration && duration > 0) {
      // duration 是从 data 派生的值，这里只需写回 data
      const clampedDuration = Math.min(Math.max(duration, 4), 15);
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
  // refs 与 state 同步，供暂存/生成的 useCallback 兜底读取
  // （避免把 promptText/mentions 放进依赖，导致防抖 flush 时工具栏 memo 失效）
  const promptTextRef = useRef(promptText);
  const mentionsRef = useRef(mentions);

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

  // 注意：Canvas.tsx 用 key={selectedNode.id} 重挂载本组件，切换节点时 useState 初始化器
  // 已经生效，因此不再需要「监听 nodeId/data 变化并重置本地状态」的 effect。

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

  // 图片/视频节点的分辨率、比例：onChange 已即时写回 data，直接从 data 派生，不再保留本地 state
  const selectedResolution: ResolutionOption = ('resolution' in data && (data as any).resolution)
    ? (data as any).resolution as ResolutionOption
    : (config.defaultResolution as ResolutionOption) || '1K';
  const selectedAspectRatio: string = ('aspectRatio' in data && (data as any).aspectRatio)
    ? (data as any).aspectRatio
    : config.defaultAspectRatio;
  // 画质：无即时写回，仍用本地 state（暂存/生成时统一写回）
  const [selectedQuality, setSelectedQuality] = useState<string>(
    ('quality' in data && (data as any).quality)
      ? (data as any).quality
      : '标准画质'
  );

  // 视频节点：模型切换后，若当前分辨率不在新模型支持的列表中，自动切换到第一个可用项
  // 避免向后端发送模型不支持的分辨率（分辨率派生自 data，回退时直接写回 data）
  useEffect(() => {
    if (nodeType !== 'video') return;
    const currentModel = availableModels.find((m) => m.value === selectedModel);
    const supported = currentModel?.resolutions;
    const opts = supported && supported.length > 0 ? supported : [...VIDEO_RESOLUTION_OPTIONS];
    if (!opts.includes(selectedResolution)) {
      onUpdate({ resolution: opts[0] } as Partial<LibTVNodeData>);
    }
  }, [nodeType, selectedModel, availableModels, selectedResolution, onUpdate]);

  // 视频节点专属：生成模式（根据上游图片数量自动过滤可选模式）
  const [videoMode, setVideoMode] = useState<VideoMode>(
    nodeType === 'video' ? ((data as { videoMode?: VideoMode }).videoMode || 'text-to-video') : 'text-to-video'
  );
  // 视频节点专属：时长（4-15秒，默认5秒）与是否生成音频（默认开启）
  // onChange 已即时写回 data，直接从 data 派生，不再保留本地 state
  const selectedDuration: number = nodeType === 'video'
    ? (() => {
        const d = (data as { duration?: number }).duration;
        if (!d || d <= 0) return 5;
        if (d < 4) return 4;
        if (d > 15) return 15;
        return d;
      })()
    : 5;
  const generateAudio: boolean = nodeType === 'video'
    ? ((data as { generateAudio?: boolean }).generateAudio !== false)
    : true;
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

  // 音频节点：计算输入字符数（用于费用预估）
  // 包括提示词文本 + 上游文本节点内容
  const audioCharCount = useMemo(() => {
    if (nodeType !== 'audio') return 0;
    let total = promptText.length;
    // 加上上游文本节点的内容
    for (const input of upstreamInputs) {
      if (input.nodeType === 'text' && input.textSnippet) {
        total += input.textSnippet.length;
      }
    }
    return total;
  }, [nodeType, promptText, upstreamInputs]);

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
      promptTextRef.current = value;
      mentionsRef.current = newMentions;
      setPromptText(value);
      setMentions(newMentions);
    },
    []
  );

  // 移除 @ 引用（删除上游连线时自动清理），直接删编辑器 DOM 中的 mention span
  const handleRemoveMention = useCallback(
    (nodeId: string) => {
      editorRef.current?.removeMentionByNodeId(nodeId);
    },
    []
  );

  // 暂存/生成共用的字段组装：prompt/mentions 从编辑器 DOM 提取（避免防抖延迟），
  // 分辨率/比例/时长/声音开关读 data 派生值，其余读本地 state
  const buildUpdateData = useCallback((): Partial<LibTVNodeData> => {
    const currentModel = availableModels.find(m => m.value === selectedModel);
    const modelIdToSave = currentModel?.modelId || selectedModel;  // 保存实际的 model_id
    const updateData: Partial<LibTVNodeData> = {
      prompt: editorRef.current?.getValue() ?? promptTextRef.current,
      mentions: editorRef.current?.getMentions() ?? mentionsRef.current,  // 从 DOM 提取，保证与实际引用一致
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
      (updateData as any).duration = selectedDuration;  // 视频时长（4-15秒）
      (updateData as any).generateAudio = generateAudio;  // 是否生成音频
    }
    if (nodeType === 'audio') {
      (updateData as any).voice = selectedVoice;  // 音色
      (updateData as any).speed = selectedSpeed;  // 语速
      (updateData as any).style = selectedStyle;  // 风格
      (updateData as any).tone = selectedTone;    // 语气词
    }
    return updateData;
  }, [availableModels, selectedModel, nodeType, selectedResolution, selectedAspectRatio, selectedQuality, videoMode, selectedDuration, generateAudio, selectedVoice, selectedSpeed, selectedStyle, selectedTone]);

  // 暂存：只保存到 zustand store 内存状态，不持久化到后端
  // 下次点击节点能取到最新内容，刷新页面回到之前后端持久化的状态
  const [savedFlash, setSavedFlash] = useState(false);
  const savedFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 卸载时清理暂存闪烁的定时器，避免组件销毁后 setState
  useEffect(() => () => {
    if (savedFlashTimerRef.current) clearTimeout(savedFlashTimerRef.current);
  }, []);
  const handleSaveDraft = useCallback(() => {
    onUpdate(buildUpdateData());
    setSavedFlash(true);
    if (savedFlashTimerRef.current) clearTimeout(savedFlashTimerRef.current);
    savedFlashTimerRef.current = setTimeout(() => setSavedFlash(false), 1500);
  }, [buildUpdateData, onUpdate]);

  // 发送生成 — 通过 useNodeGeneration 统一入口
  const handleGenerate = useCallback(async (count?: number) => {
    if (!projectId) {
      console.error('projectId 不存在，无法执行工作流');
      return;
    }

    // 1) 同步本地状态到节点 data（通过 onUpdate 传出来）
    //    mentions 跟 prompt 一起持久化，避免 reload 后 [[m:ID]] 找不到对应元数据
    if (nodeType === 'text' || nodeType === 'image' || nodeType === 'video' || nodeType === 'audio' || nodeType === 'script') {
      const updateData = buildUpdateData();
      if (nodeType === 'image') {
        (updateData as any).count = count; // 生成数量
      }
      onUpdate(updateData);
    }

    // 2) 调统一入口（自动：存盘 → 调后端 → 订阅 SSE）
    await generate({ mode: 'single' });
  }, [projectId, nodeType, buildUpdateData, onUpdate, generate]);

  // 视频节点：时长调整后实时同步到节点 data（避免刷新丢失）；UI 值从 data 派生
  const handleDurationChange = useCallback((duration: number) => {
    if (nodeType === 'video') {
      onUpdate({ duration } as Partial<LibTVNodeData>);
    }
  }, [nodeType, onUpdate]);

  // 图片/视频节点：长宽比切换后实时同步到节点 data（节点高度需根据比例动态变化）
  const handleAspectRatioChange = useCallback((ratio: string) => {
    if (nodeType === 'image' || nodeType === 'video') {
      onUpdate({ aspectRatio: ratio } as Partial<LibTVNodeData>);
    }
  }, [nodeType, onUpdate]);

  // 图片/视频节点：分辨率切换后实时同步到节点 data
  const handleResolutionChange = useCallback((res: ResolutionOption) => {
    if (nodeType === 'image' || nodeType === 'video') {
      onUpdate({ resolution: res } as Partial<LibTVNodeData>);
    }
  }, [nodeType, onUpdate]);

  // 视频节点：声音开关切换后实时同步到节点 data
  const handleGenerateAudioChange = useCallback((enabled: boolean) => {
    if (nodeType === 'video') {
      onUpdate({ generateAudio: enabled } as Partial<LibTVNodeData>);
    }
  }, [nodeType, onUpdate]);

  const panelClass = isFullscreen
    ? 'fixed inset-4 z-50 bg-white rounded-2xl shadow-2xl flex flex-col p-5'
    : 'bg-white rounded-2xl shadow-xl border border-gray-100 ring-1 ring-black/5 w-[750px] flex flex-col px-2 py-2';

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
        charCount={audioCharCount}
      />
    </div>
  );
});
