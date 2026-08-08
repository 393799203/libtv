/**
 * 分镜节点同步工具
 * - 为单个镜头创建图片/视频节点（由分镜节点连出）
 * - 使用确定性 ID 避免重复创建（同一镜头复用同一节点）
 * - 触发单节点生成（保存画布 → 设置 running → 调后端 → 订阅 SSE）
 * 模式参考 assetImageSync.ts，但节点位于脚本节点下游（右侧）
 */

import { useCanvasStore } from '@/stores/canvasStore';
import { useExecutionStore } from '@/stores/executionStore';
import { canvasApi } from '@/services/canvasApi';
import { workflowApi } from '@/services/workflowApi';
import { createNode } from '@/utils/nodeFactory';
import { clearAllStale } from '@/utils/topology';
import type {
  LibTVNode,
  ScriptShot,
  ScriptNodeData,
  ImageNodeData,
  VideoNodeData,
} from '@/types/canvas';
import type { MentionMarker } from '@/types/prompt';

/**
 * 从脚本节点的资产（角色/场景/道具）中收集已准备参考图的 mentions
 * 后端 ImageExecutor 会通过 mentions 查找参考图节点并提取 imageUrl（当前取第一个作为图生图参考）
 * 注意：资产图片节点无需通过边连接到分镜图片节点，后端通过 nodeDataByID 全图查找
 */
function buildAssetMentions(scriptNodeId: string, promptText?: string): MentionMarker[] {
  const store = useCanvasStore.getState();
  const scriptNode = store.nodes.find(n => n.id === scriptNodeId);
  if (!scriptNode || scriptNode.type !== 'script') {
    console.warn('[ShotNodeSync] buildAssetMentions: 脚本节点未找到或类型非 script:', scriptNodeId);
    return [];
  }

  const scriptData = scriptNode.data as ScriptNodeData;
  const mentions: MentionMarker[] = [];

  const collect = (assets: { name: string; nodeId?: string }[], fallbackLabel: string) => {
    for (const a of assets) {
      if (!a.nodeId) {
        console.log(`[ShotNodeSync] 资产[${fallbackLabel}] "${a.name}" 无 nodeId（未生成/上传图片），跳过`);
        continue;
      }
      const imgNode = store.nodes.find(n => n.id === a.nodeId);
      if (!imgNode) {
        console.warn(`[ShotNodeSync] 资产[${fallbackLabel}] "${a.name}" nodeId=${a.nodeId} 在画布中找不到对应节点`);
        continue;
      }
      const imageUrl = (imgNode.data as { imageUrl?: string }).imageUrl;
      if (!imageUrl) {
        console.warn(`[ShotNodeSync] 资产[${fallbackLabel}] "${a.name}" 节点 ${a.nodeId} 的 imageUrl 为空`);
        continue;
      }
      console.log(`[ShotNodeSync] 资产[${fallbackLabel}] "${a.name}" 命中: nodeId=${a.nodeId} imageUrl=${imageUrl.slice(0, 60)}`);
      // ✅ label 用节点 label（如"场景-御花园"），与 prompt 中的 (@场景-御花园) 模式匹配
      const nodeLabel = (imgNode.data.label as string) || `${fallbackLabel}-${a.name}`;
      mentions.push({
        id: a.nodeId,
        nodeId: a.nodeId,
        label: nodeLabel,
        nodeType: 'image',
      });
    }
  };

  // 顺序：角色 → 场景 → 道具（后端取第一个，角色通常最关键）
  collect(scriptData.characters || [], '角色');
  collect(scriptData.scenes || [], '场景');
  collect(scriptData.props || [], '道具');

  console.log(`[ShotNodeSync] buildAssetMentions: 全部资产 ${mentions.length} 条（角色=${scriptData.characters?.length || 0} 场景=${scriptData.scenes?.length || 0} 道具=${scriptData.props?.length || 0}）`);

  // ✅ 如果传了 promptText，只保留 prompt 中实际以 (@类型-名称) 引用的资产
  if (promptText) {
    const referenced = mentions.filter(m => {
      if (!m.label) return false;
      const regex = new RegExp(`[（(]@${escapeRegex(m.label)}[）)]`);
      return regex.test(promptText);
    });
    console.log(`[ShotNodeSync] buildAssetMentions: prompt 实际引用 ${referenced.length}/${mentions.length} 个资产`, referenced.map(m => m.label));
    return referenced;
  }

  return mentions;
}

