import { create } from 'zustand';
import {
  type LibTVNode,
  type LibTVEdge,
  type CanvasData,
  type NodeExecutionStatus,
} from '@/types/canvas';
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

interface HistoryState {
  nodes: LibTVNode[];
  edges: LibTVEdge[];
}

interface CanvasState {
  nodes: LibTVNode[];
  edges: LibTVEdge[];
  selectedNodeIds: string[];
  selectedEdgeIds: string[];
  canvasId: string | null;
  projectId: string | null;
  isDirty: boolean;
  isSaving: boolean;
  showMiniMap: boolean;
  history: HistoryState[];
  future: HistoryState[];
  canUndo: boolean;
  canRedo: boolean;

  onNodesChange: OnNodesChange<LibTVNode>;
  onEdgesChange: OnEdgesChange<LibTVEdge>;
  onConnect: OnConnect;

  addNode: (node: LibTVNode) => void;
  removeNodes: (ids: string[]) => void;
  updateNodeData: (id: string, data: Partial<LibTVNode['data']>) => void;
  updateNodeStatus: (id: string, status: NodeExecutionStatus) => void;

  addEdge: (edge: LibTVEdge) => void;
  removeEdges: (ids: string[]) => void;

  setCanvasId: (id: string) => void;
  setProjectId: (id: string) => void;
  setDirty: (dirty: boolean) => void;
  setSaving: (saving: boolean) => void;
  toggleMiniMap: () => void;

  loadCanvas: (data: CanvasData) => void;
  exportCanvas: () => CanvasData;
  clearCanvas: () => void;

  undo: () => void;
  redo: () => void;
}

// 批量更新队列，合并多次 onNodesChange/onEdgesChange 为一次 setState
let nodeChangeQueue: NodeChange<LibTVNode>[] = [];
let edgeChangeQueue: EdgeChange<LibTVEdge>[] = [];
let flushTimer: ReturnType<typeof microtask> | null = null;
let shouldRecordHistory = true;

// 检查 change 是否只是选择操作
function isOnlySelectChange(changes: (NodeChange<LibTVNode> | EdgeChange<LibTVEdge>)[]): boolean {
  return changes.every(c => c.type === 'select');
}

// 保存历史快照
function saveHistory(state: CanvasState): Partial<CanvasState> {
  const snapshot: HistoryState = {
    nodes: [...state.nodes],
    edges: [...state.edges],
  };
  
  // 检查是否和上一条历史记录相同，相同则不保存
  if (state.history.length > 0) {
    const lastSnapshot = state.history[0];
    const nodesEqual = JSON.stringify(lastSnapshot.nodes) === JSON.stringify(snapshot.nodes);
    const edgesEqual = JSON.stringify(lastSnapshot.edges) === JSON.stringify(snapshot.edges);
    if (nodesEqual && edgesEqual) {
      return {};
    }
  }
  
  const newHistory = [snapshot, ...state.history].slice(0, MAX_HISTORY);
  return {
    history: newHistory,
    future: [],
    canUndo: true,
    canRedo: false,
  };
}

