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
import { extractPromptRefTokens, tokenMatchesAsset, normalizeAssetName, type PromptRefToken } from '@/utils/assetRef';

/** 脚本资产及其对应的画布图片节点引用（以 nodeId 为锚点） */
interface AssetRef {
  mention: MentionMarker;
  assetType: '角色' | '场景' | '道具';
  assetName: string;
}

/**
 * 从脚本节点的资产（角色/场景/道具）中收集已准备参考图的资产引用
 * 后端 ImageExecutor 会通过 mentions 中的 nodeId 查找参考图节点并提取 imageUrl
 * 注意：资产图片节点无需通过边连接到分镜图片节点，后端通过 nodeDataByID 全图查找
 */
function buildAssetRefs(scriptNodeId: string): AssetRef[] {
  const store = useCanvasStore.getState();
  const scriptNode = store.nodes.find(n => n.id === scriptNodeId);
  if (!scriptNode || scriptNode.type !== 'script') {
    console.warn('[ShotNodeSync] buildAssetRefs: 脚本节点未找到或类型非 script:', scriptNodeId);
    return [];
  }

  const scriptData = scriptNode.data as ScriptNodeData;
  const refs: AssetRef[] = [];

  const collect = (assets: { name: string; nodeId?: string }[], assetType: '角色' | '场景' | '道具') => {
    for (const a of assets) {
      if (!a.nodeId) {
        console.log(`[ShotNodeSync] 资产[${assetType}] "${a.name}" 无 nodeId（未生成/上传图片），跳过`);
        continue;
      }
      const imgNode = store.nodes.find(n => n.id === a.nodeId);
      if (!imgNode) {
        console.warn(`[ShotNodeSync] 资产[${assetType}] "${a.name}" nodeId=${a.nodeId} 在画布中找不到对应节点`);
        continue;
      }
      const imageUrl = (imgNode.data as { imageUrl?: string }).imageUrl;
      if (!imageUrl) {
        console.warn(`[ShotNodeSync] 资产[${assetType}] "${a.name}" 节点 ${a.nodeId} 的 imageUrl 为空`);
        continue;
      }
      console.log(`[ShotNodeSync] 资产[${assetType}] "${a.name}" 命中: nodeId=${a.nodeId} imageUrl=${imageUrl.slice(0, 60)}`);
      // ✅ label 用脚本资产的标准格式（类型-名称），与 LLM 生成的 (@类型-名称) 格式对齐；
      // 不用画布节点 label，避免用户重命名节点后关联失效
      refs.push({
        mention: {
          id: a.nodeId,
          nodeId: a.nodeId,
          label: `${assetType}-${a.name}`,
          nodeType: 'image',
        },
        assetType,
        assetName: a.name,
      });
    }
  };

  // 顺序：角色 → 场景 → 道具（后端取第一个，角色通常最关键）
  collect(scriptData.characters || [], '角色');
  collect(scriptData.scenes || [], '场景');
  collect(scriptData.props || [], '道具');

  console.log(`[ShotNodeSync] buildAssetRefs: 全部资产 ${refs.length} 条（角色=${scriptData.characters?.length || 0} 场景=${scriptData.scenes?.length || 0} 道具=${scriptData.props?.length || 0}）`);
  return refs;
}

/**
 * 解析 token 对应的资产引用：精确名字匹配优先，其次模糊包含匹配
 */
function resolveTokenRef(token: PromptRefToken, refs: AssetRef[]): AssetRef | null {
  const t = normalizeAssetName(token.name);
  for (const r of refs) {
    if (r.assetType === token.type && normalizeAssetName(r.assetName) === t) return r;
  }
  for (const r of refs) {
    if (tokenMatchesAsset(token, r.assetType, r.assetName)) return r;
  }
  return null;
}

/**
 * 解析分镜提示词中的资产引用（一次性完成筛选 + 占位符转换）
 * - mentions 以资产 nodeId 为锚点（后端按 ID 查参考图，与名字无关）
 * - 名字解析采用精确优先 + 模糊包含兜底，名字轻微变化（多/少字、空格差异）也能关联
 * - prompt 中的 (@类型-名称) 转为 [[m:<nodeId>]] 占位符，让 PromptEditor 渲染为 @标签
 */
