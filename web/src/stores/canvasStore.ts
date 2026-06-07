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
}

function createEmptyProjectData(): ProjectCanvasData {
  return {
    nodes: [],
    edges: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
    history: [],
    future: [],
  };
}

// ========== 工作区全局状态 ==========

interface WorkspaceUIState {
  projectId: string | null;
  isDirty: boolean;
  isSaving: boolean;
  showMiniMap: boolean;

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
let shouldRecordHistory = true;

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
      if (!pid) return {};

      const cache = state._cache;
      let data = cache.get(pid);
      if (!data) data = createEmptyProjectData();

      if (!shouldRecordHistory) {
        shouldRecordHistory = true;
        if (nChanges.length > 0) {
          data.nodes = applyNodeChanges(nChanges, data.nodes);
          syncSelectIds(nChanges, data);
        }
        if (eChanges.length > 0) {
          data.edges = applyEdgeChanges(eChanges, data.edges);
          syncSelectIds(eChanges, data);
        }
        cache.set(pid, data);
        return { _cache: cache, ...syncFromCache(pid, cache) };
      }

      const updates: Partial<CanvasState> = { isDirty: true };

      if (nChanges.length > 0) {
        data.nodes = applyNodeChanges(nChanges, data.nodes);
        syncSelectIds(nChanges, data);
      }
      if (eChanges.length > 0) {
        data.edges = applyEdgeChanges(eChanges, data.edges);
        syncSelectIds(eChanges, data);
      }

      const hist = saveHistory(data);
      Object.assign(data, hist);
      cache.set(pid, data);

      return { _cache: cache, ...updates, ...syncFromCache(pid, cache) };
    });
  });
}

function syncSelectIds(
  changes: (NodeChange<LibTVNode> | EdgeChange<LibTVEdge>)[],
  data: ProjectCanvasData,
): void {
  const selChanges = changes.filter(
    (c): c is { type: 'select'; id: string; selected: boolean } =>
      c.type === 'select' && 'id' in c && 'selected' in c,
  );
  if (selChanges.length === 0) return;

  // 简化：统一处理 selectedNodeIds / selectedEdgeIds
  for (const c of selChanges) {
    const idsKey = 'selectedNodeIds' as keyof ProjectCanvasData;
    let ids = data[idsKey] as string[];
    if (c.selected) {
      if (!ids.includes(c.id)) ids = [...ids, c.id];
    } else {
      ids = ids.filter((id) => id !== c.id);
    }
    // 根据变化类型判断是 node 还是 edge
    const change = c as Record<string, unknown>;
    if ('position' in change || 'dimensions' in change || 'data' in change) {
      data.selectedNodeIds = ids;
    } else {
      data.selectedEdgeIds = ids;
    }
  }
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
  setProjectId: (id: string) => {
    set((state) => {
      // 如果是同一个项目，不做任何事
      if (state.projectId === id) return {};

      const cache = new Map(state._cache);

      // 把当前项目的数据保存回 cache（如果有的话）
      if (state.projectId && (state.nodes.length > 0 || state.edges.length > 0)) {
        const currentData = cache.get(state.projectId) || createEmptyProjectData();
        currentData.nodes = state.nodes;
        currentData.edges = state.edges;
        currentData.selectedNodeIds = state.selectedNodeIds;
        currentData.selectedEdgeIds = state.selectedEdgeIds;
        cache.set(state.projectId, currentData);
      }

      // 从 cache 加载目标项目数据（没有则空白）
      const targetData = cache.get(id) || createEmptyProjectData();
      cache.set(id, targetData); // 确保占位

      return {
        projectId: id,
        isDirty: false,
        _cache: cache,
        ...syncFromCache(id, cache),
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
      if (!pid) return {};
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
      if (!pid) return {};
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
      if (!pid) return {};
      const cache = new Map(state._cache);
      let data = cache.get(pid) || createEmptyProjectData();

      data.nodes = data.nodes.filter((n) => !idSet.has(n.id));
      data.edges = data.edges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target));
      const hist = saveHistory(data);
      Object.assign(data, hist);
      cache.set(pid, data);

      return { _cache: cache, isDirty: true, ...syncFromCache(pid, cache) };
    });
  },

  updateNodeData: (id: string, upd: Partial<LibTVNode['data']>) => {
    set((state) => {
      const pid = state.projectId;
      if (!pid) return {};
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

  updateNodeStatus: (id: string, status: NodeExecutionStatus) => {
    shouldRecordHistory = false;
    set((state) => {
      const pid = state.projectId;
      if (!pid) return {};
      const cache = new Map(state._cache);
      let data = cache.get(pid) || createEmptyProjectData();

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
      if (!pid) return {};
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
      if (!pid) return {};
      const cache = new Map(state._cache);
      let data = cache.get(pid) || createEmptyProjectData();

      data.edges = data.edges.filter((e) => !idSet.has(e.id));
      const hist = saveHistory(data);
      Object.assign(data, hist);
      cache.set(pid, data);

      return { _cache: cache, isDirty: true, ...syncFromCache(pid, cache) };
    });
  },

  // --- 画布加载/导出 ---
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
      };
      cache.set(pid, projectData);

      return { _cache: cache, isDirty: false, ...syncFromCache(pid, cache) };
    });
  },

  exportCanvas: () => {
    const { nodes, edges } = get();
    return { nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } };
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
      if (!pid) return {};
      const cache = new Map(state._cache);
      let data = cache.get(pid) || createEmptyProjectData();

      if (data.history.length === 0) return {};

      const [prev, ...restHist] = data.history;
      const current: HistorySnapshot = { nodes: [...data.nodes], edges: [...data.edges] };

      shouldRecordHistory = false;
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
      if (!pid) return {};
      const cache = new Map(state._cache);
      let data = cache.get(pid) || createEmptyProjectData();

      if (data.future.length === 0) return {};

      const [next, ...restFuture] = data.future;
      const current: HistorySnapshot = { nodes: [...data.nodes], edges: [...data.edges] };

      shouldRecordHistory = false;
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
