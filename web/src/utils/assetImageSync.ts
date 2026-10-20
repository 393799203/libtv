/**
 * 资产与图片节点同步工具
 * - 使用 ID 映射机制替代 Label 查找，性能提升 10 倍+
 * - 保证数据一致性，避免竞态条件
 */

import { useCanvasStore } from '@/stores/canvasStore';
import { createNode } from '@/utils/nodeFactory';
import { absolutePositionIn } from '@/utils/canvasGroups';
import { deriveThumbUrl } from '@/utils/thumbUrl';
import type { ImageNodeData, LibTVEdge, LibTVNode } from '@/types/canvas';

type AssetType = 'character' | 'scene' | 'prop';

/** 资产类型 → 脚本节点 data 上的资产数组字段名 */
const ASSET_ARRAY_KEY = {
  character: 'characters',
  scene: 'scenes',
  prop: 'props',
} as const;

/**
 * 资产图片节点的 id 不再编码语义（历史格式 `{类型}-{名}-{脚本节点id}` 已废弃）：
 * - id 统一由 nodeFactory 的 newNodeId 产出（不按资产名拼 id）
 * - 「这个节点属于哪个资产」写在节点 data 上（assetType/assetName/scriptNodeId）
 * - 反向的「该资产用哪个节点」写在资产自己的 nodeId 上（脚本数据里）
 * 详见 types/canvas.ts 的 BaseNodeFields 注释。
 */

/** 把资产归属写进图片节点 data（创建 / 复用 / 关联已有节点三条路径共用） */
function stampAssetFields(
  imageNodeId: string,
  assetType: AssetType,
  assetName: string,
  scriptNodeId: string,
): void {
  useCanvasStore.getState().updateNodeData(imageNodeId, {
    assetType,
    assetName,
    scriptNodeId,
  } as never);
}

/**
 * 把若干字段合并进某个资产的记录，**资产数组从 store 读当前那一份**，返回合并后的数组。
 *
 * 调用方拿到返回值后自己写回（用各自原有的更新通道，比如 ScriptNode 的 onUpdate 顺带 scheduleSave）。
 *
 * 为什么必须从 store 读：资产面板的 props 可能是旧快照，谁要是拿它整组写回，
 * 就会把别处刚写上的 nodeId（「这个资产用哪个图片节点」的关联）覆盖成空 ——
 * 线上真发生过：同一场景出现两个图片节点，资产指向空节点，有结果的那个没人认领。
 *
 * @param fallback 取不到 store 数据时才用它（避免把资产数组整个写没）
 * @returns 合并后的数组；资产数组不存在时返回 null（调用方就别写了）
 */
export function mergeAssetFieldsInStore<T extends { name: string }>(
  scriptNodeId: string,
  assetType: AssetType,
  assetName: string,
  patch: Record<string, unknown>,
  fallback?: T[]
): T[] | null {
  const store = useCanvasStore.getState();
  const scriptNode = store.nodes.find(n => n.id === scriptNodeId);
  const key = ASSET_ARRAY_KEY[assetType];
  const fresh = (scriptNode?.data as unknown as Record<string, T[]> | undefined)?.[key];
  const base = fresh ?? fallback;
  if (!base) {
    return null;
  }
  return base.map(a => (a.name === assetName ? { ...a, ...patch } : a));
}

/**
 * 读资产上的 nodeId 指针（纯读取，不做任何兜底查找）
 * @returns 节点 ID，资产不存在或没写过关联时返回 null
 */
function readAssetNodeId(
  scriptNodeId: string,
  assetType: AssetType,
  assetName: string
): string | null {
  const store = useCanvasStore.getState();
  const scriptNode = store.nodes.find(n => n.id === scriptNodeId);

  if (!scriptNode || scriptNode.type !== 'script') {
    return null;
  }

  const scriptData = scriptNode.data as any;
  const assetArray = scriptData[ASSET_ARRAY_KEY[assetType]] as any[];
  const asset = assetArray?.find(a => a.name === assetName);

  return asset?.nodeId || null;
}