function resolveShotAssetRefs(scriptNodeId: string, promptText: string): {
  mentions: MentionMarker[];
  convertedPrompt: string;
} {
  const refs = buildAssetRefs(scriptNodeId);
  const tokens = extractPromptRefTokens(promptText);

  // 只保留 prompt 中实际引用到的资产（模糊匹配）
  const matched = refs.filter(r => tokens.some(t => tokenMatchesAsset(t, r.assetType, r.assetName)));
  console.log(`[ShotNodeSync] prompt 实际引用 ${matched.length}/${refs.length} 个资产`, matched.map(r => r.assetName));

  // 将每个引用 token 替换为 [[m:<nodeId>]]；解析不出对应资产的 token 保留原文
  let convertedPrompt = promptText;
  for (const t of tokens) {
    const ref = resolveTokenRef(t, matched);
    if (ref) {
      convertedPrompt = convertedPrompt.split(t.raw).join(`[[m:${ref.mention.id}]]`);
    } else {
      console.warn(`[ShotNodeSync] 引用 "${t.raw}" 未解析到任何资产，保留原文`);
    }
  }

  return { mentions: matched.map(r => r.mention), convertedPrompt };
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

/** 每个镜头默认创建的参考图节点数量：首尾帧（首帧+尾帧）和全能参考都至少需要 2 张 */
export const SHOT_REF_IMAGE_COUNT = 2;

/** 参考图节点横向间距：节点宽 320 + 40 间隙 */
const SHOT_REF_IMAGE_GAP_X = 360;

/**
 * 生成分镜图片节点唯一 ID：shot-image-{shotId}-{scriptNodeId}
 * 第 2 张起追加 -ref{N} 后缀（第 1 张保持原格式，兼容已有画布）
 */
export function generateShotImageNodeId(shotId: string, scriptNodeId: string, index = 1): string {
  const base = `shot-image-${shotId}-${scriptNodeId}`;
  return index > 1 ? `${base}-ref${index}` : base;
}

/** 生成分镜视频节点唯一 ID：shot-video-{shotId}-{scriptNodeId} */
export function generateShotVideoNodeId(shotId: string, scriptNodeId: string): string {
  return `shot-video-${shotId}-${scriptNodeId}`;
}

/** 找出某镜头已存在的全部参考图节点（按序号 1..N） */
export function findShotImageNodes(scriptNodeId: string, shotId: string): LibTVNode[] {
  const store = useCanvasStore.getState();
  const nodes: LibTVNode[] = [];
  for (let i = 1; i <= SHOT_REF_IMAGE_COUNT; i++) {
    const n = store.nodes.find(x => x.id === generateShotImageNodeId(shotId, scriptNodeId, i));
    if (n) nodes.push(n);
  }
  return nodes;
}

/**
 * 分镜图片节点的命名：首尾帧模式（一次建 2 张）叫起始/结束画面，贴合它的用途（视频首尾帧）；
 * 参考模式仍叫参考图。节点 ID 不随之变化（仍靠 shot-image-… / -refN 后缀识别）。
 */
function shotImageLabel(index: number, modeCount: number): string {
  if (modeCount < 2) return '参考图';
  if (index === 1) return '起始画面';
  if (index === modeCount) return '结束画面';
  return `第${index}个瞬间`;
}

/** 查找已存在的分镜视频节点 */
export function findShotVideoNode(scriptNodeId: string, shotId: string): LibTVNode | null {
  const store = useCanvasStore.getState();
  return store.nodes.find(n => n.id === generateShotVideoNodeId(shotId, scriptNodeId)) || null;
}

/**
 * 创建或复用分镜图片节点
 * - 位置：脚本节点右侧 +400 起，同一镜头的第 2 张向右再排 360px（避免两张叠住）
 * - 按镜头序号纵向堆叠（每个镜头间隔 220px）
 * - 连接边：脚本节点 → 图片节点
 * - 设置 data.prompt = storyboardPrompt（点击节点时 PromptPanel 会自动加载）
 * - index：本模式的第几张（1 起）
 * - modeCount：本模式一共建几张 —— 2=首尾帧模式（起始画面/结束画面），1=参考模式（参考图）
 */
export function createShotImageNode(
  scriptNodeId: string,
  shot: ScriptShot,
  storyboardPrompt: string,
  modelId?: string,
  index = 1,
  modeCount = 1,
): LibTVNode | null {
  const store = useCanvasStore.getState();
  const scriptNode = store.nodes.find(n => n.id === scriptNodeId);
  if (!scriptNode || scriptNode.type !== 'script') {
    console.error('[ShotNodeSync] 找不到脚本节点:', scriptNodeId);
    return null;
  }

  const imageNodeId = generateShotImageNodeId(shot.id, scriptNodeId, index);
  // ✅ 解析资产引用：mentions 以 nodeId 锚定，名字模糊匹配兜底；prompt 中 (@类型-名称) 转 [[m:<id>]]
  const { mentions: assetMentions, convertedPrompt } = resolveShotAssetRefs(scriptNodeId, storyboardPrompt);
  const existing = store.nodes.find(n => n.id === imageNodeId);
  if (existing) {
    // 已存在：更新提示词，复用节点
    const existingModel = (existing.data as ImageNodeData).model || '';
    // 复用时同步自动命名的标签（参考图 ⇄ 起始/结束画面）；用户手动改过的名字不覆盖
    const nextLabel = `分镜${shot.shotNumber}-${shotImageLabel(index, modeCount)}`;
    const autoNamed = new RegExp(`^分镜${shot.shotNumber}-(参考图\\d*|起始画面|结束画面|第\\d+个瞬间)$`)
      .test(existing.data.label || '');
    store.updateNodeData(imageNodeId, {
      ...(autoNamed && existing.data.label !== nextLabel ? { label: nextLabel } : {}),
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
  const imageNode = createNode('image', { x: scriptPos.x + 400 + (index - 1) * SHOT_REF_IMAGE_GAP_X, y: scriptPos.y + offsetY }, {
    id: imageNodeId,
    data: {
      label: `分镜${shot.shotNumber}-${shotImageLabel(index, modeCount)}`,
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
  const cleanPrompt = finalPrompt.replace(/[（(]@[^）)]+[）)]/g, '');

  // 查找该镜头的全部参考图节点；上游边的顺序决定首尾帧次序（第 1 张=first_frame，第 2 张=last_frame）
  const imageNodes = findShotImageNodes(scriptNodeId, shot.id);
  const lastImageNode = imageNodes.length ? imageNodes[imageNodes.length - 1] : null;

  const existing = store.nodes.find(n => n.id === videoNodeId);
  if (existing) {
    const existingModel = (existing.data as VideoNodeData).model || '';
    store.updateNodeData(videoNodeId, {
      prompt: cleanPrompt,
      model: modelId || existingModel || '',
      status: 'idle',
      error: undefined,
    } as Partial<VideoNodeData>);
    // 补连 image→video 边（几张参考图就连几条，按序号顺序连）。
    // 只按节点存在判断，不要求已出图：参考图通常是在建视频节点之后才生成的，
    // 后端执行时才读 imageUrl，空的自会跳过。
    for (const imgNode of imageNodes) {
      const edgeExists = store.edges.some(e => e.source === imgNode.id && e.target === videoNodeId);
      if (!edgeExists) {
        store.addEdge({
          id: `e-${imgNode.id}-${videoNodeId}`,
          source: imgNode.id,
          target: videoNodeId,
          type: 'dataFlow',
        });
      }
    }
    return existing;
  }

  // 计算位置：有图片节点则放在其右侧，否则放在图片节点的默认位置
  const offsetY = (shot.shotNumber - 1) * 220;
  // 放在最后一张参考图右侧，避免压住第 2 张
  const posX = lastImageNode ? lastImageNode.position.x + 400 : scriptNode.position.x + 400;
  const posY = lastImageNode ? lastImageNode.position.y : scriptNode.position.y + offsetY;

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
  // 连 image→video（作为上游参考图）；有几张连几张，顺序即首尾帧顺序
  for (const imgNode of imageNodes) {
    store.addEdge({
      id: `e-${imgNode.id}-${videoNodeId}`,
      source: imgNode.id,
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