/** 转义正则特殊字符 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 将 prompt 中的 (@类型-名称) / （@类型-名称）模式转换为 [[m:<id>]] 占位符
 * 这样 PromptEditor 的 buildHtml 能识别并渲染为可视化的 @引用标签
 */
function convertPromptMentions(prompt: string, mentions: MentionMarker[]): string {
  let result = prompt;
  for (const m of mentions) {
    if (!m.label) continue;
    // 匹配 (@类型-名称) 或 （@类型-名称），如 (@场景-御花园)
    const regex = new RegExp(`[（(]@${escapeRegex(m.label)}[）)]`, 'g');
    result = result.replace(regex, `[[m:${m.id}]]`);
  }
  return result;
}

/**
 * 为每个资产图片节点创建到目标节点的边（如果不存在）
 * - 让前端 PromptUpstreamBar 显示资产缩略图
 * - 让后端 upstream fallback 也能找到资产图（双保险）
 */
function ensureAssetEdges(assetMentions: MentionMarker[], targetNodeId: string): void {
  const store = useCanvasStore.getState();
  for (const m of assetMentions) {
    const exists = store.edges.some(e => e.source === m.nodeId && e.target === targetNodeId);
    if (!exists) {
      store.addEdge({
        id: `e-${m.nodeId}-${targetNodeId}`,
        source: m.nodeId,
        target: targetNodeId,
        type: 'dataFlow',
      });
    }
  }
}

/** 生成分镜图片节点唯一 ID：shot-image-{shotId}-{scriptNodeId} */
export function generateShotImageNodeId(shotId: string, scriptNodeId: string): string {
  return `shot-image-${shotId}-${scriptNodeId}`;
}

/** 生成分镜视频节点唯一 ID：shot-video-{shotId}-{scriptNodeId} */
export function generateShotVideoNodeId(shotId: string, scriptNodeId: string): string {
  return `shot-video-${shotId}-${scriptNodeId}`;
}

/** 查找已存在的分镜图片节点 */
export function findShotImageNode(scriptNodeId: string, shotId: string): LibTVNode | null {
  const store = useCanvasStore.getState();
  return store.nodes.find(n => n.id === generateShotImageNodeId(shotId, scriptNodeId)) || null;
}

/** 查找已存在的分镜视频节点 */
export function findShotVideoNode(scriptNodeId: string, shotId: string): LibTVNode | null {
  const store = useCanvasStore.getState();
  return store.nodes.find(n => n.id === generateShotVideoNodeId(shotId, scriptNodeId)) || null;
}

/**
 * 创建或复用分镜图片节点
 * - 位置：脚本节点右侧 +400，按镜头序号纵向堆叠（每个镜头间隔 220px）
 * - 连接边：脚本节点 → 图片节点
 * - 设置 data.prompt = storyboardPrompt（点击节点时 PromptPanel 会自动加载）
 */
