import { memo, useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  useReactFlow,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type OnConnectStart,
  type NodeOrigin,
  type DefaultEdgeOptions,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Button, Tooltip, message } from 'antd';
import {
  FullscreenOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  UndoOutlined,
  RedoOutlined,
  AimOutlined,
  PlusOutlined,
  FileTextOutlined,
  SnippetsOutlined,
  PictureOutlined,
  VideoCameraOutlined,
  AudioOutlined,
  CloseOutlined,
} from '@ant-design/icons';

import { useCanvasStore } from '@/stores/canvasStore';
import { useExecutionStore } from '@/stores/executionStore';
import { useShallow } from 'zustand/react/shallow';
import { NODE_TYPE_CONFIG } from '@/types/canvas';
import type { LibTVNode, LibTVEdge, NodeType, ImageNodeData, VideoNodeData, AudioNodeData } from '@/types/canvas';
import { PromptCompose } from '@/components/panels/prompt';

import { nodeTypes } from '@/components/nodes';
import { DataFlowEdge } from '@/components/edges/DataFlowEdge';
import { NodeContextMenu } from './NodeContextMenu';
import { NodeSelectPopup } from './NodeSelectPopup';
import { GenerationHistoryModal } from './GenerationHistoryModal';
import { createNode } from '@/utils/nodeFactory';
import { uploadImage, uploadVideo, uploadAudio } from '@/services/uploadApi';
import { canvasApi } from '@/services/canvasApi';

/** 空画布引导卡片的节点入口 */
const EMPTY_GUIDE_TYPES: { type: NodeType; label: string; desc: string; icon: React.ReactNode }[] = [
  { type: 'text', label: '文本', desc: '创作剧本/台词', icon: <FileTextOutlined /> },
  { type: 'script', label: '分镜', desc: '生成分镜剧本', icon: <SnippetsOutlined /> },
  { type: 'image', label: '图片', desc: '角色/场景/道具图', icon: <PictureOutlined /> },
  { type: 'video', label: '视频', desc: '生成/导入视频', icon: <VideoCameraOutlined /> },
  { type: 'audio', label: '音频', desc: '配音/配乐', icon: <AudioOutlined /> },
];

const edgeTypes = {
  dataFlow: DataFlowEdge,
};

const nodeOrigin: NodeOrigin = [0.5, 0.5];

const defaultEdgeOptions: DefaultEdgeOptions = {
  type: 'dataFlow',
};

const miniMapNodeColor = (node: LibTVNode) => {
  const config = NODE_TYPE_CONFIG[node.data.type as keyof typeof NODE_TYPE_CONFIG];
  return config?.color ?? '#999';
};

const VIEWPORT_CHANGE_THROTTLE = 100;

