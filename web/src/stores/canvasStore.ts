import { create } from 'zustand';
import type { CanvasData, LibTVNode, LibTVEdge, NodeExecutionStatus } from '@/types/canvas';
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
} from '@xyflow/react';

const MAX_HISTORY = 50;

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
  showMiniMap: boolean;
  /** 是否正在从服务端加载数据（true 时组件显示 loading） */
  isLoading: boolean;

  setProjectId: (id: string) => void;
  setDirty: (dirty: boolean) => void;
  setSaving: (saving: boolean) => void;
  toggleMiniMap: () => void;
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

  // 节点操作
  addNode: (node: LibTVNode) => void;
  removeNodes: (ids: string[]) => void;
  updateNodeData: (id: string, data: Partial<LibTVNode['data']>) => void;
  updateNodeStatus: (id: string, status: NodeExecutionStatus) => void;

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
  const snapshot: HistorySnapshot = { nodes: [...data.nodes], edges: [...data.edges] };

  if (data.history.length > 0) {
    const last = data.history[0];
    if (JSON.stringify(last.nodes) === JSON.stringify(snapshot.nodes) &&
        JSON.stringify(last.edges) === JSON.stringify(snapshot.edges)) {
      return {} as any;
    }
  }

  return {
    history: [snapshot, ...data.history].slice(0, MAX_HISTORY),
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

      // 如果当前项目标记了 skipHistory，本次不记录快照
      const shouldRecord = !data.skipHistory;
      if (data.skipHistory) {
        data.skipHistory = false;
      }

      if (nChanges.length > 0) {
        data.nodes = applyNodeChanges(nChanges, data.nodes);
        syncSelectIds(nChanges, eChanges, data);
        // 清理已删除节点的选中状态（避免残留 ID 导致选中判断异常）
        const currentIds = new Set(data.nodes.map((n) => n.id));
        if (data.selectedNodeIds.some((id) => !currentIds.has(id))) {
          data.selectedNodeIds = data.selectedNodeIds.filter((id) => currentIds.has(id));
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
    canUndo: data.history.length > 0,
    canRedo: data.future.length > 0,
  };
}

// ========== Store 创建 ==========

export const useCanvasStore = create<CanvasState>((set, get) => ({
  // --- 工作区状态 ---
  projectId: null,
  isDirty: false,
  isSaving: false,
  showMiniMap: false,
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
  toggleMiniMap: () => set((s) => ({ showMiniMap: !s.showMiniMap })),

  // --- React Flow 回调 ---
  onNodesChange: (changes: NodeChange<LibTVNode>[]) => {
    nodeChangeQueue.push(...changes);
    scheduleFlush(get, set);
  },

  onEdgesChange: (changes: EdgeChange<LibTVEdge>[]) => {
    edgeChangeQueue.push(...changes);
    scheduleFlush(get, set);
  },

  onConnect: (connection: Connection) => {
    set((state) => {
      const pid = state.projectId;
      if (!pid || state.isLoading) return {};
      const cache = new Map(state._cache);
      let data = cache.get(pid) || createEmptyProjectData();

      const newEdge: LibTVEdge = {
        id: `e-${connection.source}-${connection.target}`,
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
        type: 'dataFlow',
        animated: true,
      };
      data.edges = [...data.edges, newEdge];
      const hist = saveHistory(data);
      Object.assign(data, hist);
      cache.set(pid, data);

      return { _cache: cache, isDirty: true, ...syncFromCache(pid, cache) };
    });
  },

  // --- 节点操作 ---
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

  removeNodes: (ids: string[]) => {
    const idSet = new Set(ids);
    set((state) => {
      const pid = state.projectId;
      if (!pid || state.isLoading) return {};
      const cache = new Map(state._cache);
      let data = cache.get(pid) || createEmptyProjectData();

      data.nodes = data.nodes.filter((n) => !idSet.has(n.id));
      data.edges = data.edges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target));
      // 清理被删节点的选中状态
      data.selectedNodeIds = data.selectedNodeIds.filter((id) => !idSet.has(id));
      const hist = saveHistory(data);
      Object.assign(data, hist);
      cache.set(pid, data);

      return { _cache: cache, isDirty: true, ...syncFromCache(pid, cache) };
    });
  },

  updateNodeData: (id: string, upd: Partial<LibTVNode['data']>) => {
    set((state) => {
      const pid = state.projectId;
      if (!pid || state.isLoading) return {};
      const cache = new Map(state._cache);
      let data = cache.get(pid) || createEmptyProjectData();

      data.nodes = data.nodes.map((node) =>
        node.id === id ? { ...node, data: { ...node.data, ...upd } as LibTVNode['data'] } : node,
      );
      const hist = saveHistory(data);
      Object.assign(data, hist);
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
        node.id === id ? { ...node, data: { ...node.data, status } as LibTVNode['data'] } : node,
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
        nodes: data.nodes,
        edges: data.edges,
        selectedNodeIds: [],
        selectedEdgeIds: [],
        history: [],
        future: [],
        savedViewport: data.viewport || { x: 0, y: 0, zoom: 1 },
        skipHistory: false,
      };
      cache.set(pid, projectData);

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

      if (data.history.length === 0) return {};

      const [prev, ...restHist] = data.history;
      const current: HistorySnapshot = { nodes: [...data.nodes], edges: [...data.edges] };

      // 标记跳过历史记录
      data.skipHistory = true;
      data.nodes = prev.nodes;
      data.edges = prev.edges;
      data.selectedNodeIds = [];
      data.selectedEdgeIds = [];
      data.history = restHist;
      data.future = [current, ...data.future];
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
      const current: HistorySnapshot = { nodes: [...data.nodes], edges: [...data.edges] };

      // 标记跳过历史记录
      data.skipHistory = true;
      data.nodes = next.nodes;
      data.edges = next.edges;
      data.selectedNodeIds = [];
      data.selectedEdgeIds = [];
      data.history = [current, ...data.history];
      data.future = restFuture;
      cache.set(pid, data);

      return { _cache: cache, isDirty: true, ...syncFromCache(pid, cache) };
    });
  },
}));

// 全局监听 store 变动，打印最新状态
useCanvasStore.subscribe((state) => {
  console.log('store 最新状态:', state);
});