function scheduleFlush(set: (fn: (state: CanvasState) => Partial<CanvasState>) => void) {
  if (flushTimer !== null) return;
  flushTimer = queueMicrotask(() => {
    flushTimer = null;
    const nodeChanges = nodeChangeQueue;
    const edgeChanges = edgeChangeQueue;
    nodeChangeQueue = [];
    edgeChangeQueue = [];

    if (nodeChanges.length === 0 && edgeChanges.length === 0) return;

    set((state) => {
      if (!shouldRecordHistory) {
        shouldRecordHistory = true;
        const updates: Partial<CanvasState> = {};
        if (nodeChanges.length > 0) {
          updates.nodes = applyNodeChanges(nodeChanges, state.nodes);
          // 处理选中状态变化
          const selectChanges = nodeChanges.filter(
            (c): c is { type: 'select'; id: string; selected: boolean } =>
              c.type === 'select' && 'id' in c && 'selected' in c
          );
          if (selectChanges.length > 0) {
            let newSelectedIds = [...state.selectedNodeIds];
            for (const change of selectChanges) {
              if (change.selected) {
                if (!newSelectedIds.includes(change.id)) {
                  newSelectedIds.push(change.id);
                }
              } else {
                newSelectedIds = newSelectedIds.filter(id => id !== change.id);
              }
            }
            updates.selectedNodeIds = newSelectedIds;
          }
        }
        if (edgeChanges.length > 0) {
          updates.edges = applyEdgeChanges(edgeChanges, state.edges);
          // 处理边选中状态变化
          const selectChanges = edgeChanges.filter(
            (c): c is { type: 'select'; id: string; selected: boolean } =>
              c.type === 'select' && 'id' in c && 'selected' in c
          );
          if (selectChanges.length > 0) {
            let newSelectedIds = [...state.selectedEdgeIds];
            for (const change of selectChanges) {
              if (change.selected) {
                if (!newSelectedIds.includes(change.id)) {
                  newSelectedIds.push(change.id);
                }
              } else {
                newSelectedIds = newSelectedIds.filter(id => id !== change.id);
              }
            }
            updates.selectedEdgeIds = newSelectedIds;
          }
        }
        return updates;
      }

      const updates: Partial<CanvasState> = { isDirty: true };

      if (nodeChanges.length > 0) {
        updates.nodes = applyNodeChanges(nodeChanges, state.nodes);
        // 处理选中状态变化
        const selectChanges = nodeChanges.filter(
          (c): c is { type: 'select'; id: string; selected: boolean } =>
            c.type === 'select' && 'id' in c && 'selected' in c
        );
        if (selectChanges.length > 0) {
          let newSelectedIds = [...state.selectedNodeIds];
          for (const change of selectChanges) {
            if (change.selected) {
              if (!newSelectedIds.includes(change.id)) {
                newSelectedIds.push(change.id);
              }
            } else {
              newSelectedIds = newSelectedIds.filter(id => id !== change.id);
            }
          }
          updates.selectedNodeIds = newSelectedIds;
        }
      }

      if (edgeChanges.length > 0) {
        updates.edges = applyEdgeChanges(edgeChanges, state.edges);
        // 处理边选中状态变化
        const selectChanges = edgeChanges.filter(
          (c): c is { type: 'select'; id: string; selected: boolean } =>
            c.type === 'select' && 'id' in c && 'selected' in c
        );
        if (selectChanges.length > 0) {
          let newSelectedIds = [...state.selectedEdgeIds];
          for (const change of selectChanges) {
            if (change.selected) {
              if (!newSelectedIds.includes(change.id)) {
                newSelectedIds.push(change.id);
              }
            } else {
              newSelectedIds = newSelectedIds.filter(id => id !== change.id);
            }
          }
          updates.selectedEdgeIds = newSelectedIds;
        }
      }

      return updates;
    });
  });
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeIds: [],
  selectedEdgeIds: [],
  canvasId: null,
  projectId: null,
  isDirty: false,
  isSaving: false,
  showMiniMap: false,
  history: [],
  future: [],
  canUndo: false,
  canRedo: false,

  onNodesChange: (changes: NodeChange<LibTVNode>[]) => {
    nodeChangeQueue.push(...changes);
    scheduleFlush(set);
  },

  onEdgesChange: (changes: EdgeChange<LibTVEdge>[]) => {
    edgeChangeQueue.push(...changes);
    scheduleFlush(set);
  },

  onConnect: (connection: Connection) => {
    const newEdge: LibTVEdge = {
      id: `e-${connection.source}-${connection.target}`,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle,
      targetHandle: connection.targetHandle,
      type: 'dataFlow',
      animated: true,
    };
    set((state) => ({
      edges: [...state.edges, newEdge],
      isDirty: true,
      ...saveHistory(state),
    }));
  },

  addNode: (node: LibTVNode) => {
    set((state) => ({
      nodes: [...state.nodes, node],
      isDirty: true,
      ...saveHistory(state),
    }));
  },

  removeNodes: (ids: string[]) => {
    const idSet = new Set(ids);
    set((state) => ({
      nodes: state.nodes.filter((n) => !idSet.has(n.id)),
      edges: state.edges.filter(
        (e) => !idSet.has(e.source) && !idSet.has(e.target)
      ),
      isDirty: true,
      ...saveHistory(state),
    }));
  },

  updateNodeData: (id: string, data: Partial<LibTVNode['data']>) => {
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === id
          ? { ...node, data: { ...node.data, ...data } as LibTVNode['data'] }
          : node
      ),
      isDirty: true,
      ...saveHistory(state),
    }));
  },

  updateNodeStatus: (id: string, status: NodeExecutionStatus) => {
    shouldRecordHistory = false;
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === id
          ? { ...node, data: { ...node.data, status } as LibTVNode['data'] }
          : node
      ),
    }));
  },

  addEdge: (edge: LibTVEdge) => {
    set((state) => ({
      edges: [...state.edges, edge],
      isDirty: true,
      ...saveHistory(state),
    }));
  },

  removeEdges: (ids: string[]) => {
    const idSet = new Set(ids);
    set((state) => ({
      edges: state.edges.filter((e) => !idSet.has(e.id)),
      isDirty: true,
      ...saveHistory(state),
    }));
  },

  setCanvasId: (id: string) => set({ canvasId: id }),
  setProjectId: (id: string) => set({ projectId: id }),
  setDirty: (dirty: boolean) => set({ isDirty: dirty }),
  setSaving: (saving: boolean) => set({ isSaving: saving }),
  toggleMiniMap: () => set((s) => ({ showMiniMap: !s.showMiniMap })),

  loadCanvas: (data: CanvasData) => {
    set({
      nodes: data.nodes,
      edges: data.edges,
      isDirty: false,
      history: [],
      future: [],
      canUndo: false,
      canRedo: false,
    });
  },

  exportCanvas: () => {
    const { nodes, edges } = get();
    return {
      nodes,
      edges,
      viewport: { x: 0, y: 0, zoom: 1 },
    };
  },

  clearCanvas: () => {
    set({
      nodes: [],
      edges: [],
      canvasId: null,
      isDirty: false,
      history: [],
      future: [],
      canUndo: false,
      canRedo: false,
    });
  },

  undo: () => {
    const state = get();
    if (!state.canUndo || state.history.length === 0) return;

    const [prevState, ...restHistory] = state.history;
    const currentSnapshot: HistoryState = {
      nodes: [...state.nodes],
      edges: [...state.edges],
    };

    shouldRecordHistory = false;
    set({
      nodes: prevState.nodes,
      edges: prevState.edges,
      selectedNodeIds: [],
      selectedEdgeIds: [],
      isDirty: true,
      history: restHistory,
      future: [currentSnapshot, ...state.future],
      canUndo: restHistory.length > 0,
      canRedo: true,
    });
  },

  redo: () => {
    const state = get();
    if (!state.canRedo || state.future.length === 0) return;

    const [nextState, ...restFuture] = state.future;
    const currentSnapshot: HistoryState = {
      nodes: [...state.nodes],
      edges: [...state.edges],
    };

    shouldRecordHistory = false;
    set({
      nodes: nextState.nodes,
      edges: nextState.edges,
      selectedNodeIds: [],
      selectedEdgeIds: [],
      isDirty: true,
      history: [currentSnapshot, ...state.history],
      future: restFuture,
      canUndo: true,
      canRedo: restFuture.length > 0,
    });
  },
}));