export const Canvas = memo(function Canvas() {
  const viewportRef = useRef<Viewport | null>(null);
  const lastViewportUpdate = useRef(0);
  // setViewport 节流：窗口内暂存最新视口，由 trailing timer 统一刷新一次
  const pendingViewportRef = useRef<Viewport | null>(null);
  const viewportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // 图片/视频节点右键菜单状态（下载 / 存到个人资产库 / 查看生成历史）
  const [nodeMenu, setNodeMenu] = useState<{
    x: number;
    y: number;
    nodeType: 'image' | 'video';
    url: string;
    name: string;
    nodeId: string;
  } | null>(null);
  // 生成历史弹窗状态
  const [historyModal, setHistoryModal] = useState<{
    nodeId: string;
    nodeType: 'image' | 'video';
    currentUrl: string;
  } | null>(null);
  const [nodeSelectPopup, setNodeSelectPopup] = useState<{
    position: { x: number; y: number };
    sourceNodeId: string;
    sourceHandle: string | null;
  } | null>(null);
  // 拖动/框选操作期间抑制提示框显示，纯点击时重置
  const suppressPromptRef = useRef(false);
  // 防止 onPaneClick 在连线释放时误关弹窗
  const connectingRef = useRef(false);
  // 拖拽连线中：源节点 ID + 当前悬停的目标节点 ID（目标节点放大 + 高亮 outline）
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [connectTargetId, setConnectTargetId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  // 空画布引导卡片：手动关闭后本次会话不再弹出
  const [dismissedEmptyGuide, setDismissedEmptyGuide] = useState(false);
  const { fitView, zoomIn, zoomOut, screenToFlowPosition, flowToScreenPosition, getNodes, setViewport: rfSetViewport } = useReactFlow();

  // ✅ 性能优化：使用useShallow避免数组引用变化触发重渲染
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, selectedNodeIds, updateNodeData, addNode, addEdge, projectId } = useCanvasStore(
    useShallow((s) => ({
      nodes: s.nodes,
      edges: s.edges,
      onNodesChange: s.onNodesChange,
      onEdgesChange: s.onEdgesChange,
      onConnect: s.onConnect,
      selectedNodeIds: s.selectedNodeIds,
      updateNodeData: s.updateNodeData,
      addNode: s.addNode,
      addEdge: s.addEdge,
      projectId: s.projectId,
    }))
  );

  const canUndo = useCanvasStore((s) => s.canUndo);
  const canRedo = useCanvasStore((s) => s.canRedo);
  const undo = useCanvasStore((s) => s.undo);
  const redo = useCanvasStore((s) => s.redo);
  const isExecuting = useExecutionStore((s) => s.isExecuting);

  // 当选中节点变化时，重置之前节点的编辑状态（避免 isEditing 卡住导致提示词框不显示）
  const prevSelectedIdsRef = useRef<string[]>([]);
  useEffect(() => {
    // 重置之前选中的文本节点的 isEditing 状态
    for (const prevId of prevSelectedIdsRef.current) {
      const prevNode = nodes.find((n) => n.id === prevId);
      if (prevNode?.data.isEditing) {
        updateNodeData(prevId, { isEditing: false });
      }
    }
    prevSelectedIdsRef.current = selectedNodeIds;
  }, [selectedNodeIds, nodes, updateNodeData]);
  const showMiniMap = useCanvasStore((s) => s.showMiniMap);
  const isLoading = useCanvasStore((s) => s.isLoading);
  const saveViewport = useCanvasStore((s) => s.saveViewport);
  const savedViewport = useCanvasStore((s) => {
    const pid = s.projectId;
    if (!pid) return null;
    return s._cache.get(pid)?.savedViewport || null;
  });

  const handleNodesChange: OnNodesChange<LibTVNode> = onNodesChange;
  const handleEdgesChange: OnEdgesChange<LibTVEdge> = onEdgesChange;
  const handleConnect: OnConnect = onConnect;

  // 开始拖拽连线：记录源节点
  const handleConnectStart: OnConnectStart = useCallback((_, params) => {
    setConnectingFrom(params.nodeId ?? null);
    setConnectTargetId(null);
  }, []);

  // 连线拖动中悬停到节点：高亮目标节点（排除源节点自身）
  const handleNodeMouseEnter = useCallback(
    (_: React.MouseEvent, node: LibTVNode) => {
      if (connectingFrom && node.id !== connectingFrom) {
        setConnectTargetId(node.id);
      }
    },
    [connectingFrom]
  );

  const handleNodeMouseLeave = useCallback(() => {
    setConnectTargetId(null);
  }, []);

  // 给拖拽连线悬停的目标节点附加高亮类名（放大 + 蓝色 outline）
  const displayNodes = useMemo(() => {
    if (!connectTargetId) return nodes;
    return nodes.map((n) =>
      n.id === connectTargetId
        ? { ...n, className: `${n.className || ''} libtv-connect-target`.trim() }
        : n
    );
  }, [nodes, connectTargetId]);

  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setNodeMenu(null);
    // 空白画布右键与右下角 + 统一使用同一个节点选择弹窗（纯添加模式）
    setNodeSelectPopup({
      position: { x: event.clientX, y: event.clientY },
      sourceNodeId: null,
      sourceHandle: null,
    });
  }, []);

  // 节点右键：一律阻止冒泡到容器的空白区右键菜单（所有节点类型）；
  // 图片/视频节点有媒体内容时额外弹出下载 / 存到个人资产库菜单
  const handleNodeContextMenu = useCallback((event: React.MouseEvent, node: LibTVNode) => {
    event.preventDefault();
    event.stopPropagation();
    setNodeSelectPopup(null);
    if (node.type !== 'image' && node.type !== 'video') return;
    const url = node.type === 'image'
      ? (node.data.imageUrl as string)
      : (node.data.videoUrl as string);
    if (!url) return;
    setNodeMenu({
      x: event.clientX,
      y: event.clientY,
      nodeType: node.type,
      url,
      name: (node.data.label as string) || '',
      nodeId: node.id,
    });
  }, []);

  // 连线释放：落在对方节点任意位置即完成连线（无需精确对准连接点）；
  // 释放在空白区域时弹出节点选择菜单（参考官方 add-node-on-edge-drop 示例）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState?: any) => {
      // 标记：本次释放是连线操作，onPaneClick 不应关闭弹窗
      connectingRef.current = true;
      // 短暂延迟后重置，让 onPaneClick 有机会读取
      setTimeout(() => { connectingRef.current = false; }, 50);
      // 结束连线状态：目标节点高亮恢复原样
      setConnectingFrom(null);
      setConnectTargetId(null);

      // 已精确落在有效连接点上，onConnect 已处理
      if (connectionState?.isValid) return;

      const { clientX, clientY } = 'changedTouches' in event
        ? event.changedTouches[0]
        : event as MouseEvent;

      // 命中检测：释放点下如果有节点（不要求落在连接点上），直接建立连线
      const sourceId = connectionState?.fromNode?.id as string | undefined;
      const hitEl = document.elementFromPoint(clientX, clientY);
      const nodeEl = hitEl instanceof Element ? hitEl.closest('.react-flow__node') : null;
      const targetId = nodeEl?.getAttribute('data-id') || null;
      if (sourceId && targetId && targetId !== sourceId) {
        const { edges: latestEdges } = useCanvasStore.getState();
        const duplicated = latestEdges.some(
          (e) => e.source === sourceId && e.target === targetId
        );
        if (!duplicated) {
          addEdge({
            id: `e-${sourceId}-${targetId}`,
            source: sourceId,
            target: targetId,
            type: 'dataFlow',
            sourceHandle: connectionState?.fromHandle?.id ?? undefined,
          });
        }
        return;
      }

      // 释放到空白区域时弹出选择菜单
      setNodeSelectPopup({
        position: { x: clientX, y: clientY },
        sourceNodeId: connectionState?.fromNode?.id,
        sourceHandle: connectionState?.fromHandle?.id ?? null,
      });
    },
    [addEdge]
  );

  // 从选择菜单选中节点类型后：创建新节点 + 建立连线
  const handleNodeSelect = useCallback(
    (nodeType: NodeType) => {
      if (!nodeSelectPopup) return;
      const { position, sourceNodeId, sourceHandle } = nodeSelectPopup;
      const flowPos = screenToFlowPosition(position);

      const newNode = createNode(nodeType, flowPos);

      addNode(newNode);
      // 纯添加（FAB/空画布引导，无来源节点）时不建立连线
      if (sourceNodeId) {
        addEdge({
          id: `e-${sourceNodeId}-${newNode.id}`,
          source: sourceNodeId,
          target: newNode.id,
          type: 'dataFlow',
          sourceHandle: sourceHandle || undefined,
        });
      }
      setNodeSelectPopup(null);
    },
    [nodeSelectPopup, screenToFlowPosition, addNode, addEdge]
  );

  // 拖拽本地/微信图片到画布：识别文件拖入并允许放置
  const handleDragOverCanvas = useCallback((e: React.DragEvent) => {
    try {
      if (Array.from(e.dataTransfer.types).includes('Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    } catch {
      // 忽略（个别浏览器 types 实现不同）
    }
  }, []);

  // 释放文件：按类型上传（图片/视频/音频）→ 在释放位置生成对应节点，多文件错开排列
  const handleDropFiles = useCallback(
    async (e: React.DragEvent) => {
      const files = Array.from(e.dataTransfer.files || []);
      if (files.length === 0) return;

      const classify = (f: File): 'image' | 'video' | 'audio' | null => {
        if (f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(f.name)) return 'image';
        if (f.type.startsWith('video/') || /\.(mp4|webm|mov|mkv|m4v)$/i.test(f.name)) return 'video';
        if (f.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f.name)) return 'audio';
        return null;
      };
      const items = files
        .map((f) => ({ f, kind: classify(f) }))
        .filter((x): x is { f: File; kind: 'image' | 'video' | 'audio' } => x.kind !== null);
      if (items.length === 0) return;
      e.preventDefault();

      const base = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      let idx = 0;
      for (const { f, kind } of items) {
        const key = `canvas-drop-${f.name}-${Date.now()}-${idx}`;
        try {
          if (kind === 'image') {
            const res = await uploadImage(f, projectId || undefined);
            const node = createNode('image', { x: base.x + idx * 80, y: base.y + idx * 80 });
            addNode(node);
            updateNodeData(node.id, {
              imageUrl: res.url,
              thumbUrl: res.thumbUrl,
              width: res.width,
              height: res.height,
            } as Partial<ImageNodeData>);
          } else if (kind === 'video') {
            message.loading({ content: `上传中「${f.name}」0%`, key, duration: 0 });
            const res = await uploadVideo(
              f,
              (pct, phase) => {
                message.loading({
                  content: phase === 'processing' ? `转码中「${f.name}」${pct}%` : `上传中「${f.name}」${pct}%`,
                  key,
                  duration: 0,
                });
              },
              projectId || undefined
            );
            const node = createNode('video', { x: base.x + idx * 80, y: base.y + idx * 80 });
            addNode(node);
            updateNodeData(node.id, { videoUrl: res.url } as Partial<VideoNodeData>);
            message.success({ content: `「${f.name}」上传完成`, key, duration: 2 });
          } else {
            message.loading({ content: `上传中「${f.name}」0%`, key, duration: 0 });
            const url = await uploadAudio(
              f,
              (pct) => message.loading({ content: `上传中「${f.name}」${pct}%`, key, duration: 0 }),
              projectId || undefined
            );
            const node = createNode('audio', { x: base.x + idx * 80, y: base.y + idx * 80 });
            addNode(node);
            updateNodeData(node.id, { audioUrl: url } as Partial<AudioNodeData>);
            message.success({ content: `「${f.name}」上传完成`, key, duration: 2 });
          }
          idx++;
        } catch (err) {
          message.destroy(key);
          // HTTP 错误已由 axios 拦截器统一提示
          console.error('画布拖拽上传失败:', err);
        }
      }

      // 上传完成后自动保存画布，避免未手动保存时刷新丢失新增节点
      if (idx > 0 && projectId) {
        try {
          const { exportCanvas, setDirty } = useCanvasStore.getState();
          await canvasApi.saveCanvas(projectId, exportCanvas());
          setDirty(false);
          message.success(`已添加 ${idx} 个节点并自动保存`);
        } catch (err) {
          // 保存失败：拦截器已提示；节点仍在内存（isDirty=true），可手动保存兜底
          console.error('拖拽上传后自动保存失败:', err);
        }
      }
    },
    [screenToFlowPosition, addNode, updateNodeData, projectId]
  );

    // 在画布中心添加节点并自动选中（空画布引导卡 / FAB 共用）
  const addNodeAtCenter = useCallback(
    (nodeType: NodeType) => {
      const el = containerRef.current;
      const rect = el?.getBoundingClientRect();
      const center = rect
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      const flowPos = screenToFlowPosition(center);
      const node = createNode(nodeType, flowPos);
      addNode(node);
      // 选中新节点 → 自动打开提示词面板
      onNodesChange([{ type: 'select', id: node.id, selected: true }]);
    },
    [screenToFlowPosition, addNode, onNodesChange]
  );

  const onViewportChange = useCallback((viewport: Viewport) => {
    const now = Date.now();
    if (now - lastViewportUpdate.current > VIEWPORT_CHANGE_THROTTLE) {
      // 领先沿：立即刷新显示 + 按原节奏持久化（saveViewport 节流逻辑保持不变）
      lastViewportUpdate.current = now;
      setViewport(viewport);
      viewportRef.current = viewport;
      saveViewport(viewport);
    } else {
      // 节流窗口内：只记最新值，trailing timer 兜底刷新一次显示，避免每帧 setState
      pendingViewportRef.current = viewport;
      if (viewportTimerRef.current === null) {
        viewportTimerRef.current = setTimeout(() => {
          viewportTimerRef.current = null;
          const latest = pendingViewportRef.current;
          pendingViewportRef.current = null;
          if (latest) setViewport(latest);
        }, VIEWPORT_CHANGE_THROTTLE);
      }
    }
  }, [saveViewport]);

  // 卸载时清理视口节流 timer
  useEffect(() => () => {
    if (viewportTimerRef.current !== null) {
      clearTimeout(viewportTimerRef.current);
      viewportTimerRef.current = null;
    }
  }, []);

  const handleFitView = useCallback(() => {
    fitView({ duration: 300, padding: 0.2 });
  }, [fitView]);

  const handleZoomIn = useCallback(() => {
    zoomIn({ duration: 200 });
  }, [zoomIn]);

  const handleZoomOut = useCallback(() => {
    zoomOut({ duration: 200 });
  }, [zoomOut]);

  const handleZoomReset = useCallback(() => {
    const nodes = getNodes();
    if (nodes.length === 0) {
      rfSetViewport({ x: 0, y: 0, zoom: 1 }, { duration: 200 });
      return;
    }
    // 计算所有节点的边界中心（flow 坐标）
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of nodes) {
      const w = node.measured?.width ?? (node.style?.width as number ?? 320);
      const h = node.measured?.height ?? (node.style?.height as number ?? 200);
      // nodeOrigin [0.5, 0.5] → position 是节点中心
      minX = Math.min(minX, node.position.x - w / 2);
      minY = Math.min(minY, node.position.y - h / 2);
      maxX = Math.max(maxX, node.position.x + w / 2);
      maxY = Math.max(maxY, node.position.y + h / 2);
    }
    const contentCenterX = (minX + maxX) / 2;
    const contentCenterY = (minY + maxY) / 2;

    // 获取容器尺寸，将内容中心对齐到容器屏幕中心
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      rfSetViewport(
        { x: rect.width / 2 - contentCenterX, y: rect.height / 2 - contentCenterY, zoom: 1 },
        { duration: 200 },
      );
    } else {
      rfSetViewport({ x: -contentCenterX, y: -contentCenterY, zoom: 1 }, { duration: 200 });
    }
  }, [rfSetViewport, getNodes]);

  const proOptions = useMemo(
    () => ({
      hideAttribution: true,
    }),
    []
  );

  // 获取选中节点信息
  const selectedNode = selectedNodeIds.length === 1
    ? nodes.find((n) => n.id === selectedNodeIds[0])
    : null;

  // PromptPanel 的稳定 onUpdate 引用（内联箭头会击穿 memo）：
  // 仅依赖选中节点 id，节点 data 变化不会导致回调引用变化
  const selectedNodeId = selectedNode?.id;
  const handlePromptUpdate = useCallback(
    (partial: Partial<LibTVNode['data']>) => {
      if (selectedNodeId) updateNodeData(selectedNodeId, partial);
    },
    [selectedNodeId, updateNodeData],
  );

  // 支持提示词面板的节点类型（排除风格图片节点、拖动/框选操作）
  const hasPromptPanel = selectedNode
    && !suppressPromptRef.current
    && ['text', 'image', 'video', 'audio', 'script'].includes(selectedNode.data.type)
    && !selectedNode.id.startsWith('style-');
  const isEditingNode = nodes.some((n) => n.data.isEditing);

  // 加载完成后恢复视口位置（仅执行一次）
  const hasRestoredViewport = useRef(false);
  useEffect(() => {
    if (!isLoading && savedViewport && !hasRestoredViewport.current) {
      hasRestoredViewport.current = true;
      rfSetViewport(savedViewport, { duration: 0 });
    }
    // 切换项目时重置标记
    if (isLoading) {
      hasRestoredViewport.current = false;
    }
  }, [isLoading]);

  // 初始加载时自动适应画布
  const hasFittedView = useRef(false);
  useEffect(() => {
    if (!isLoading && nodes.length > 0 && !hasFittedView.current) {
      hasFittedView.current = true;
      // 延迟一帧确保节点已渲染完成
      requestAnimationFrame(() => {
        fitView({ duration: 300, padding: 0.2 });
      });
    }
    if (isLoading) {
      hasFittedView.current = false;
    }
  }, [isLoading, nodes.length]);

  // 计算提示词框的位置 — 拖动期间不更新
  const promptPosition = useMemo(() => {
    if (!selectedNode || suppressPromptRef.current) return null;
    // 从 store 取最新节点数据（measured 可能异步更新，selectedNode 可能是旧的）
    const latestNode = getNodes().find((n) => n.id === selectedNode.id);
    const node = latestNode || selectedNode;
    // nodeOrigin [0.5, 0.5] → position 是中心点，底部 = position.y + height/2
    const nodeBottomY = node.position.y + (node.measured?.height || 200) / 2;
    return flowToScreenPosition({ x: node.position.x, y: nodeBottomY - 20 });
  }, [selectedNode?.id, flowToScreenPosition, viewport, getNodes]);

  return (
    <div ref={containerRef} className="w-full h-full relative" onContextMenu={handleContextMenu}>
      <style>{`
        .react-flow-cursor-default .react-flow__pane { cursor: default !important; }
        .react-flow-cursor-default .react-flow__pane:active { cursor: default !important; }
      `}</style>
      {isLoading ? (
        <div className="w-full h-full flex items-center justify-center bg-gray-50">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-purple-200 border-t-purple-500 rounded-full animate-spin" />
            <span className="text-sm text-gray-400">加载画布...</span>
          </div>
        </div>
      ) : (
      <div className="w-full h-full" onDragOver={handleDragOverCanvas} onDrop={handleDropFiles}>
        <ReactFlow
        nodes={displayNodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onConnectStart={handleConnectStart}
        onConnectEnd={handleConnectEnd}
        onNodeMouseEnter={handleNodeMouseEnter}
        onNodeMouseLeave={handleNodeMouseLeave}
        onNodeDragStart={() => { suppressPromptRef.current = true; }}
        onNodeClick={() => { suppressPromptRef.current = false; }}
        onMouseDown={(e) => {
          // 画布空白区域按下鼠标（框选/平移）→ 抑制提示框
          if ((e.target as HTMLElement).classList.contains('react-flow__pane')) {
            suppressPromptRef.current = true;
          }
        }}
        onNodeContextMenu={handleNodeContextMenu}
        onViewportChange={onViewportChange}
        onPaneClick={() => {
          setNodeMenu(null);
          if (!connectingRef.current) setNodeSelectPopup(null);
        }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodeOrigin={nodeOrigin}
        defaultEdgeOptions={defaultEdgeOptions}
        proOptions={proOptions}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        snapToGrid
        snapGrid={[16, 16]}
        connectionRadius={40}
        minZoom={0.05}
        maxZoom={4}
        nodesDraggable={!isExecuting}
        nodesConnectable={!isExecuting}
        elementsSelectable
        // ✅ 性能优化属性
        onlyRenderVisibleElements={true}  // 只渲染可见区域的节点（已启用）
        autoPanOnNodeDrag={false}  // 拖动节点时不自动平移画布（减少计算）
        preventScrolling={true}  // 防止意外的滚动行为
        selectNodesOnDrag={true}
        selectionOnDrag={true}
        panOnDrag={[1, 2]}
        panOnScroll={true}
        panOnScrollSpeed={0.5}
        zoomOnScroll={true}
        zoomOnPinch={true}
        zoomOnDoubleClick={false}
        deleteKeyCode={['Backspace', 'Delete']}
        multiSelectionKeyCode="Shift"
        className="react-flow-cursor-default"
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />

        {showMiniMap && (
          <MiniMap
            nodeColor={miniMapNodeColor}
            maskColor="rgba(100,116,139,0.15)"
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
            }}
            pannable
            zoomable
          />
        )}

        <Panel position="top-right">
          <div className="bg-white/90 backdrop-blur-sm rounded-lg shadow-md px-3 py-1.5 flex items-center gap-1">
            <Tooltip title="撤销">
              <Button type="text" size="small" icon={<UndoOutlined />} disabled={!canUndo} onClick={undo} />
            </Tooltip>
            <Tooltip title="重做">
              <Button type="text" size="small" icon={<RedoOutlined />} disabled={!canRedo} onClick={redo} />
            </Tooltip>
            <div className="w-px h-4 bg-gray-200 mx-1" />
            <Tooltip title="放大">
              <Button type="text" size="small" icon={<ZoomInOutlined />} onClick={handleZoomIn} />
            </Tooltip>
            <div className="w-16 text-center text-xs text-gray-600 select-none">
              {Math.round(viewport.zoom * 100)}%
            </div>
            <Tooltip title="缩小">
              <Button type="text" size="small" icon={<ZoomOutOutlined />} onClick={handleZoomOut} />
            </Tooltip>
            <Tooltip title="适应画布">
              <Button type="text" size="small" icon={<AimOutlined />} onClick={handleFitView} />
            </Tooltip>
            <Tooltip title="100%">
              <Button type="text" size="small" icon={<FullscreenOutlined />} onClick={handleZoomReset} />
            </Tooltip>
          </div>
        </Panel>

        {/* 常驻添加节点按钮（右下角；空画布由引导卡承担，不显示） */}
        {nodes.length > 0 && (
        <Panel position="bottom-right">
          <Tooltip title="添加节点">
            <Button
              type="primary"
              shape="circle"
              size="large"
              icon={<PlusOutlined />}
              onClick={(e) => {
                // 弹窗出现在 + 按钮的左上方，右缘紧贴按钮（更贴合 +）
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setNodeSelectPopup({
                  position: { x: r.left - 186, y: r.top - 272 },
                  sourceNodeId: null,
                  sourceHandle: null,
                });
              }}
            />
          </Tooltip>
        </Panel>
        )}
      </ReactFlow>
      </div>
      )}

      {/* 空画布引导：融入画布的虚线占位（非弹窗），0 节点且未手动关闭时展示 */}
      {!dismissedEmptyGuide && !isLoading && nodes.length === 0 && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <div className="relative w-[620px] max-w-[94%] rounded-2xl border-2 border-dashed border-gray-300/80 bg-white/40 backdrop-blur-[2px] px-8 py-9">
            <button
              className="absolute top-3 right-3 text-gray-300 hover:text-gray-500 cursor-pointer pointer-events-auto"
              onClick={() => setDismissedEmptyGuide(true)}
              title="关闭引导"
            >
              <CloseOutlined />
            </button>
            <div className="text-center">
              <div className="text-[16px] font-medium text-gray-600">从一条素材开始你的第一个镜头</div>
              <div className="text-[12px] text-gray-400 mt-1">
                选择节点开始，或直接把图片 / 视频 / 音频拖进画布
              </div>
            </div>
            <div className="flex justify-center gap-3 mt-7">
              {EMPTY_GUIDE_TYPES.map((t) => (
                <button
                  key={t.type}
                  onClick={() => addNodeAtCenter(t.type)}
                  className="pointer-events-auto flex flex-col items-center gap-1.5 w-[108px] rounded-xl bg-white border border-gray-200 hover:border-blue-400 hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer py-3.5"
                >
                  <span
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-white text-[18px]"
                    style={{ backgroundColor: NODE_TYPE_CONFIG[t.type].color }}
                  >
                    {t.icon}
                  </span>
                  <span className="text-[13px] font-medium text-gray-700">{t.label}</span>
                  <span className="text-[11px] text-gray-400 leading-none">{t.desc}</span>
                </button>
              ))}
            </div>
            <div className="text-[11px] text-gray-400 mt-6 text-center">
              右键画布或右下角 + 亦可随时添加节点
            </div>
          </div>
        </div>
      )}

      {/* 图片/视频节点右键菜单 */}
      {nodeMenu && (
        <NodeContextMenu
          position={{ x: nodeMenu.x, y: nodeMenu.y }}
          nodeType={nodeMenu.nodeType}
          url={nodeMenu.url}
          name={nodeMenu.name}
          nodeId={nodeMenu.nodeId}
          onUpdateNode={updateNodeData}
          onShowHistory={(nid, nt, curUrl) => setHistoryModal({ nodeId: nid, nodeType: nt, currentUrl: curUrl })}
          onClose={() => setNodeMenu(null)}
        />
      )}

      {/* 生成历史弹窗 */}
      {historyModal && (
        <GenerationHistoryModal
          nodeId={historyModal.nodeId}
          nodeType={historyModal.nodeType}
          currentUrl={historyModal.currentUrl}
          onSelect={(selectedUrl) => {
            const dataKey = historyModal.nodeType === 'image' ? 'imageUrl' : 'videoUrl';
            updateNodeData(historyModal.nodeId, { [dataKey]: selectedUrl });
          }}
          onClose={() => setHistoryModal(null)}
        />
      )}

      {nodeSelectPopup && (
        <NodeSelectPopup
          position={nodeSelectPopup.position}
          onSelect={handleNodeSelect}
          onClose={() => setNodeSelectPopup(null)}
        />
      )}

      {/* 选中节点时的提示词编辑组件 */}
      {hasPromptPanel && promptPosition && !selectedNode!.data.isEditing && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: promptPosition.x,
            top: promptPosition.y,
            transform: 'translateX(-50%)',
            zIndex: 1000,
          }}
        >
          {/* 箭头 */}
          <div
            className="absolute left-1/2 -translate-x-1/2"
            style={{
              top: -5,
              width: 0,
              height: 0,
              borderLeft: '6px solid transparent',
              borderRight: '6px solid transparent',
              borderBottom: '6px solid white'
            }}
          />

          <div className="pointer-events-auto">
            <PromptCompose
              key={selectedNode!.id}
              nodeId={selectedNode!.id}
              nodeType={selectedNode!.data.type}
              data={selectedNode!.data}
              onUpdate={handlePromptUpdate}
            />
          </div>
        </div>
      )}
    </div>
  );
});