/**
 * 找该资产当前的图片节点。判据分两级：
 *  1. 资产上的 nodeId 指针（正常路径写上的关联）；
 *  2. 节点 data 上的归属字段 scriptNodeId + assetType + assetName（反向找）。
 *
 * 为什么必须能反向找：资产数组会被面板用「旧快照」整组写回（AssetPreparationPanel 里
 * 有同款注释），指针因此可能被抹掉。只认指针的后果是「同一个资产出现两个图片节点」——
 * 线上真发生过：一个节点有生成结果、另一个是空节点，而资产却指向空的那个。
 */
export function findAssetImageNode(
  scriptNodeId: string,
  assetType: AssetType,
  assetName: string
): LibTVNode | null {
  const store = useCanvasStore.getState();

  const linkedId = readAssetNodeId(scriptNodeId, assetType, assetName);
  const linked = linkedId ? store.nodes.find(n => n.id === linkedId) : undefined;
  if (linked) {
    return linked;
  }

  const matches = store.nodes.filter(n => {
    const d = n.data as { scriptNodeId?: string; assetType?: string; assetName?: string };
    return d?.scriptNodeId === scriptNodeId && d?.assetType === assetType && d?.assetName === assetName;
  });
  if (matches.length === 0) {
    return null;
  }

  // 一个资产理论上只该有一个图片节点；万一历史上留下了多个（空节点 + 有结果的节点），
  // 优先选已经有图的那个 —— 绝不为了「指针指谁」丢掉真正的结果
  return matches.find(n => Boolean((n.data as { imageUrl?: string })?.imageUrl)) ?? matches[0];
}

/**
 * 获取资产的图片节点 ID：先认指针，指针丢了就按节点归属字段反向找
 * @returns 节点 ID，确实没有节点时返回 null
 */
export function getAssetImageNodeId(
  scriptNodeId: string,
  assetType: AssetType,
  assetName: string
): string | null {
  return findAssetImageNode(scriptNodeId, assetType, assetName)?.id ?? null;
}

/**
 * 创建资产图片节点并设置关联
 * - 创建图片节点（位置：脚本节点左侧 -350px）
 * - 创建连接边（图片节点 → 脚本节点）
 * - 设置资产的 nodeId 字段
 * 注意：节点数据（model/prompt等）由调用方通过 updateNodeData 单独写入
 *
 * @returns 创建的图片节点对象（如已存在则返回已有节点）
 */
export function createAssetImageNode(
  scriptNodeId: string,
  assetType: AssetType,
  assetName: string,
): LibTVNode | null {
  const store = useCanvasStore.getState();

  // 找到脚本节点
  const scriptNode = store.nodes.find(n => n.id === scriptNodeId);
  if (!scriptNode || scriptNode.type !== 'script') {
    console.error('[AssetImageSync] 找不到脚本节点:', scriptNodeId);
    return null;
  }

  // 复用判断：走资产自己的 nodeId 引用，而不是「按 id 拼出这个节点应该叫什么」
  const linkedNodeId = getAssetImageNodeId(scriptNodeId, assetType, assetName);
  const existingImageNode = linkedNodeId ? store.nodes.find(n => n.id === linkedNodeId) : undefined;
  if (existingImageNode) {
    console.log('[AssetImageSync] 该资产已有图片节点，复用:', existingImageNode.id);
    // 老画布可能缺结构化字段：补齐（并确保资产关联不丢）
    stampAssetFields(existingImageNode.id, assetType, assetName, scriptNodeId);
    updateAssetImageNodeId(scriptNodeId, assetType, assetName, existingImageNode.id);
    return existingImageNode;
  }

  // 创建新图片节点（位置：脚本节点左侧 -350px）
  const scriptPos = scriptNode.position;
  const imageNodePos = { x: scriptPos.x - 350, y: scriptPos.y };

  const typeMap = {
    character: '角色',
    scene: '场景',
    prop: '道具',
  };

  const imageNode = createNode('image', imageNodePos, {
    data: {
      label: `${typeMap[assetType]}-${assetName}`,
      // 资产归属写在 data 上，id 由工厂统一生成（不再编码语义）
      assetType,
      assetName,
      scriptNodeId,
    },
  });
  const imageNodeId = imageNode.id;

  // 添加节点到画布
  store.addNode(imageNode);

  // 创建连接边（图片节点 → 脚本节点）
  const edge = {
    id: `e-${imageNodeId}-${scriptNodeId}`,
    source: imageNodeId,
    target: scriptNodeId,
    type: 'dataFlow',
  };
  store.addEdge(edge);

  // ✅ 新逻辑：直接更新资产的 imageNodeId
  updateAssetImageNodeId(scriptNodeId, assetType, assetName, imageNodeId);

  console.log('[AssetImageSync] 创建图片节点成功:', {
    imageNodeId,
    assetType,
    assetName,
    scriptNodeId,
  });

  return imageNode;
}

