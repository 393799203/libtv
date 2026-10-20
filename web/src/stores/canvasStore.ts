import { create } from 'zustand';
import { deriveThumbUrl } from '@/utils/thumbUrl';
import { createNode } from '@/utils/nodeFactory';
import { buildGroupFromSelection, nodeSizeOf, normalizeGroups, releaseGroupMembers } from '@/utils/canvasGroups';
import { mediaFieldsFor, type MediaPayload } from '@/utils/mediaNode';
import type { CanvasData, LibTVNode, LibTVEdge, NodeExecutionStatus, ScriptAssetItem, NodeType } from '@/types/canvas';
import {
  applyNodeChanges,
  applyEdgeChanges,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type Connection,
  type NodeChange,
  type EdgeChange,
  type Viewport,
  type XYPosition,
} from '@xyflow/react';

/** 脚本资产引用的清理目标 */
interface AssetRefCleanup {
  scriptNodeId: string;
  dataType: string;
  assetName: string;
}

/**
 * 反查「哪些脚本资产引用了这些即将被删除的节点」。
 *
 * 为什么反查而不是从被删节点的 id 里解析「我是谁的图」：
 * - id 只是标识符，不承载语义（历史格式 `角色-南方-script-123` 已废弃）
 * - 关联方式不止一种：新建资产图节点、把画布上已有的图片节点关联到资产；
 *   后者节点 id 完全不含资产信息，只有反查资产侧的 nodeId 才覆盖得到
 * - 资产 nodeId 可指向图片/视频等任何节点类型，所以不按被删节点类型过滤
 */
function findAssetRefsToClear(nodes: LibTVNode[], removedIds: Set<string>): AssetRefCleanup[] {
  if (removedIds.size === 0) return [];
  const cleanups: AssetRefCleanup[] = [];
  for (const scriptNode of nodes) {
    if (scriptNode.type !== 'script') continue;
    const scriptData = scriptNode.data as Record<string, unknown>;
    for (const dataType of ASSET_ARRAY_FIELDS) {
      const assets = scriptData[dataType];
      if (!Array.isArray(assets)) continue;
      for (const asset of assets as ScriptAssetItem[]) {
        if (asset.nodeId && removedIds.has(asset.nodeId)) {
          cleanups.push({ scriptNodeId: scriptNode.id, dataType, assetName: asset.name });
          console.log('[CanvasStore] 清除资产 nodeId 引用:', {
            scriptNodeId: scriptNode.id,
            dataType,
            assetName: asset.name,
            removedNodeId: asset.nodeId,
          });
        }
      }
    }
  }
  return cleanups;
}

/**
 * 把「清掉资产 nodeId」写回脚本节点：nodes 数组、script 节点、data、assets 数组、
 * asset 对象每一层都新建 —— 这些对象被历史快照浅引用共享，原地写会污染历史导致 undo 失效。
 */
function clearAssetRefsInNodes(nodes: LibTVNode[], cleanups: AssetRefCleanup[]): LibTVNode[] {
  return nodes.map((node) => {
    if (node.type !== 'script') return node;
    const targets = cleanups.filter((t) => t.scriptNodeId === node.id);
    if (targets.length === 0) return node;

    const newData: Record<string, unknown> = { ...node.data };
    for (const { dataType, assetName } of targets) {
      const assets = newData[dataType];
      if (!Array.isArray(assets)) continue;
      newData[dataType] = assets.map((a: ScriptAssetItem) =>
        a.name === assetName ? { ...a, nodeId: undefined } : a,
      );
    }
    return { ...node, data: newData as LibTVNode['data'] };
  });
}

const MAX_HISTORY = 50;

/** 脚本节点里存放三类资产的数组字段（assetType → 该字段的映射见 utils/assetImageSync.ts） */
const ASSET_ARRAY_FIELDS = ['characters', 'scenes', 'props'] as const;

// ========== 项目级画布数据（按项目隔离）==========

interface HistorySnapshot {
  nodes: LibTVNode[];
  edges: LibTVEdge[];
}

interface ProjectCanvasData {
  nodes: LibTVNode[];
  edges: LibTVEdge[];
  selectedNodeIds: string[];
  selectedEdgeIds: string[];
  history: HistorySnapshot[];
  future: HistorySnapshot[];
  /** 保存时的视口位置，下次加载时恢复 */
  savedViewport: { x: number; y: number; zoom: number };
  /** 当前操作是否应跳过历史记录（per-project） */
  skipHistory: boolean;
}

function createEmptyProjectData(): ProjectCanvasData {
  return {
    nodes: [],
    edges: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
    history: [],
    future: [],
    savedViewport: { x: 0, y: 0, zoom: 1 },
    skipHistory: false,
  };
}

// ========== 工作区全局状态 ==========

interface WorkspaceUIState {
  projectId: string | null;
  isDirty: boolean;
  isSaving: boolean;
  /** 是否正在从服务端加载数据（true 时组件显示 loading） */
  isLoading: boolean;

  setProjectId: (id: string) => void;
  setDirty: (dirty: boolean) => void;
  setSaving: (saving: boolean) => void;
}

// ========== 合并后的完整 Store 接口 ==========

interface CanvasState extends WorkspaceUIState {
  // 当前活跃项目的画布数据（从 cache 映射出来的快捷访问）
  nodes: LibTVNode[];
  edges: LibTVEdge[];
  selectedNodeIds: string[];
  selectedEdgeIds: string[];
  canUndo: boolean;
  canRedo: boolean;

  // 内部缓存（不直接暴露给组件使用）
  _cache: Map<string, ProjectCanvasData>;