export function createShotImageNode(
  scriptNodeId: string,
  shot: ScriptShot,
  storyboardPrompt: string,
  modelId?: string,
): LibTVNode | null {
  const store = useCanvasStore.getState();
  const scriptNode = store.nodes.find(n => n.id === scriptNodeId);
  if (!scriptNode || scriptNode.type !== 'script') {
    console.error('[ShotNodeSync] 找不到脚本节点:', scriptNodeId);
    return null;
  }

  const imageNodeId = generateShotImageNodeId(shot.id, scriptNodeId);
  const assetMentions = buildAssetMentions(scriptNodeId, storyboardPrompt);
  // ✅ 将 prompt 中的 (@类型-名称) 转为 [[m:<id>]] 占位符，让 PromptEditor 渲染为 @标签
  const convertedPrompt = convertPromptMentions(storyboardPrompt, assetMentions);
  const existing = store.nodes.find(n => n.id === imageNodeId);
  if (existing) {
    // 已存在：更新提示词，复用节点
    const existingModel = (existing.data as ImageNodeData).model || '';
    store.updateNodeData(imageNodeId, {
      prompt: convertedPrompt,
      model: modelId || existingModel || '',
      mentions: assetMentions,
      status: 'idle',
      error: undefined,
    } as Partial<ImageNodeData>);
    // ✅ 补齐资产→分镜节点的边（让上游栏显示资产）
    ensureAssetEdges(assetMentions, imageNodeId);
    return existing;
  }

  const scriptPos = scriptNode.position;
  const offsetY = (shot.shotNumber - 1) * 220;
  const imageNode = createNode('image', { x: scriptPos.x + 400, y: scriptPos.y + offsetY }, {
    id: imageNodeId,
    data: {
      label: `分镜${shot.shotNumber}-参考图`,
      prompt: convertedPrompt,
      model: modelId || '',
      mentions: assetMentions,
      resolution: '2K',
      aspectRatio: '16:9',
      quality: '标准画质',
    },
  });

  store.addNode(imageNode);
  // 脚本节点 → 图片节点
  store.addEdge({
    id: `e-${scriptNodeId}-${imageNodeId}`,
    source: scriptNodeId,
    target: imageNodeId,
    type: 'dataFlow',
  });
  // ✅ 资产图片节点 → 图片节点（让上游栏显示资产 + 后端 fallback 双保险）
  ensureAssetEdges(assetMentions, imageNodeId);

  return imageNode;
}

/**
 * 创建或复用分镜视频节点
 * - 如果已存在分镜图片节点：视频节点放在图片节点右侧 +400，并连边 image→video（作为上游参考图）
 * - 如果没有图片节点：视频节点放在脚本节点右侧 +400（图片节点的位置）
 * - 设置 data.prompt = finalPrompt（画面 + 运动合成提示词）
 */
export function createShotVideoNode(
  scriptNodeId: string,
  shot: ScriptShot,
  finalPrompt: string,
  modelId?: string,
): LibTVNode | null {
  const store = useCanvasStore.getState();
  const scriptNode = store.nodes.find(n => n.id === scriptNodeId);
  if (!scriptNode || scriptNode.type !== 'script') {
    console.error('[ShotNodeSync] 找不到脚本节点:', scriptNodeId);
    return null;
  }

  const videoNodeId = generateShotVideoNodeId(shot.id, scriptNodeId);
  // 视频节点不需要资产引用，去掉提示词中的 (@类型-名称) 标签
  const cleanPrompt = finalPrompt.replace(/[（(]@[^\）)]+[）)]/g, '');

  // 查找已存在的分镜图片节点
  const imageNode = findShotImageNode(scriptNodeId, shot.id);
  const hasImage = !!(imageNode && (imageNode.data as ImageNodeData).imageUrl);

  const existing = store.nodes.find(n => n.id === videoNodeId);
  if (existing) {
    const existingModel = (existing.data as VideoNodeData).model || '';
    store.updateNodeData(videoNodeId, {
      prompt: cleanPrompt,
      model: modelId || existingModel || '',
      status: 'idle',
      error: undefined,
    } as Partial<VideoNodeData>);
    // 补连 image→video 边
    if (hasImage && imageNode) {
      const edgeExists = store.edges.some(e => e.source === imageNode.id && e.target === videoNodeId);
      if (!edgeExists) {
        store.addEdge({
          id: `e-${imageNode.id}-${videoNodeId}`,
          source: imageNode.id,
          target: videoNodeId,
          type: 'dataFlow',
        });
      }
    }
    return existing;
  }

  // 计算位置：有图片节点则放在其右侧，否则放在图片节点的默认位置
  const offsetY = (shot.shotNumber - 1) * 220;
  const posX = imageNode ? imageNode.position.x + 400 : scriptNode.position.x + 400;
  const posY = imageNode ? imageNode.position.y : scriptNode.position.y + offsetY;

  const videoNode = createNode('video', { x: posX, y: posY }, {
    id: videoNodeId,
    data: {
      label: `分镜${shot.shotNumber}-视频`,
      prompt: cleanPrompt,
      model: modelId || '',
      duration: shot.duration || 5,
      fps: 24,
      aspectRatio: '16:9',
      resolution: '1080p',
    },
  });

  store.addNode(videoNode);
  // 如果有图片节点，连 image→video（作为上游参考图）
  if (hasImage && imageNode) {
    store.addEdge({
      id: `e-${imageNode.id}-${videoNodeId}`,
      source: imageNode.id,
      target: videoNodeId,
      type: 'dataFlow',
    });
  }

  return videoNode;
}