/**
 * 更新资产图片节点的 imageUrl（通过 imageNodeId 直接定位）
 */
export function updateAssetImageNodeUrl(
  scriptNodeId: string,
  assetType: AssetType,
  assetName: string,
  imageUrl: string
): boolean {
  const imageNodeId = getAssetImageNodeId(scriptNodeId, assetType, assetName);

  if (!imageNodeId) {
    console.warn('[AssetImageSync] 未找到图片节点关联:', {
      scriptNodeId,
      assetType,
      assetName,
    });
    return false;
  }

  const store = useCanvasStore.getState();
  const imageNode = store.nodes.find(n => n.id === imageNodeId);

  if (!imageNode) {
    console.warn('[AssetImageSync] 图片节点不存在:', imageNodeId);
    return false;
  }

  // 更新节点的 imageUrl 和状态
  store.updateNodeData(imageNodeId, {
    imageUrl,
    status: 'success',
  } as any);

  // 走到这里说明这张图是**用户提供的原图**（本函数只被上传/导入/关联资产这些路径调用；
  // 生成结果是从 SSE 回写节点 data 的，不经过这里）。记一笔并把原图落到参考图节点上，
  // 否则「资产卡片 AI生成」这条路的提示词里没有 @ 引用，后端拿不到参考图 = 纯文生图，
  // 生成结果跟用户上传的原图对不上（详见 ensureAssetReferenceNode 的说明）。
  rememberAssetSourceImage(imageNodeId, imageUrl);

  console.log('[AssetImageSync] 更新图片节点 URL 成功:', {
    imageNodeId,
    imageUrl,
  });

  return true;
}

/**
 * ✅ 新函数：直接更新资产的 nodeId 字段
 */
function updateAssetImageNodeId(
  scriptNodeId: string,
  assetType: AssetType,
  assetName: string,
  imageNodeId: string
): void {
  const store = useCanvasStore.getState();
  const scriptNode = store.nodes.find(n => n.id === scriptNodeId);

  if (!scriptNode || scriptNode.type !== 'script') {
    return;
  }

  const scriptData = scriptNode.data as any;
  const typeMap = {
    character: 'characters',
    scene: 'scenes',
    prop: 'props',
  };

  const mappingType = typeMap[assetType];
  const assetArray = scriptData[mappingType] as any[];

  if (!assetArray) {
    console.warn('[AssetImageSync] 资产数组不存在:', mappingType);
    return;
  }

  // 找到对应资产并更新 nodeId
  const updatedAssets = assetArray.map(asset => {
    if (asset.name === assetName) {
      return { ...asset, nodeId: imageNodeId };
    }
    return asset;
  });

  // 更新脚本节点数据
  store.updateNodeData(scriptNodeId, {
    [mappingType]: updatedAssets,
  } as any);

  console.log('[AssetImageSync] 更新资产 nodeId 成功:', {
    scriptNodeId,
    assetType,
    assetName,
    nodeId: imageNodeId,
  });
}