  // React Flow 回调
  onNodesChange: OnNodesChange<LibTVNode>;
  onEdgesChange: OnEdgesChange<LibTVEdge>;
  onConnect: OnConnect;
  /** 建立连线的唯一入口（组合会被摊成成员；目标是组合则不建）。所有连线路径都必须走它 */
  connectNodes: (
    source: string,
    target: string,
    handles?: { sourceHandle?: string | null; targetHandle?: string | null }
  ) => void;

  // 节点操作
  addNode: (node: LibTVNode) => void;
  /**
   * 在指定坐标创建一个媒体节点（图片/视频/音频）并自动选中。
   * 「把一份媒体放到画布上」的所有拖放类入口都走这里：字段由 mediaFieldsFor 统一产出，
   * 避免各处手拼导致派生缩略图漏写（历史 bug：节点显示上一版小图）。
   */
  createMediaNodeAt: (nodeType: NodeType, position: XYPosition, payload: MediaPayload) => LibTVNode;
  /**
   * 一次性加入一组节点 + 连线（空画布引导页的「场景」快捷创建用）。
   * 为什么必须批处理：addNode / addEdge 各自都会 saveHistory 一次，
   * 一个「文本→分镜」的场景要占 3 条历史 —— 用户按一次 Ctrl+Z 只回退掉半组，很难受。
   * 整组只走一次 saveHistory，一次撤销即可整组回退。
   */
  addNodesAndEdges: (nodes: LibTVNode[], edges: LibTVEdge[]) => void;
  removeNodes: (ids: string[]) => void;
  /**
   * 把当前选中的节点合成一个组合（框选后右键「组合」走这里）。
   * 少于 2 个可用节点时什么都不做并返回 false（调用方给提示）；
   * 选中的旧组合会被摊平成成员（组合只支持一层）。
   */
  groupSelectedNodes: () => boolean;
  /** 解除组合：成员回到绝对坐标并保持选中，组合节点本身删除 */
  ungroupNode: (groupId: string) => boolean;
  /**
   * 把成员摆到指定的**绝对中心**（拖动结束后按鼠标实际位移校准用）。
   * React Flow 对「父节点 + nodeOrigin=0.5」的子节点坐标换算，在框尺寸变化之后会有十几像素偏差，
   * 表现为拖成员时落点追不上鼠标；这里按鼠标位移把成员放回它该在的地方。
   */
  placeMemberAtAbsolute: (nodeId: string, abs: { x: number; y: number }) => void;
  /** 让每个组合框重新贴合成员（只改几何、不置脏）：拖动结束/删除节点/加载完成后调用 */
  syncGroupBounds: () => void;
  /**
   * 写节点 data。
   * opts.transient = true：**不进撤销历史**（也不清空 redo）——
   * 生成中/失败这类"过渡态"用；历史里只该有内容态（生成前 / 生成后）。
   */
  updateNodeData: (id: string, data: Partial<LibTVNode['data']>, opts?: { transient?: boolean }) => void;
  updateNodeStatus: (id: string, status: NodeExecutionStatus) => void;
  /** 只更新执行进度文案（SSE 高频回调专用）：不进历史、不置 isDirty */
  updateNodeProgress: (id: string, progressMessage: string | undefined) => void;
  /** 回写节点的派生元数据（媒体尺寸/时长等由文件本身测出来的值）：不进历史、不置 isDirty */
  updateNodeMeta: (id: string, data: Partial<LibTVNode['data']>) => void;

  // 视口持久化
  saveViewport: (viewport: Viewport) => void;

  // 边操作
  addEdge: (edge: LibTVEdge) => void;
  removeEdges: (ids: string[]) => void;

  // 画布加载/导出
  loadCanvas: (data: CanvasData) => void;
  exportCanvas: () => CanvasData;
  clearCanvas: () => void;

  // 撤销/重做
  undo: () => void;
  redo: () => void;
}

// ========== 变更批处理队列（模块级，所有项目共享）==========

let nodeChangeQueue: NodeChange<LibTVNode>[] = [];
let edgeChangeQueue: EdgeChange<LibTVEdge>[] = [];
let flushTimer: ReturnType<typeof queueMicrotask> | null = null;

function saveHistory(data: ProjectCanvasData): Pick<ProjectCanvasData, 'history' | 'future'> & { canUndo: boolean; canRedo: boolean } {
  const snapshot: HistorySnapshot = { nodes: data.nodes, edges: data.edges };

  if (data.history.length > 0) {
    const last = data.history[0];
    // 轻量对比：引用相等 + 长度一致 → 数据未变（避免 JSON.stringify 全量序列化）
    if (last.nodes === snapshot.nodes && last.edges === snapshot.edges) {
      return {} as any;
    }
    // 引用不同时，用长度 + 关键字段快速比对（覆盖拖拽/选中等高频场景）
    if (last.nodes.length === snapshot.nodes.length && last.edges.length === snapshot.edges.length) {
      let unchanged = true;
      for (let i = 0; i < last.nodes.length && unchanged; i++) {
        const a = last.nodes[i];
        const b = snapshot.nodes[i];
        // data 用引用比对：store 内均为不可变更新，data 内容变则引用必变
        if (a.id !== b.id || a.position.x !== b.position.x || a.position.y !== b.position.y ||
            a.selected !== b.selected || a.measured?.width !== b.measured?.width ||
            a.measured?.height !== b.measured?.height || a.data !== b.data) {
          unchanged = false;
        }
      }
      for (let i = 0; i < last.edges.length && unchanged; i++) {
        if (last.edges[i].id !== snapshot.edges[i].id || last.edges[i].selected !== snapshot.edges[i].selected) {
          unchanged = false;
        }
      }
      if (unchanged) return {} as any;
    }
  }

  // 确实有变化时才深拷贝存入历史（延迟拷贝，无变化时不分配内存）
  return {
    history: [{ nodes: [...snapshot.nodes], edges: [...snapshot.edges] }, ...data.history].slice(0, MAX_HISTORY),
    future: [],
    canUndo: true,
    canRedo: false,
  };
}

