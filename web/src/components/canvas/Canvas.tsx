import { memo, useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
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
import { Button } from 'antd';
import { message } from '@/utils/antdApp';
import {
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
import { setAssetDropHandler } from '@/components/canvas/assetDnd';
import { deriveThumbUrl } from '@/utils/thumbUrl';
import { mediaKindOfFile } from '@/utils/mediaNode';
import type { UserAsset } from '@/services/assetApi';
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

const VIEWPORT_CHANGE_THROTTLE = 100;

/** 提示词面板顶端与节点底边的固定间距（屏幕像素，各缩放档位一致） */
const PROMPT_PANEL_GAP_PX = 10;

/**
 * 画布落点载荷：两种来源的唯一差异就是 source，
 * 拿到「坐标 + 内容」之后走同一条创建路径。
 */
type CanvasDrop =
  | { source: 'files'; x: number; y: number; files: File[] }
  | { source: 'asset'; x: number; y: number; asset: UserAsset };

export const Canvas = memo(function Canvas() {
  const viewportRef = useRef<Viewport | null>(null);
  const lastViewportUpdate = useRef(0);
  // setViewport 节流：窗口内暂存最新视口，由 trailing timer 统一刷新一次
  const pendingViewportRef = useRef<Viewport | null>(null);
  const viewportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // 节点右键菜单状态（复制/粘贴/删除；图片·视频额外有下载 / 存到个人资产库 / 查看生成历史）
  const [nodeMenu, setNodeMenu] = useState<{
    x: number;
    y: number;
    nodeType: NodeType;
    url: string;
    name: string;
    nodeId: string;
  } | null>(null);
  /** 画布容器（用于判断拖放落点是否在画布内） */
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  // 节点剪贴板：右键「复制节点」后「粘贴节点」克隆出一个全新 id 的节点
  const [clipboardNode, setClipboardNode] = useState<LibTVNode | null>(null);
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
  // 拖动/框选操作期间抑制提示词面板，纯点击时重置。
  //
  // 必须是 state 不能是 ref：ref 改了不会触发重渲染，hasPromptPanel 在渲染时读到的
  // 还是旧值（原来的 ref 写法正是栽在这里）。
  //
  // 关于「双击看大图」：**故意不在这里抑制面板**。浏览器的一次双击 = 两个完整 click +
  // 一个 dblclick（dblclick 只比第二个 click 晚 5~10ms），而面板是绑在「选中」上的、
  // 选中发生在第一个 click，所以任何"双击就收起面板"的做法都会先弹出再收回 = 闪动；
  // 想用延迟躲开又得赌用户的双击间隔（系统阈值 300~500ms、浏览器读不到）。
  // 看大图用的是全屏弹窗，本来就完整盖住面板，因此双击全程不动面板 ⇒ 零闪动。
  const [promptSuppressed, setPromptSuppressed] = useState(false);
  // 拖动起点：用来判断这次到底是"真拖动"还是"手抖的单击"。React Flow 的拖动阈值很小，
  // 单击时手指抖一下也会走 dragStart/dragStop，那种情况不该清掉选中态。
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  // 防止 onPaneClick 在连线释放时误关弹窗
  const connectingRef = useRef(false);
  // 拖拽连线中：源节点 ID + 当前悬停的目标节点 ID（目标节点放大 + 高亮 outline）
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [connectTargetId, setConnectTargetId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  // 空画布引导卡片：手动关闭后本次会话不再弹出
  const [dismissedEmptyGuide, setDismissedEmptyGuide] = useState(false);
  const { fitView, screenToFlowPosition, flowToScreenPosition, getNodes, setViewport: rfSetViewport } = useReactFlow();

  // ✅ 性能优化：使用useShallow避免数组引用变化触发重渲染
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, selectedNodeIds, updateNodeData, addNode, addEdge, removeNodes, projectId, createMediaNodeAt } = useCanvasStore(
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
      removeNodes: s.removeNodes,
      createMediaNodeAt: s.createMediaNodeAt,
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

  // 节点右键：一律阻止冒泡到容器的空白区右键菜单（所有节点类型）。
  // 任何节点都给「复制/粘贴/删除」；图片·视频且有媒体地址时，菜单里再补下载 / 存资产 / 看历史。
  const handleNodeContextMenu = useCallback((event: React.MouseEvent, node: LibTVNode) => {
    event.preventDefault();
    event.stopPropagation();
    setNodeSelectPopup(null);
    const url = node.type === 'image'
      ? (node.data.imageUrl as string)
      : node.type === 'video'
        ? (node.data.videoUrl as string)
        : '';
    setNodeMenu({
      x: event.clientX,
      y: event.clientY,
      nodeType: (node.type || node.data.type) as NodeType,
      url: url || '',
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

  /** 节点显示名：label 优先，否则用类型名 */
  const nodeLabelOf = useCallback((node?: LibTVNode | null) => {
    if (!node) return '';
    const label = (node.data as { label?: string }).label;
    return label || NODE_TYPE_CONFIG[node.data.type as NodeType]?.label || '节点';
  }, []);

  /**
   * 克隆出一个新节点（粘贴用）。
   * - id 必须与源节点不同：`<类型>-copy-<时间戳>-<随机>`。
   *   刻意避开分镜节点的命名规则（shot-image-<shotId>-<scriptNodeId> 精确匹配）——
   *   克隆出来的节点是普通节点，不该被当成某个分镜的官方节点；
   *   同时保留类型前缀（如 style-），依赖前缀的类型判断（样式节点等）才不会丢。
   * - data 深拷贝（图上/文案/Prompt 全部带走），但清掉运行态字段：
   *   克隆节点没在跑，不该继承「生成中/失败/已过期」。
   */
  const buildClonedNode = useCallback((source: LibTVNode, position: { x: number; y: number }): LibTVNode => {
    const nodeType = (source.type || source.data.type) as NodeType;
    const data = JSON.parse(JSON.stringify(source.data ?? {})) as LibTVNode['data'];
    const mutable = data as Record<string, unknown>;
    mutable.status = 'idle';
    mutable.progressMessage = undefined;
    mutable.error = undefined;
    mutable.stale = false;
    if ('isEditing' in mutable) mutable.isEditing = false;
    return createNode(nodeType, position, {
      id: `${nodeType}-copy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      data,
      style: { ...(source.style ?? {}) },
    });
  }, []);

  /** 复制节点（不传 id 时用当前选中的节点） */
  const handleCopyNode = useCallback((nodeId?: string) => {
    const id = nodeId || selectedNodeIds[0];
    const node = id ? nodes.find((n) => n.id === id) : undefined;
    if (!node) {
      message.warning('请先选中一个节点再复制');
      return;
    }
    setClipboardNode(node);
    message.success({ content: `已复制节点「${nodeLabelOf(node)}」`, key: 'node-clip' });
  }, [nodes, selectedNodeIds, nodeLabelOf]);

  /**
   * 粘贴节点（克隆）。
   * @param at 画布坐标落点（右键空白处粘贴时为鼠标位置）
   * @param sourceNodeId 在某个节点上右键粘贴时，落点贴着该节点的右下角
   */
  const handlePasteNode = useCallback((at?: { x: number; y: number }, sourceNodeId?: string) => {
    if (!clipboardNode) {
      message.warning('剪贴板里还没有节点，先「复制节点」');
      return;
    }
    const from = (sourceNodeId ? nodes.find((n) => n.id === sourceNodeId) : undefined) ?? clipboardNode;
    const position = at ?? { x: from.position.x + 40, y: from.position.y + 40 };
    const clone = buildClonedNode(clipboardNode, position);
    addNode(clone);
    // 选中新节点：提示词面板会直接跟着它打开，便于继续改
    onNodesChange([{ type: 'select', id: clone.id, selected: true }]);
    message.success({ content: '已粘贴节点', key: 'node-clip' });
  }, [clipboardNode, nodes, buildClonedNode, addNode, onNodesChange]);

  /** 删除节点：不传 id 时删除当前所有选中的节点（可用 Ctrl/Cmd+Z 撤销） */
  const handleDeleteNodes = useCallback((nodeId?: string) => {
    const ids = nodeId ? [nodeId] : selectedNodeIds;
    if (ids.length === 0) {
      message.warning('请先选中一个节点再删除');
      return;
    }
    removeNodes(ids);
    message.success(`已删除 ${ids.length} 个节点（Ctrl/Cmd+Z 可撤销）`);
  }, [selectedNodeIds, removeNodes]);

  // Ctrl/Cmd+C / Ctrl/Cmd+V：画布上快速克隆节点。
  // 输入场景一律交回浏览器默认行为（焦点在输入框/可编辑区，或页面里有文本被选中）。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== 'c' && key !== 'v') return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (window.getSelection()?.toString()) return;
      if (key === 'c') {
        if (selectedNodeIds.length === 0) return; // 没选中就别抢浏览器默认行为
        e.preventDefault();
        handleCopyNode();
      } else {
        if (!clipboardNode) return;
        e.preventDefault();
        handlePasteNode();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedNodeIds, clipboardNode, handleCopyNode, handlePasteNode]);

  /**
   * 接收「左侧资产库拖出来的资产」：面板松手时把 (资产, 屏幕坐标) 投递过来，
   * 这里判断坐标是否落在画布区域内，是就在该点建节点。
   *
   * 为什么不用 HTML5 拖放的 dragover/drop：实测拖出来松手毫无反应（事件是否算作
   * "可放置的拖拽"由浏览器决定，还受内部组件处理影响）。指针拖拽由两边自己的代码闭环，
   * 判定只看坐标，所以一定会生效。
   */
  /**
   * 画布的**唯一落点分发器**：画布上"外部内容进入画布"的所有来源都汇到这里，
   * 之后只有一条创建路径（createMediaNodeAt）。
   *
   * 为什么要分两个适配器：系统文件拖入只能通过 HTML5 的 dragover/drop 感知
   * （指针事件看不到来自操作系统的拖拽，这是浏览器的物理边界）；资产库的资产是页面内部
   * 元素，走指针拖拽最可靠（HTML5 draggable 在本项目里实测无效）。
   * 但两者的差别只停留在"怎么感知"，一旦拿到「坐标 + 内容」，后面的类型判定、
   * 坐标换算、建节点、选中、提示全部共用。
   */
  const handleCanvasDrop = useCallback(
    async (drop: CanvasDrop) => {
      const pos = screenToFlowPosition({ x: drop.x, y: drop.y });

      // —— 来源：左侧资产库（已经是可用的 URL，不需要上传）——
      if (drop.source === 'asset') {
        const { asset } = drop;
        const nodeType: NodeType = asset.type === 'video' ? 'video' : 'image';
        createMediaNodeAt(nodeType, pos, { url: asset.url, name: asset.name });
        message.success({ content: `已放入画布：${asset.name || '未命名'}`, key: 'asset-insert' });
        return;
      }

      // —— 来源：系统文件（先上传拿 URL，再落到画布；多文件按 80px 错开）——
      const items = drop.files
        .map((f) => ({ f, kind: mediaKindOfFile(f) }))
        .filter((x): x is { f: File; kind: 'image' | 'video' | 'audio' } => x.kind !== null);
      if (items.length === 0) return;

      let idx = 0;
      for (const { f, kind } of items) {
        const key = `canvas-drop-${f.name}-${Date.now()}-${idx}`;
        const at = { x: pos.x + idx * 80, y: pos.y + idx * 80 };
        try {
          if (kind === 'image') {
            const res = await uploadImage(f, projectId || undefined);
            createMediaNodeAt('image', at, {
              url: res.url,
              thumbUrl: res.thumbUrl,
              width: res.width,
              height: res.height,
            });
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
            createMediaNodeAt('video', at, { url: res.url });
            message.success({ content: `「${f.name}」上传完成`, key, duration: 2 });
          } else {
            message.loading({ content: `上传中「${f.name}」0%`, key, duration: 0 });
            const url = await uploadAudio(
              f,
              (pct) => message.loading({ content: `上传中「${f.name}」${pct}%`, key, duration: 0 }),
              projectId || undefined
            );
            createMediaNodeAt('audio', at, { url });
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
    [screenToFlowPosition, createMediaNodeAt, projectId]
  );

  // 适配器一（资产库资产）：面板松手时投递「资产 + 屏幕坐标」，坐标不在画布内则放弃
  useEffect(() => {
    setAssetDropHandler(({ asset, x, y }) => {
      const wrap = canvasWrapRef.current;
      if (!wrap) return;
      const el = document.elementFromPoint(x, y);
      if (!el || !wrap.contains(el)) {
        message.info('请把资产拖到画布区域内');
        return;
      }
      void handleCanvasDrop({ source: 'asset', x, y, asset });
    });
    return () => setAssetDropHandler(null);
  }, [handleCanvasDrop, message]);

  // 适配器二（系统文件）：只有 types 含 Files 时才允许放置
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

  const handleDropFiles = useCallback(
    (e: React.DragEvent) => {
      const files = Array.from(e.dataTransfer.files || []);
      if (files.length === 0) return;
      e.preventDefault();
      void handleCanvasDrop({ source: 'files', x: e.clientX, y: e.clientY, files });
    },
    [handleCanvasDrop]
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
    && !promptSuppressed
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

  // 画布容器在页面中的原点。
  // flowToScreenPosition() 返回的是「页面坐标」，而面板是用 left/top 定位在容器**内部**的，
  // 两者差一个容器原点（本页容器 top=40px，来自顶部栏），不减掉面板就整块偏低 40px：
  // 于是"面板顶边到节点底边的缝" = 40 − 20×zoom，48% 缩放下有 30px 的缝（看着没贴合），
  // 150% 时只剩 10px（看着最贴合）—— 就是"不同缩放档位贴合程度不一样"的真正原因。
  const [containerOffset, setContainerOffset] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const update = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setContainerOffset((prev) =>
        prev.x === rect.left && prev.y === rect.top ? prev : { x: rect.left, y: rect.top },
      );
    };
    update();
    window.addEventListener('resize', update);
    const observer = new ResizeObserver(update);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => {
      window.removeEventListener('resize', update);
      observer.disconnect();
    };
  }, []);

  // 计算提示词框的位置 — 拖动期间不更新
  const promptPosition = useMemo(() => {
    if (!selectedNode || promptSuppressed) return null;
    // 从 store 取最新节点数据（measured 可能异步更新，selectedNode 可能是旧的）
    const latestNode = getNodes().find((n) => n.id === selectedNode.id);
    const node = latestNode || selectedNode;
    // nodeOrigin [0.5, 0.5] → position 是中心点，底部 = position.y + height/2
    const nodeBottomY = node.position.y + (node.measured?.height || 200) / 2;
    // ① 先换成页面坐标 ② 再减掉容器原点，才是容器内 left/top 该用的值
    // ③ 间距用固定屏幕像素，避免"面板与节点的缝随缩放变化"
    const screen = flowToScreenPosition({ x: node.position.x, y: nodeBottomY });
    return {
      x: screen.x - containerOffset.x,
      y: screen.y - containerOffset.y + PROMPT_PANEL_GAP_PX,
    };
  }, [selectedNode?.id, promptSuppressed, flowToScreenPosition, viewport, getNodes, containerOffset]);

  return (
    <div ref={containerRef} className="w-full h-full relative bg-[var(--dv-canvas-bg)]" onContextMenu={handleContextMenu}>
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
      <div
        ref={canvasWrapRef}
        className="w-full h-full"
        onDragOver={handleDragOverCanvas}
        onDrop={handleDropFiles}
      >
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
        onNodeDragStart={(_event, node) => {
          dragStartPosRef.current = { x: node.position.x, y: node.position.y };
          setPromptSuppressed(true);
        }}
        onNodeDragStop={(_event, node, draggedNodes) => {
          const start = dragStartPosRef.current;
          dragStartPosRef.current = null;
          const moved = !!start && Math.hypot(node.position.x - start.x, node.position.y - start.y) > 2;
          // 拖动开始时抑制了面板，这里必须无条件复位：手抖的单击同样会走 dragStart/dragStop，
          // 而 React Flow 会把"拖动之后"的 click 吞掉（onNodeClick 不触发），若不复位就会留下
          // 「节点选中着、面板却不出现」的坏状态。真拖动时选中态会被清掉，复位也无副作用。
          setPromptSuppressed(false);
          // 只是手抖的单击：选中态保持原样，面板照常打开
          if (!moved) return;
          // 真拖动：拖动开始时面板已经收起，拖动结束后把选中态也一并清掉，
          // 否则会留下「有蓝色选中框、却没有提示词面板」的不一致状态。
          onNodesChange(draggedNodes.map((n) => ({ type: 'select' as const, id: n.id, selected: false })));
        }}
        onNodeClick={() => { setPromptSuppressed(false); }}
        onMouseDown={(e) => {
          // 画布空白区域按下鼠标（框选/平移）→ 抑制提示框
          if ((e.target as HTMLElement).classList.contains('react-flow__pane')) {
            setPromptSuppressed(true);
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
        {/* 点阵颜色跟随暗色主题（React Flow 默认是浅灰点，暗底上会看不见/刺眼） */}
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#243352" />

      </ReactFlow>
      </div>
      )}

      {/* 空画布引导：融入画布的虚线占位（非弹窗），0 节点且未手动关闭时展示 */}
      {!dismissedEmptyGuide && !isLoading && nodes.length === 0 && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <div className="relative w-[620px] max-w-[94%] rounded-2xl border-2 border-dashed border-white/15 bg-[rgba(21,30,49,0.5)] backdrop-blur-[2px] px-8 py-9">
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
              右键画布即可随时添加节点
            </div>
          </div>
        </div>
      )}

      {/* 图片/视频节点右键菜单 */}
      {nodeMenu && (
        <NodeContextMenu
          position={{ x: nodeMenu.x, y: nodeMenu.y }}
          nodeType={nodeMenu.nodeType}
          url={nodeMenu.url || undefined}
          name={nodeMenu.name}
          nodeId={nodeMenu.nodeId}
          onUpdateNode={updateNodeData}
          onShowHistory={(nid, nt, curUrl) => setHistoryModal({ nodeId: nid, nodeType: nt, currentUrl: curUrl })}
          canPaste={!!clipboardNode}
          onCopy={() => handleCopyNode(nodeMenu.nodeId)}
          onPaste={() => handlePasteNode(undefined, nodeMenu.nodeId)}
          onDelete={() => handleDeleteNodes(nodeMenu.nodeId)}
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
            // ⚠️ 不能只改 imageUrl/videoUrl：节点渲染时**优先用随媒体派生的字段**，
            // 图片节点的 <img src> 就是 `thumbUrl || 推导缩略图 || 原图`。
            // 只换 imageUrl 会让 src 原地不动 → onLoad/onError 都不触发 →
            // 节点永远停在 loading（而且画面还是旧图）。尺寸/时长同理，
            // 留着就按上一张图的比例显示。清空后由节点各自的 fallback 重新推导/实测。
            if (historyModal.nodeType === 'image') {
              updateNodeData(historyModal.nodeId, {
                imageUrl: selectedUrl,
                // ⚠️ 缩略图必须**换成新图的**，不能只是清空：后端把 thumbUrl 当"粘性产物"
                // （保存时发现缺这个字段就把旧画布的值补回来），清空反而会被粘回上一张图的
                // 缩略图 → 画布上缩略图优先渲染 → 保存后刷新又显示回老图。
                thumbUrl: deriveThumbUrl(selectedUrl),
                width: undefined,
                height: undefined,
              });
            } else {
              updateNodeData(historyModal.nodeId, {
                videoUrl: selectedUrl,
                duration: undefined,
                videoWidth: undefined,
                videoHeight: undefined,
              });
            }
          }}
          onClose={() => setHistoryModal(null)}
        />
      )}

      {nodeSelectPopup && (
        <NodeSelectPopup
          position={nodeSelectPopup.position}
          onSelect={handleNodeSelect}
          onClose={() => setNodeSelectPopup(null)}
          selectedLabel={selectedNode ? nodeLabelOf(selectedNode) : null}
          canCopy={selectedNodeIds.length > 0}
          canPaste={!!clipboardNode}
          onCopy={() => handleCopyNode()}
          onPaste={() => handlePasteNode(
            screenToFlowPosition(nodeSelectPopup.position),
            nodeSelectPopup.sourceNodeId ?? undefined,
          )}
          onDelete={() => handleDeleteNodes()}
        />
      )}

      {/* 选中节点时的提示词编辑组件 */}
      {hasPromptPanel && promptPosition && !selectedNode!.data.isEditing && (
        <div
          /* 桌面：跟随节点锚定（内联 left/top + 水平居中）。
             移动端（<768px）改为吸底整宽面板：视口只有 390px 时 750px 的卡片实测左溢 270px、
             右溢 90px，屏幕上只露 ~120px，等于没法用。用 max-md: + ! 覆盖内联定位，
             桌面那套锚定逻辑一行不改。 */
          className="absolute pointer-events-none
            max-md:!fixed max-md:!inset-x-2 max-md:!top-auto max-md:!bottom-2 max-md:!transform-none
            max-md:!max-h-[60vh] max-md:!overflow-y-auto max-md:!pointer-events-auto"
          style={{
            left: promptPosition.x,
            top: promptPosition.y,
            transform: 'translateX(-50%)',
            zIndex: 1000,
          }}
        >
          {/* 箭头（移动端是吸底面板，箭头指向节点已无意义） */}
          <div
            className="absolute left-1/2 -translate-x-1/2 max-md:hidden"
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