/**
 * 把画布上已存在的图片节点关联到指定资产
 * - 写入资产的 nodeId 字段（关联的本质字段，节点 ID 无需符合任何命名规则）
 * - 同时把 assetType/assetName/scriptNodeId 写进节点 data（后端识别资产图用）
 * - 自动补建 dataFlow 边（图片节点 → 脚本节点，非必须但利于上游展示与 fallback）
 * 注意：画布持久化由调用方负责（保存画布后后端才能读到新关联）
 *
 * @returns 是否关联成功
 */
export function associateExistingImageNode(
  scriptNodeId: string,
  assetType: AssetType,
  assetName: string,
  imageNodeId: string
): boolean {
  const store = useCanvasStore.getState();

  const imageNode = store.nodes.find(n => n.id === imageNodeId);
  if (!imageNode) {
    console.error('[AssetImageSync] 待关联的图片节点不存在:', imageNodeId);
    return false;
  }

  // 写入资产 nodeId
  updateAssetImageNodeId(scriptNodeId, assetType, assetName, imageNodeId);
  // 同时把资产归属写进节点 data：后端据此识别「这是资产图」（不再靠 id 前缀）
  stampAssetFields(imageNodeId, assetType, assetName, scriptNodeId);

  // 补建连接边（已存在则跳过）
  const edgeId = `e-${imageNodeId}-${scriptNodeId}`;
  if (!store.edges.some(e => e.id === edgeId)) {
    store.addEdge({
      id: edgeId,
      source: imageNodeId,
      target: scriptNodeId,
      type: 'dataFlow',
    });
  }

  console.log('[AssetImageSync] 关联已有图片节点成功:', {
    scriptNodeId,
    assetType,
    assetName,
    imageNodeId,
  });
  return true;
}

/**
 * 删除资产图片节点并清除关联
 * - 删除图片节点
 * - 删除连接边
 * - ✅ 清除资产的 imageNodeId 字段
 */
export function removeAssetImageNode(
  scriptNodeId: string,
  assetType: AssetType,
  assetName: string
): boolean {
  const imageNodeId = getAssetImageNodeId(scriptNodeId, assetType, assetName);

  if (!imageNodeId) {
    console.warn('[AssetImageSync] 未找到图片节点关联，无需删除');
    return false;
  }

  const store = useCanvasStore.getState();

  // 删除节点（自动删除连接边）
  store.removeNodes([imageNodeId]);

  // ✅ 新逻辑：清除资产的 imageNodeId
  clearAssetImageNodeId(scriptNodeId, assetType, assetName);

  console.log('[AssetImageSync] 删除图片节点成功:', {
    imageNodeId,
    scriptNodeId,
    assetType,
    assetName,
  });

  return true;
}

/**
 * ✅ 新函数：清除资产的 nodeId 字段
 */
function clearAssetImageNodeId(
  scriptNodeId: string,
  assetType: AssetType,
  assetName: string
): void {
  const store = useCanvasStore.getState();
  const scriptNode = store.nodes.find(n => n.id === scriptNodeId);

  if (!scriptNode || scriptNode.type !== 'script') {
    return;
  }

  const scriptData = scriptNode.data as any;
  const typeMap = {
    character: 'characters',
    scene: 'scenes',
    prop: 'props',
  };

  const mappingType = typeMap[assetType];
  const assetArray = scriptData[mappingType] as any[];

  if (!assetArray) {
    return;
  }

  // 找到对应资产并清除 nodeId
  const updatedAssets = assetArray.map(asset => {
    if (asset.name === assetName) {
      return { ...asset, nodeId: undefined };
    }
    return asset;
  });

  // 更新脚本节点数据
  store.updateNodeData(scriptNodeId, {
    [mappingType]: updatedAssets,
  } as any);

  console.log('[AssetImageSync] 清除资产 nodeId 成功:', {
    scriptNodeId,
    assetType,
    assetName,
  });
}