/**
 * 判断 NodeChange 是否为节点变化（非选中状态变更）
 * 用于 syncSelectIds 中区分 node select 和 edge select
 */
function isNodePositionOrDimensionChange(c: Record<string, unknown>): boolean {
  return 'position' in c || 'dimensions' in c || 'dragging' in c;
}

function scheduleFlush(
  _get: () => CanvasState,
  set: (fn: (state: CanvasState) => Partial<CanvasState>) => void,
) {
  if (flushTimer !== null) return;
  flushTimer = queueMicrotask(() => {
    flushTimer = null;
    const nChanges = nodeChangeQueue;
    const eChanges = edgeChangeQueue;
    nodeChangeQueue = [];
    edgeChangeQueue = [];

    if (nChanges.length === 0 && eChanges.length === 0) return;

    set((state) => {
      const pid = state.projectId;
      if (!pid || state.isLoading) return {};

      const cache = new Map(state._cache);
      let data = cache.get(pid);
      if (!data) data = createEmptyProjectData();

      // skipHistory 是一次性兼容标记（undo/redo/执行状态更新时设置）：消费掉即可，
      // 记录决策完全由下面的变更类型门控决定——否则在没有 RF 回显时标记会残留，
      // 吞掉用户的下一次真实操作（该操作不进历史且 future 不被清空）
      if (data.skipHistory) {
        data.skipHistory = false;
      }

      // 按变更类型决定是否进 undo 历史：
      // - select：纯 UI 状态，不记（撤销选中没有意义，还会让 undo 看起来"没反应"）
      // - position：仅拖动结束帧（dragging === false）——一次拖动只产生一条记录
      // - dimensions：仅手动调整大小的结束帧（resizing === false，NodeResizer）；
      //   RF 被动测量回显（无 resizing 标志）不记——否则 undo/redo 后的重新测量
      //   会污染历史并清掉 future，导致 redo 失效
      // - add / remove：记录
      const isRecordable = (c: NodeChange<LibTVNode> | EdgeChange<LibTVEdge>): boolean => {
        if (c.type === 'select') return false;
        if (c.type === 'position') return c.dragging === false;
        if (c.type === 'dimensions') return (c as { resizing?: boolean }).resizing === false;
        return true;
      };
      const shouldRecord = nChanges.some(isRecordable) || eChanges.some(isRecordable);

      if (nChanges.length > 0) {
        // React Flow 自己的删除（选中后按 Delete 键）也从这里进来：先把被删节点留一份，
        // 组合归一化换算成员绝对坐标时要用它们（理由同 removeNodes 里的注释）
        const removedIdSet = new Set(
          nChanges.filter((c) => c.type === 'remove').map((c) => (c as { id: string }).id)
        );
        const removedNodes = removedIdSet.size > 0
          ? data.nodes.filter((n) => removedIdSet.has(n.id))
          : [];

        data.nodes = applyNodeChanges(nChanges, data.nodes);
        syncSelectIds(nChanges, eChanges, data);
        // 清理已删除节点的选中状态（避免残留 ID 导致选中判断异常）
        const currentIds = new Set(data.nodes.map((n) => n.id));
        if (data.selectedNodeIds.some((id) => !currentIds.has(id))) {
          data.selectedNodeIds = data.selectedNodeIds.filter((id) => currentIds.has(id));
        }
        // 组合框贴合成员。⚠️ 拖动中的中间帧**不能**动它：那会在拖拽循环里改成员的相对坐标，
        // 与 React Flow 每帧写回的拖拽位置互相覆盖（表现为框抖/节点跳位）。
        // 只处理「落点帧」（dragging === false）以及节点增删。
        const draggingFrame = nChanges.some((c) => c.type === 'position' && c.dragging === true);
        const touchesGroups = nChanges.some(
          (c) =>
            c.type === 'add' ||
            c.type === 'remove' ||
            // ⚠️ 这里刻意不含「position 且 dragging=false」这一帧：拖动结束那一帧 React Flow 会在
            // 同一个 tick 里再补写一次子节点的 position（它按自己的换算重算），会把我们刚算好的
            // 成员相对坐标覆盖掉，导致被拖的成员最后落到鼠标之外。贴合改由 onNodeDragStop 负责
            // （延迟一帧执行，等 RF 的迟到写入落地）。add/remove/dimensions 仍然即时贴合。

            // 尺寸回显（React Flow 测出来的 measured）也算：成组时若成员还没测出尺寸，
            // 框是按兜底尺寸算的，这里顺手按真实尺寸修正一次（幂等，无变化不写）
            c.type === 'dimensions'
        );
        if (touchesGroups && !draggingFrame) {
          data.nodes = normalizeGroups(data.nodes, removedNodes);
        }
      }
      if (eChanges.length > 0) {
        data.edges = applyEdgeChanges(eChanges, data.edges);
      }

      const updates: Partial<CanvasState> = {};

      if (shouldRecord) {
        const hist = saveHistory(data);
        Object.assign(data, hist);
        updates.isDirty = true;
      }

      cache.set(pid, data);

      return { _cache: cache, ...updates, ...syncFromCache(pid, cache) };
    });
  });
}