/**
 * 仅保存画布（不触发生成）。
 * 用于创建分镜节点后让用户在画布上手动点击生成。
 */
export async function persistShotCanvas(projectId: string): Promise<void> {
  const store = useCanvasStore.getState();
  const cleanNodes = clearAllStale(store.nodes);
  const fresh = useCanvasStore.getState();
  const viewport = fresh._cache.get(projectId)?.savedViewport || { x: 0, y: 0, zoom: 1 };
  try {
    await canvasApi.saveCanvas(projectId, {
      nodes: cleanNodes.length === fresh.nodes.length ? fresh.nodes : cleanNodes,
      edges: fresh.edges,
      viewport,
    });
  } catch (e) {
    console.error('[ShotNodeSync] 保存画布失败:', e);
  }
}

/**
 * 触发单节点生成（独立函数，供 Drawer 调用）
 * 流程：保存画布 → 设置 running → 调后端 execute → 订阅 SSE
 * SSE 订阅由 WorkspacePage 的 activeStreams 自动接管
 *
 * @returns true 表示成功触发，false 表示失败
 */
export async function triggerNodeGeneration(
  projectId: string,
  nodeId: string,
): Promise<boolean> {
  const store = useCanvasStore.getState();

  // 1) 存盘前清掉所有 stale 标（脏标不进持久化）
  const cleanNodes = clearAllStale(store.nodes);
  const fresh = useCanvasStore.getState();
  const viewport = fresh._cache.get(projectId)?.savedViewport || { x: 0, y: 0, zoom: 1 };
  try {
    await canvasApi.saveCanvas(projectId, {
      nodes: cleanNodes.length === fresh.nodes.length ? fresh.nodes : cleanNodes,
      edges: fresh.edges,
      viewport,
    });
  } catch (e) {
    console.error('[ShotNodeSync] 保存画布失败:', e);
  }

  // 2) 设置节点运行状态
  store.updateNodeData(nodeId, { status: 'running', error: undefined, stale: false });
  store.updateNodeStatus(nodeId, 'running');

  // 3) 调后端 API
  try {
    const resp = await workflowApi.execute(projectId, { startNodeId: nodeId, mode: 'single' });
    if (resp?.executionId != null) {
      useExecutionStore.getState().setCurrentExecution({
        id: resp.executionId,
        status: 'running',
        nodes: [{ nodeId, status: 'running', progress: 0 }],
      } as never);
      useExecutionStore.getState().addActiveStream({ projectId, executionId: resp.executionId, nodeId });
      return true;
    }
    store.updateNodeStatus(nodeId, 'failed');
    return false;
  } catch (e) {
    console.error('[ShotNodeSync] execute failed:', e);
    store.updateNodeStatus(nodeId, 'failed');
    return false;
  }
}