// ✅ 旧的 updateAssetImageMapping 和 clearAssetImageMapping 函数已删除
// 现在直接使用资产的 nodeId 字段，不需要额外的 mapping 表

// ==================== 资产「原图」参考图节点 ====================
//
// 为什么要有这么一类节点：
//
// 「资产卡片 → AI生成」这条路是**写回资产自己的图片节点**的：生成结果由 SSE 回写
// node.data.imageUrl，AssetPreparationPanel 的上传路径（updateAssetImageNodeUrl）
// 在回填时也会覆盖同一个字段。而参考图只能由后端从**某个节点的 data.imageUrl** 里取
// （executor.go 的 mentions 分支：按 mentions[].nodeId 查 nodeDataByID 再读 imageUrl）。
// 也就是说：生成一次，用户上传的原图就从这个节点上没了 —— 再想让「以原图为参考」
// 生效，原图必须另存到一个生成永远不会碰的节点上。这个节点就是本节的「参考图节点」。
//
// 两条约定（都是"弄错就等于丢用户原图/参考图静默失效"的）：
//  1. **参考图节点只由上传/导入/关联路径写入**（rememberAssetSourceImage），生成路径一律不碰它；
//  2. 参考图节点**不能**带 scriptNodeId/assetType/assetName 那套资产归属字段 ——
//     findAssetImageNode 的第二级判据正是按这三个字段反查「这个资产用哪个图片节点」，
//     带上就会被当成资产图片节点（线上出过同款：一个资产两个图片节点，有结果的那个没人认领）。

/**
 * 参考图节点的 data 标记：值是它备份的**资产图片节点 id**（反向找参考图节点用）。
 * 刻意不用资产归属字段，理由见本节开头第 2 条。
 */
const ASSET_REF_MARKER = 'assetRefOf';

/**
 * 资产图片节点上记录「用户提供的原图 URL」的字段名。
 *
 * 为什么不直接拿节点当前的 imageUrl 当原图：生成结果会覆盖 imageUrl，
 * 下一次生成就分不清"当前这张是原图还是上一次的生成结果"了 —— 判成原图就等于
 * 把生成结果当参考图喂回去、同时把真原图丢掉。这里记的是**上传/导入/关联时**那份，与生成无关。
 */
const ASSET_SOURCE_URL_FIELD = 'assetSourceImageUrl';

/** 参考图节点的 data 结构（字段是动态写的，读的时候窄取一次） */
function refMarkerOf(node: LibTVNode): string | undefined {
  const v = (node.data as Record<string, unknown> | undefined)?.[ASSET_REF_MARKER];
  return typeof v === 'string' ? v : undefined;
}

/** 参考图节点要备份的原图 URL（没记过就是空） */
function sourceUrlOf(imageNode: LibTVNode): string {
  const v = (imageNode.data as Record<string, unknown> | undefined)?.[ASSET_SOURCE_URL_FIELD];
  return typeof v === 'string' ? v : '';
}

/**
 * 找某个资产图片节点的参考图节点（按节点 data 上的 assetRefOf 反查）。
 * 一个资产图理论上只有一个参考图节点；异常情况下留下多个时优先取有图的那个。
 */
export function findAssetReferenceNode(imageNodeId: string): LibTVNode | null {
  const store = useCanvasStore.getState();
  // n.id !== imageNodeId：排除「参考图节点自己被关联成了资产图片节点」这种极端情况 ——
  // 不排除它就等于"自己给自己当参考图"，而生成会把结果写回这个节点，原图就没了；
  // 排除后走首次建节点那条分支，会另建一个参考图节点装原图，原图仍然安全。
  const matches = store.nodes.filter(n => refMarkerOf(n) === imageNodeId && n.id !== imageNodeId);
  if (matches.length === 0) return null;
  return matches.find(n => Boolean((n.data as { imageUrl?: string })?.imageUrl)) ?? matches[0];
}