/**
 * 同步选中状态：从 changes 中提取 select 类型变化，分别更新 selectedNodeIds / selectedEdgeIds
 * 通过 changes 数组的来源（nChanges vs eChanges）精确判断是节点还是边
 */
function syncSelectIds(
  nChanges: NodeChange<LibTVNode>[],
  eChanges: EdgeChange<LibTVEdge>[],
  data: ProjectCanvasData,
): void {
  // 节点的 select 变化
  const nodeSelChanges = nChanges.filter(
    (c): c is NodeChange<LibTVNode> & { type: 'select'; id: string; selected: boolean } =>
      c.type === 'select' && 'id' in c && 'selected' in c,
  );
  let nodeIds = [...data.selectedNodeIds];
  for (const c of nodeSelChanges) {
    if (c.selected) {
      if (!nodeIds.includes(c.id)) nodeIds.push(c.id);
    } else {
      nodeIds = nodeIds.filter((id) => id !== c.id);
    }
  }
  data.selectedNodeIds = nodeIds;

  // 边的 select 变化
  const edgeSelChanges = eChanges.filter(
    (c): c is EdgeChange<LibTVEdge> & { type: 'select'; id: string; selected: boolean } =>
      c.type === 'select' && 'id' in c && 'selected' in c,
  );
  let edgeIds = [...data.selectedEdgeIds];
  for (const c of edgeSelChanges) {
    if (c.selected) {
      if (!edgeIds.includes(c.id)) edgeIds.push(c.id);
    } else {
      edgeIds = edgeIds.filter((id) => id !== c.id);
    }
  }
  data.selectedEdgeIds = edgeIds;
}

/**
 * 从 cache 中读取指定项目的数据，返回可展平到顶层的状态
 */
function syncFromCache(
  projectId: string,
  cache: Map<string, ProjectCanvasData>,
): Partial<CanvasState> {
  const data = cache.get(projectId) || createEmptyProjectData();
  return {
    nodes: data.nodes,
    edges: data.edges,
    selectedNodeIds: data.selectedNodeIds,
    selectedEdgeIds: data.selectedEdgeIds,
    // history[0] 是当前状态快照，至少要有一条更早的历史才可撤销
    canUndo: data.history.length > 1,
    canRedo: data.future.length > 0,
  };
}

// ========== Store 创建 ==========

