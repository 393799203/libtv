import { create } from 'zustand';
import type { CanvasData, LibTVNode, LibTVEdge, NodeExecutionStatus, ScriptAssetItem } from '@/types/canvas';
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
  /** 只更新执行进度文案（SSE 高频回调专用）：不进历史、不置 isDirty */
  updateNodeProgress: (id: string, progressMessage: string | undefined) => void;

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
    // ✅ 处理节点删除：使用 ID 映射机制同步清空脚本节点资产
    // 注意：这里只收集清理目标，不做原地 mutation —— scriptData[dataType] 数组和
    // asset 对象被历史快照浅引用共享，原地写会污染所有历史条目导致 undo 无法恢复。
    const removeChanges = changes.filter(c => c.type === 'remove');
    const assetCleanups: { scriptNodeId: string; dataType: string; assetName: string }[] = [];
    if (removeChanges.length > 0) {
      const state = get();
      const nodes = state.nodes;

      for (const change of removeChanges) {
        const deletedNode = nodes.find(n => n.id === (change as any).id);
        if (deletedNode && deletedNode.type === 'image') {
          // ✅ 从节点 ID 中提取资产信息（格式：{type}-{name}-{scriptNodeId}）
          const nodeId = deletedNode.id;
          const parts = nodeId.split('-');

          // 解析节点 ID 格式："角色-南方-script-123" -> ["角色", "南方", "script-123"]
          if (parts.length >= 3) {
            const assetType = parts[0]; // "角色" / "场景" / "道具"
            const assetName = parts[1]; // "南方" / "办公室" / "公文包"
            const scriptNodeId = parts.slice(2).join('-'); // "script-123"

            // 找到脚本节点
            const scriptNode = nodes.find(n => n.id === scriptNodeId && n.type === 'script');
            if (scriptNode) {
              const scriptData = scriptNode.data as any;

              // ✅ 清空资产的 imageUrl
              const typeMap = {
                '角色': 'characters',
                '场景': 'scenes',
                '道具': 'props',
              };

              const dataType = typeMap[assetType as '角色' | '场景' | '道具'];
              if (dataType && scriptData[dataType]) {
                const assets = scriptData[dataType];
                // ✅ 不再原地 mutation，仅收集清理目标，稍后统一不可变写回
                if (assets.some((a: any) => a.name === assetName)) {
                  assetCleanups.push({ scriptNodeId, dataType, assetName });
                  console.log('[CanvasStore] 清除资产 nodeId:', {
                    assetType,
                    assetName,
                    scriptNodeId,
                  });
                }
              }

              // ✅ assetImageMapping 已废弃，不再需要清理映射关系
            }
          }
        }
      }
    }

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

        data.nodes = data.nodes.map((node) => {
          if (node.type !== 'script') return node;
          const targets = assetCleanups.filter((t) => t.scriptNodeId === node.id);
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
        nodes: data.nodes.map((node) => {
          // 文本节点：确保有最小宽高，避免内容为空时塌陷
          if (node.type === 'text') {
            const style = { ...node.style };
            if (!style.minWidth) style.minWidth = 320;
            if (!style.minHeight) style.minHeight = 200;
            return { ...node, style };
          }
          return node;
        }),
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