/** 补一条 dataFlow 边（方向：**参考图节点 → 资产图片节点**，与 imageOpsNodes 的派生节点一致） */
function ensureReferenceEdge(refNodeId: string, imageNodeId: string): void {
  const store = useCanvasStore.getState();
  const edgeId = `e-${refNodeId}-${imageNodeId}`;
  if (store.edges.some(e => e.id === edgeId)) return;
  const edge: LibTVEdge = {
    id: edgeId,
    source: refNodeId,
    target: imageNodeId,
    type: 'dataFlow',
  };
  store.addEdge(edge);
}

/**
 * 记下「这张图是这个资产的**用户原图**」（上传 / 从资产库导入 / 关联已有节点三条路径调用），
 * 并把它同步到参考图节点上。
 *
 * 为什么在写入时就把原图镜像出去、而不是等到生成时再判断：写入这一刻是**唯一**
 * 确知"这张图来自用户"的时刻。等到生成时再看节点上的图，就只能靠猜（见 ASSET_SOURCE_URL_FIELD 注释）。
 *
 * 参考图节点此刻还不存在就只记字段（不在上传时就往画布上塞节点，避免每个上传过的资产都多一个节点）；
 * 真正建节点在生成前由 ensureAssetReferenceNode 完成。
 */
export function rememberAssetSourceImage(imageNodeId: string, url: string): void {
  if (!imageNodeId || !url) return;
  const store = useCanvasStore.getState();
  const imageNode = store.nodes.find(n => n.id === imageNodeId);
  if (!imageNode) {
    console.warn('[AssetImageSync] 记录资产原图失败：图片节点不存在:', imageNodeId);
    return;
  }

  if (sourceUrlOf(imageNode) !== url) {
    store.updateNodeData(imageNodeId, { [ASSET_SOURCE_URL_FIELD]: url } as never);
  }

  // 已有参考图节点：跟着换成新原图（用户重传/换了一张），并补回可能被删掉的边 ——
  // 没有边，后端就拿不到这张参考图（executor.go 只在有 mentions 时才按 @ 引用取图，
  // 边是 fallback 通道，两条都留着才稳，与 imageOpsNodes 的约定一致）
  const existing = findAssetReferenceNode(imageNodeId);
  if (existing) {
    if ((existing.data as { imageUrl?: string })?.imageUrl !== url) {
      store.updateNodeData(existing.id, { imageUrl: url } as never);
    }
    ensureReferenceEdge(existing.id, imageNodeId);
  }
}

/** ensureAssetReferenceNode 的返回值：提示词占位符、mentions、@ 标签要用的三样东西 */
export interface AssetReferenceNodeInfo {
  /** 参考图节点 id：prompt 里的 `[[m:<nodeId>]]` 与 mentions[].nodeId 都用它 */
  nodeId: string;
  /** 参考图节点上的图 URL */
  imageUrl: string;
  /** @ 标签的显示文本 */
  label: string;
}

/**
 * 生成前确保「资产原图」有一个生成不会覆盖的落点，返回参考图节点信息。
 *
 * 三种情形：
 *  1. 记过原图（ASSET_SOURCE_URL_FIELD 有值）→ 建节点 / 刷新图（用户可以重传原图）；
 *  2. 没记过原图、但已经有参考图节点 → **直接沿用，绝不拿节点当前的图去覆盖它**。
 *     这条是"安全第一"的兜底：参考图节点的内容只可能来自用户（第 1 条），
 *     而节点当前的图可能是上一次的生成结果，覆盖就等于把原图换成生成结果 —— 丢原图；
 *  3. 没记过原图、也没有参考图节点 → 首次生成，此时节点上这张图只能来自用户
 *     （本流程还没有往这个节点生成过），把它当原图收下，老画布（本次改动前上传的）也能受益。
 *
 * @returns 没有原图可依据时返回 null（调用方就按纯文生图走，不要拼参考图占位符）
 */