export const useCanvasStore = create<CanvasState>((set, get) => ({
  // --- 工作区状态 ---
  projectId: null,
  isDirty: false,
  isSaving: false,
  isLoading: false,

  // --- 项目画布缓存 ---
  _cache: new Map<string, ProjectCanvasData>(),

  // --- 当前画布数据（初始空） ---
  nodes: [],
  edges: [],
  selectedNodeIds: [],
  selectedEdgeIds: [],
  canUndo: false,
  canRedo: false,

  // --- 工作区操作 ---
  /**
   * 切换项目：
   * 1. 把当前项目数据存回 cache
   * 2. 清空顶层显示（nodes=[]），设置 isLoading=true
   * 3. 等待 loadCanvas() 从服务端加载数据后才会显示内容
   *
   * 这样避免了"先闪旧缓存/空白，再被API覆盖"的问题
   */
  setProjectId: (id: string) => {
    set((state) => {
      if (state.projectId === id) return {};

      const cache = new Map(state._cache);

      // 把当前项目的数据保存回 cache（含视口位置）
      if (state.projectId) {
        const currentData = cache.get(state.projectId) || createEmptyProjectData();
        currentData.nodes = state.nodes;
        currentData.edges = state.edges;
        currentData.selectedNodeIds = state.selectedNodeIds;
        currentData.selectedEdgeIds = state.selectedEdgeIds;
        cache.set(state.projectId, currentData);
      }

      // 目标项目：确保在 cache 中有占位，但不清空显示 — 由 loadCanvas 填充
      if (!cache.has(id)) {
        cache.set(id, createEmptyProjectData());
      }

      return {
        projectId: id,
        isDirty: false,
        isLoading: true,       // 标记正在加载，Canvas 组件会显示 loading
        nodes: [],             // 先清空，等 API 返回后再填充
        edges: [],
        selectedNodeIds: [],
        selectedEdgeIds: [],
        canUndo: false,
        canRedo: false,
        _cache: cache,
      };
    });
  },

  setDirty: (dirty: boolean) => set({ isDirty: dirty }),
  setSaving: (saving: boolean) => set({ isSaving: saving }),

  // --- React Flow 回调 ---
  onNodesChange: (changes: NodeChange<LibTVNode>[]) => {
    // ✅ 处理节点删除：清掉脚本资产对被删节点的引用（asset.nodeId）
    // 只收集清理目标，不做原地 mutation —— scriptData[dataType] 数组和 asset 对象被历史快照
    // 浅引用共享，原地写会污染所有历史条目导致 undo 无法恢复；写回由 clearAssetRefsInNodes 统一做。
    const removeChanges = changes.filter(c => c.type === 'remove');
    const removedIds = new Set(removeChanges.map(c => (c as { id: string }).id));
    const assetCleanups = findAssetRefsToClear(get().nodes, removedIds);

    // ✅ 统一不可变写回资产清理：nodes 数组、script 节点、data、assets 数组、asset
    // 对象每一层都新建。这里故意不调 saveHistory、不置 skipHistory —— 随后的
    // scheduleFlush 在微任务里应用 removeChanges 后才记录"变更后快照"，
    // 因此"节点删除 + 资产清理"会记成同一条历史，undo 一步同时回滚两者。
    if (assetCleanups.length > 0) {
      set((state) => {
        const pid = state.projectId;
        if (!pid || state.isLoading) return {};
        const cache = new Map(state._cache);
        const data = cache.get(pid);
        if (!data) return {};

        data.nodes = clearAssetRefsInNodes(data.nodes, assetCleanups);
        cache.set(pid, data);

        return { _cache: cache, ...syncFromCache(pid, cache) };
      });
    }

    nodeChangeQueue.push(...changes);
    scheduleFlush(get, set);
  },

  onEdgesChange: (changes: EdgeChange<LibTVEdge>[]) => {
    edgeChangeQueue.push(...changes);
    scheduleFlush(get, set);
  },

  onConnect: (connection: Connection) => {
    get().connectNodes(connection.source, connection.target, {
      sourceHandle: connection.sourceHandle,
      targetHandle: connection.targetHandle,
    });
  },

  /**
   * 建立连线的**唯一**入口。所有连线路径都要走这里 —— 之前画布上有两套：
   * store 的 onConnect（精确落在连接点上）和 Canvas 的 handleConnectEnd（落在目标节点任意位置，
   * 且拖到空白处弹菜单新建节点），后者直接 addEdge，于是「从组合拖出去」在那边又变回了
   * 组合自己被连出去（成员没摊开）。逻辑收在这里就不会再各写一份、各漏一处。
   *
   * 规则：
   * - 组合只有输出耳朵：它的连线在**每个成员**身上各落一条（组合自己没有内容、也不进执行计划）；
   * - 目标是组合 → 直接不建（组合是虚拟的，别的节点连进来没有意义）；
   * - 组合连自己的成员 = 自环，不建；已有同向边不重复建。
   */
  connectNodes: (source: string, target: string, handles) => {
    set((state) => {
      const pid = state.projectId;
      if (!pid || state.isLoading) return {};
      if (!source || !target || source === target) return {};
      const cache = new Map(state._cache);
      const data = cache.get(pid) || createEmptyProjectData();

      const nodeOf = (id: string) => data.nodes.find((n) => n.id === id);
      const srcNode = nodeOf(source);
      const dstNode = nodeOf(target);

      // 目标是组合：不建（虚拟节点只出不进）
      if (dstNode?.type === 'group') return {};
      // 自环防线：组合连自己的成员 / 成员连自己的组合
      const inside = (child?: { parentId?: string }, group?: { id: string; type?: string }) =>
        !!child?.parentId && !!group && group.type === 'group' && child.parentId === group.id;
      if (inside(dstNode, srcNode) || inside(srcNode, dstNode)) return {};

      // 起手是组合 → 摊成它的每个成员；否则就是它自己
      const expand = (id: string): string[] => {
        const n = nodeOf(id);
        if (n?.type !== 'group') return [id];
        return data.nodes.filter((m) => m.parentId === id && m.type !== 'group').map((m) => m.id);
      };

      const fresh: LibTVEdge[] = [];
      for (const s of expand(source)) {
        if (s === target) continue;
        if (data.edges.some((e) => e.source === s && e.target === target)) continue;
        fresh.push({
          id: `e-${s}-${target}`,
          source: s,
          target,
          sourceHandle: handles?.sourceHandle ?? undefined,
          targetHandle: handles?.targetHandle ?? undefined,
          type: 'dataFlow',
          animated: true,
        });
      }
      if (fresh.length === 0) return {};
      data.edges = [...data.edges, ...fresh];
      const hist = saveHistory(data);
      Object.assign(data, hist);
      cache.set(pid, data);

      return { _cache: cache, isDirty: true, ...syncFromCache(pid, cache) };
    });
  },

  // --- 节点操作 ---
  createMediaNodeAt: (nodeType, position, payload) => {
    const node = createNode(nodeType, position, {
      data: mediaFieldsFor(nodeType, payload) as never,
    });
    get().addNode(node);
    get().onNodesChange([{ type: 'select', id: node.id, selected: true }]);
    return node;
  },

  addNode: (node: LibTVNode) => {
    set((state) => {
      const pid = state.projectId;
      if (!pid || state.isLoading) return {};
      const cache = new Map(state._cache);
      let data = cache.get(pid) || createEmptyProjectData();

      data.nodes = [...data.nodes, node];
      const hist = saveHistory(data);
      Object.assign(data, hist);
      cache.set(pid, data);

      return { _cache: cache, isDirty: true, ...syncFromCache(pid, cache) };
    });
  },

  addNodesAndEdges: (nodes: LibTVNode[], edges: LibTVEdge[]) => {
    if (nodes.length === 0 && edges.length === 0) return;
    set((state) => {
      const pid = state.projectId;
      if (!pid || state.isLoading) return {};
      const cache = new Map(state._cache);
      const data = cache.get(pid) || createEmptyProjectData();

      data.nodes = [...data.nodes, ...nodes];
      data.edges = [...data.edges, ...edges];
      const hist = saveHistory(data);
      Object.assign(data, hist);
      cache.set(pid, data);

      return { _cache: cache, isDirty: true, ...syncFromCache(pid, cache) };
    });
  },

  removeNodes: (ids: string[]) => {
    const idSet = new Set(ids);
    set((state) => {
      const pid = state.projectId;
      if (!pid || state.isLoading) return {};
      const cache = new Map(state._cache);
      let data = cache.get(pid) || createEmptyProjectData();

      const removedNodes = data.nodes.filter((n) => idSet.has(n.id));
      data.nodes = data.nodes.filter((n) => !idSet.has(n.id));
      data.edges = data.edges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target));
      // 清理被删节点的选中状态
      data.selectedNodeIds = data.selectedNodeIds.filter((id) => !idSet.has(id));
      // 清掉脚本资产对被删节点的引用：右键「删除节点」等路径直接走这里、不经过
      // onNodesChange，所以清理必须两边都做（否则删掉资产图节点后资产仍指向悬空 id）
      data.nodes = clearAssetRefsInNodes(data.nodes, findAssetRefsToClear(data.nodes, idSet));
      // 组合收尾：删掉的是组合 → 成员摘出来回到绝对坐标（否则会画到别处/消失）；
      // 删掉的是成员 → 组合框重新贴合（成员删光的组合会被顺手删掉）。
      // 与资产清理同理，这条路不经过 onNodesChange，所以两边都要做。
      // removedNodes 必须传：成员的绝对坐标要按组合删除前的原点换算。
      data.nodes = normalizeGroups(data.nodes, removedNodes);
      const hist = saveHistory(data);
      Object.assign(data, hist);
      cache.set(pid, data);

      return { _cache: cache, isDirty: true, ...syncFromCache(pid, cache) };
    });
  },

  groupSelectedNodes: () => {
    const built = (() => {
      const state = get();
      if (!state.projectId || state.isLoading) return null;
      return buildGroupFromSelection(state.nodes, state.nodes.filter((n) => n.selected));
    })();
    if (!built) return false;

    set((state) => {
      const pid = state.projectId;
      if (!pid) return {};
      const cache = new Map(state._cache);
      const data = cache.get(pid) || createEmptyProjectData();

      const drop = new Set(built.removedGroupIds);
      const reparented = new Map(built.members.map((m) => [m.id, m]));
      const base = data.nodes.filter((n) => !drop.has(n.id)).map((n) => reparented.get(n.id) ?? n);
      // ⚠️ 组合节点必须排在它的成员**前面**：React Flow 是按数组顺序建父子索引的，
      // 父节点排在子节点后面时子节点算不出绝对坐标（控制台会报 "Parent node not found"），
      // 表现就是「拖组合只有框动、成员不动」。
      const firstMemberIdx = base.findIndex((n) => reparented.has(n.id));
      data.nodes = firstMemberIdx === -1
        ? [...base, built.group]
        : [...base.slice(0, firstMemberIdx), built.group, ...base.slice(firstMemberIdx)];
      // 成员坐标已按新组合原点换算过，这里再归一化一次兜底（幂等：无变化时不动数组）
      data.nodes = normalizeGroups(data.nodes);
      // 选中的旧组合节点没了，选中集合收敛到新组合
      data.selectedNodeIds = [built.group.id];
      const hist = saveHistory(data);
      Object.assign(data, hist);
      cache.set(pid, data);

      return { _cache: cache, isDirty: true, ...syncFromCache(pid, cache) };
    });
    return true;
  },

  ungroupNode: (groupId) => {
    const group = get().nodes.find((n) => n.id === groupId && n.type === 'group');
    if (!group) return false;

    set((state) => {
      const pid = state.projectId;
      if (!pid) return {};
      const cache = new Map(state._cache);
      const data = cache.get(pid) || createEmptyProjectData();

      const freed = releaseGroupMembers(data.nodes, group);
      const freedIds = new Set(freed.map((n) => n.id));
      data.nodes = data.nodes
        .filter((n) => n.id !== groupId)
        .map((n) => freed.find((f) => f.id === n.id) ?? n);
      data.selectedNodeIds = [...freedIds];
      const hist = saveHistory(data);
      Object.assign(data, hist);
      cache.set(pid, data);

      return { _cache: cache, isDirty: true, ...syncFromCache(pid, cache) };
    });
    return true;
  },

  placeMemberAtAbsolute: (nodeId, abs) => {
    set((state) => {
      const pid = state.projectId;
      if (!pid) return {};
      const cache = new Map(state._cache);
      const data = cache.get(pid);
      if (!data) return {};
      const node = data.nodes.find((n) => n.id === nodeId);
      const group = node?.parentId ? data.nodes.find((n) => n.id === node.parentId) : undefined;
      if (!node || !group || group.type !== 'group') return {};
      const gs = nodeSizeOf(group);
      const topLeft = { x: group.position.x - gs.w / 2, y: group.position.y - gs.h / 2 };
      const want = { x: abs.x - topLeft.x, y: abs.y - topLeft.y };
      if (want.x === node.position.x && want.y === node.position.y) return {};
      data.nodes = data.nodes.map((n) => (n.id === nodeId ? { ...n, position: want } : n));
      cache.set(pid, data);
      return { _cache: cache, ...syncFromCache(pid, cache) };
    });
  },

  syncGroupBounds: () => {
    set((state) => {
      const pid = state.projectId;
      if (!pid || state.isLoading) return {};
      const cache = new Map(state._cache);
      const data = cache.get(pid);
      if (!data) return {};
      const next = normalizeGroups(data.nodes);
      if (next === data.nodes) return {};   // 幂等：没变化就不写，避免多余的 re-render
      data.nodes = next;
      cache.set(pid, data);
      // 不置脏：这里只修几何（成员自己的位置/尺寸变更早就把画布标脏了），
      // 组合框本身不落库也能在下次加载时重新算出来
      return { _cache: cache, ...syncFromCache(pid, cache) };
    });
  },

  updateNodeData: (id: string, upd: Partial<LibTVNode['data']>, opts?: { transient?: boolean }) => {
    set((state) => {
      const pid = state.projectId;
      if (!pid || state.isLoading) return {};
      const cache = new Map(state._cache);
      let data = cache.get(pid) || createEmptyProjectData();

      data.nodes = data.nodes.map((node) => {
        if (node.id !== id) return node;
        const next = { ...upd } as Record<string, unknown>;
        const cur = node.data as Record<string, unknown>;

        // 产物换了就同步派生字段（画布展示优先用 thumbUrl / stillUrl）：
        // 只写 imageUrl / videoUrl 会让节点继续显示上一版的小图 —— 表现就是
        // 「重新生成成功后，节点上的缩略图还是老的」。调用方显式给了新值就尊重调用方。
        if (typeof next.imageUrl === 'string' && next.imageUrl && next.imageUrl !== cur.imageUrl) {
          if (next.thumbUrl === undefined) next.thumbUrl = deriveThumbUrl(next.imageUrl as string);
          // 旧图的尺寸不能沿用到新图上：调用方没给就让节点重新测
          if (next.width === undefined) next.width = undefined;
          if (next.height === undefined) next.height = undefined;
        }
        if (typeof next.videoUrl === 'string' && next.videoUrl && next.videoUrl !== cur.videoUrl) {
          // 视频换了：旧封面（stillUrl）画的是上一版视频，必须一并清掉，否则封面还是老的
          if (next.stillUrl === undefined) next.stillUrl = undefined;
        }

        return { ...node, data: { ...node.data, ...next } as LibTVNode['data'] };
      });
      // 过渡态不进历史：撤销应该是"生成前 → 生成后"两个**内容态**，
      // 中间那句"生成中"、以及失败回写的错误文案都不是用户做出来的东西，
      // 记进去只会让撤销多出几步"点了没反应"的空操作（线上反馈）。
      // 顺带 reserve redo：过渡态写入若清了 future，用户撤销一次后就再也重做不回来了。
      // isDirty 仍然置位（与原来一致）：这些状态照旧会被自动保存，
      // 刷新后由 active-executions 重建，行为不变。
      if (!opts?.transient) {
        const hist = saveHistory(data);
        Object.assign(data, hist);
      }
      cache.set(pid, data);

      return { _cache: cache, isDirty: true, ...syncFromCache(pid, cache) };
    });
  },

  saveViewport: (viewport: Viewport) => {
    set((state) => {
      const pid = state.projectId;
      if (!pid) return {};
      const cache = new Map(state._cache);
      const data = cache.get(pid);
      if (data) {
        data.savedViewport = viewport;
        cache.set(pid, data);
      }
      return { _cache: cache };
    });
  },

  updateNodeStatus: (id: string, status: NodeExecutionStatus) => {
    set((state) => {
      const pid = state.projectId;
      if (!pid || state.isLoading) return {};
      const cache = new Map(state._cache);
      let data = cache.get(pid) || createEmptyProjectData();

      // 标记跳过历史记录（执行状态变化不需要 undo）
      data.skipHistory = true;
      data.nodes = data.nodes.map((node) =>
        node.id === id ? { ...node, data: { ...node.data, status, progressMessage: undefined } as LibTVNode['data'] } : node,
      );
      cache.set(pid, data);

      return { _cache: cache, ...syncFromCache(pid, cache) };
    });
  },

  updateNodeProgress: (id: string, progressMessage: string | undefined) => {
    set((state) => {
      const pid = state.projectId;
      if (!pid || state.isLoading) return {};
      const cache = new Map(state._cache);
      const data = cache.get(pid) || createEmptyProjectData();

      // 标记跳过历史记录（进度变化不需要 undo；同时防止随后的尺寸重测变更产生历史条目）
      data.skipHistory = true;
      data.nodes = data.nodes.map((node) =>
        node.id === id ? { ...node, data: { ...node.data, progressMessage } as LibTVNode['data'] } : node,
      );
      cache.set(pid, data);

      return { _cache: cache, ...syncFromCache(pid, cache) };
    });
  },

  /**
   * 回写派生元数据（视频尺寸/时长这类由媒体文件测出来的值）。
   * 与 updateNodeData 的唯一区别：**不置 isDirty、不进撤销历史**。
   * 这些值不是用户编辑：若按编辑论处，页面一加载 VideoNode 重新测一遍尺寸
   * 就会把画布标脏，出现"刚刷新进来、什么都没动却显示未保存"。
   * 回写前调用方应先比对，值没变就别写（省掉无意义的节点重渲染）。
   */
  updateNodeMeta: (id: string, upd: Partial<LibTVNode['data']>) => {
    set((state) => {
      const pid = state.projectId;
      if (!pid || state.isLoading) return {};
      const cache = new Map(state._cache);
      const data = cache.get(pid) || createEmptyProjectData();

      data.skipHistory = true;
      data.nodes = data.nodes.map((node) =>
        node.id === id ? { ...node, data: { ...node.data, ...upd } as LibTVNode['data'] } : node,
      );
      cache.set(pid, data);

      return { _cache: cache, ...syncFromCache(pid, cache) };
    });
  },

  // --- 边操作 ---
  addEdge: (edge: LibTVEdge) => {
    set((state) => {
      const pid = state.projectId;
      if (!pid || state.isLoading) return {};
      const cache = new Map(state._cache);
      let data = cache.get(pid) || createEmptyProjectData();

      data.edges = [...data.edges, edge];
      const hist = saveHistory(data);
      Object.assign(data, hist);
      cache.set(pid, data);

      return { _cache: cache, isDirty: true, ...syncFromCache(pid, cache) };
    });
  },

  removeEdges: (ids: string[]) => {
    const idSet = new Set(ids);
    set((state) => {
      const pid = state.projectId;
      if (!pid || state.isLoading) return {};
      const cache = new Map(state._cache);
      let data = cache.get(pid) || createEmptyProjectData();

      data.edges = data.edges.filter((e) => !idSet.has(e.id));

      const hist = saveHistory(data);
      Object.assign(data, hist);
      cache.set(pid, data);

      return { _cache: cache, isDirty: true, ...syncFromCache(pid, cache) };
    });
  },

  // 画布加载/导出
  /**
   * 从服务端加载画布数据：
   * 1. 写入 cache
   * 2. 设置 isLoading=false（取消 loading 状态）
   * 3. 同步到顶层属性 → 组件渲染真实数据
   */
  loadCanvas: (data: CanvasData) => {
    set((state) => {
      const pid = state.projectId;
      if (!pid) return {};
      const cache = new Map(state._cache);

      const projectData: ProjectCanvasData = {
        // 组合容器自愈：老画布/异常数据里可能有「成员悬空、框不贴合、空组合」，
        // 打开时统一收拾干净（纯几何修正，不置脏、不进历史）
        nodes: normalizeGroups(data.nodes.map((node) => {
          // 打开画布不恢复上次的选中状态（保存的 JSON 里可能残留 selected:true，
          // 会导致"打开就默认选中某节点"并弹它的编辑面板）
          const base = { ...node, selected: false } as LibTVNode;
          // 文本节点：确保有最小宽高，避免内容为空时塌陷
          if (node.type === 'text') {
            const style = { ...node.style };
            if (!style.minWidth) style.minWidth = 320;
            if (!style.minHeight) style.minHeight = 200;
            return { ...base, style };
          }
          // 白模预演节点：宽度对齐视频节点（480，媒体类节点同宽）。
          // 仅在仍是旧默认值 320 或未设置时归一化，不覆盖用户手动调过的宽度
          if (node.type === 'previz') {
            const style = { ...node.style };
            const w = typeof style.width === 'number' ? style.width : undefined;
            if (w === undefined || w === 320) {
              style.width = 480;
              style.minWidth = 480;
            }
            return { ...base, style };
          }
          return base;
        })),
        edges: data.edges,
        selectedNodeIds: [],
        selectedEdgeIds: [],
        history: [],
        future: [],
        savedViewport: data.viewport || { x: 0, y: 0, zoom: 1 },
        skipHistory: false,
      };
      cache.set(pid, projectData);
      // 种一条初始快照（history[0] === 加载后的当前状态），
      // 保证加载后的第一次变更也能撤销回初始状态
      projectData.history = [{ nodes: [...projectData.nodes], edges: [...projectData.edges] }];

      return {
        _cache: cache,
        isLoading: false,     // 加载完成，取消 loading
        isDirty: false,
        ...syncFromCache(pid, cache),
      };
    });
  },

  exportCanvas: () => {
    const { nodes, edges, projectId, _cache } = get();
    const viewport = (_cache.get(projectId)?.savedViewport) || { x: 0, y: 0, zoom: 1 };
    return { nodes, edges, viewport };
  },

  clearCanvas: () => {
    set((state) => {
      const pid = state.projectId;
      if (!pid) return {};
      const cache = new Map(state._cache);
      cache.set(pid, createEmptyProjectData());
      return { _cache: cache, isDirty: false, ...syncFromCache(pid, cache) };
    });
  },

  // --- 撤销/重做 ---
  undo: () => {
    set((state) => {
      const pid = state.projectId;
      if (!pid || state.isLoading) return {};
      const cache = new Map(state._cache);
      let data = cache.get(pid) || createEmptyProjectData();

      // history[0] 永远是"当前状态"的快照（saveHistory 记录的是变更后状态），
      // 撤销需要回退到 history[1]（上一步的状态）
      if (data.history.length < 2) return {};

      const [cur, prev, ...restHist] = data.history;

      // 标记跳过历史记录
      data.skipHistory = true;
      data.nodes = prev.nodes;
      data.edges = prev.edges;
      data.selectedNodeIds = [];
      data.selectedEdgeIds = [];
      // 维持不变式：history[0] = prev = 回退后的当前状态；被撤销的状态进 future 供 redo
      data.history = [prev, ...restHist];
      data.future = [cur, ...data.future];
      cache.set(pid, data);

      return { _cache: cache, isDirty: true, ...syncFromCache(pid, cache) };
    });
  },

  redo: () => {
    set((state) => {
      const pid = state.projectId;
      if (!pid || state.isLoading) return {};
      const cache = new Map(state._cache);
      let data = cache.get(pid) || createEmptyProjectData();

      if (data.future.length === 0) return {};

      const [next, ...restFuture] = data.future;

      // 标记跳过历史记录
      data.skipHistory = true;
      data.nodes = next.nodes;
      data.edges = next.edges;
      data.selectedNodeIds = [];
      data.selectedEdgeIds = [];
      // 不变式：history[0] === 当前状态，redo 后当前状态变为 next
      data.history = [next, ...data.history];
      data.future = restFuture;
      cache.set(pid, data);

      return { _cache: cache, isDirty: true, ...syncFromCache(pid, cache) };
    });
  },
}));

// 开发调试时可临时取消注释（注意：大量节点时会影响性能）
// useCanvasStore.subscribe((state) => {
//   console.log('store 最新状态:', state);
// });