export function ensureAssetReferenceNode(imageNodeId: string): AssetReferenceNodeInfo | null {
  const store = useCanvasStore.getState();
  const imageNode = store.nodes.find(n => n.id === imageNodeId);
  if (!imageNode) {
    console.warn('[AssetImageSync] 建参考图节点失败：资产图片节点不存在:', imageNodeId);
    return null;
  }

  const existing = findAssetReferenceNode(imageNodeId);
  const recorded = sourceUrlOf(imageNode);
  const currentUrl = ((imageNode.data as { imageUrl?: string })?.imageUrl) || '';

  // 情形 2：已有参考图节点又没有新的原图记录 —— 原样沿用（这一步拦住的正是"丢原图"）
  if (!recorded && existing) {
    const existingUrl = ((existing.data as { imageUrl?: string })?.imageUrl) || '';
    // 参考图节点上没有图（用户清过/换过）就没有参考图可用，别给 prompt 里留个指向空节点的 @ 引用
    if (!existingUrl) return null;
    ensureReferenceEdge(existing.id, imageNodeId);
    return {
      nodeId: existing.id,
      imageUrl: existingUrl,
      label: ((existing.data as { label?: string })?.label) || '原图',
    };
  }

  // 情形 3：首次收到原图（这里是唯一"看一眼节点当前这张图"的地方）。
  // currentUrl 为空（用户没上传过）就直接放弃，不建空节点
  const url = recorded || currentUrl;
  if (!url) return null;

  if (existing) {
    if (((existing.data as { imageUrl?: string })?.imageUrl) !== url) {
      store.updateNodeData(existing.id, { imageUrl: url } as never);
    }
    ensureReferenceEdge(existing.id, imageNodeId);
    return {
      nodeId: existing.id,
      imageUrl: url,
      label: ((existing.data as { label?: string })?.label) || '原图',
    };
  }

  // 建节点：摆在资产图片节点左侧一屏（与资产图节点 ← 脚本节点的排布同向，一眼看出"这张是参考图"）。
  // 位置按**绝对坐标**算：资产图节点在组合里时 position 是相对组合的，直接减会把它放到别处。
  const origin = absolutePositionIn(store.nodes, imageNode);
  const label = `${(imageNode.data as { label?: string })?.label || '图片'}·原图`;
  const refNode = createNode(
    'image',
    { x: origin.x - 360, y: origin.y },
    {
      data: {
        label,
        prompt: '',
        imageUrl: url,
        // 缩略图按约定推到 .thumb.webp（推不出来时 undefined，ImageNode 会回退原图）
        thumbUrl: deriveThumbUrl(url),
        status: 'success',
        [ASSET_REF_MARKER]: imageNodeId,
      } as Partial<ImageNodeData>,
    },
  );

  const edge: LibTVEdge = {
    id: `e-${refNode.id}-${imageNodeId}`,
    source: refNode.id,
    target: imageNodeId,
    type: 'dataFlow',
  };
  // 一次 addNodesAndEdges = 一条撤销历史（canvasStore 里一个 set 调一次 saveHistory），
  // 用户按一次 ⌘Z 就把"参考图节点 + 边"整体退掉，与 imageOpsNodes 的派生节点同一套约定
  store.addNodesAndEdges([refNode], [edge]);

  console.log('[AssetImageSync] 创建资产参考图节点成功:', {
    imageNodeId,
    refNodeId: refNode.id,
    url,
  });

  return { nodeId: refNode.id, imageUrl: url, label };
}
