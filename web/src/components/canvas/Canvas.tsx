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
  ArrowRightOutlined,
  DeploymentUnitOutlined,
  FormatPainterOutlined,
  GroupOutlined,
} from '@ant-design/icons';

import { useCanvasStore } from '@/stores/canvasStore';
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
import { absolutePositionIn, absolutePositionOf } from '@/utils/canvasGroups';
import { setAssetDropHandler } from '@/components/canvas/assetDnd';
import { deriveThumbUrl } from '@/utils/thumbUrl';
import { mediaKindOfFile, mediaFieldsFor, titleFromFileName } from '@/utils/mediaNode';
import type { UserAsset } from '@/services/assetApi';
import { uploadImage, uploadVideo, uploadAudio } from '@/services/uploadApi';
import { canvasApi } from '@/services/canvasApi';

/**
 * 空画布引导卡片的「场景」入口。
 *
 * 为什么给场景而不是单节点：原来的 5 个节点按钮只是「新建一个空节点」——
 * 建完还要自己连线、改名、想清楚该接什么，而真实用法基本都是固定搭配
 * （剧本→分镜→分镜图→视频）。所以这里直接列出几种成片路径，点一下把整条链路建好。
 */
const EMPTY_GUIDE_SCENARIOS: {
  key: string;
  title: string;
  desc: string;
  /** 要创建的节点链：type + 节点标题（标题写进 data.label，省得建完还要手动改名） */
  chain: { type: NodeType; label: string }[];
}[] = [
  {
    key: 'story',
    title: '剧本创作',
    desc: '写清故事梗概，一键拆成分镜剧本',
    chain: [{ type: 'text', label: '文本' }, { type: 'script', label: '分镜' }],
  },
  {
    key: 'storyboard',
    title: '分镜出图',
    desc: '按分镜逐镜生成画面，锁定角色一致性',
    chain: [{ type: 'script', label: '分镜' }, { type: 'image', label: '分镜图' }],
  },
  {
    key: 'i2i',
    title: '图生图',
    desc: '基于原图改画面、换风格或换构图',
    chain: [{ type: 'image', label: '原图' }, { type: 'image', label: '生成图' }],
  },
  {
    key: 'i2v',
    title: '图生视频',
    desc: '把静态画面变成动态镜头',
    chain: [{ type: 'image', label: '首帧图' }, { type: 'video', label: '视频' }],
  },
];

/** 链路预览的小图标（按节点类型静态给出，不做运行时按名查表） */
const NODE_ICONS: Record<NodeType, React.ReactNode> = {
  text: <FileTextOutlined />,
  script: <SnippetsOutlined />,
  image: <PictureOutlined />,
  video: <VideoCameraOutlined />,
  audio: <AudioOutlined />,
  previz: <DeploymentUnitOutlined />,
  enhance: <FormatPainterOutlined />,
  group: <GroupOutlined />,
};

/** 场景链里相邻两个节点的水平间距（画布坐标；节点宽 + 这个间距 = 中心距） */
const CHAIN_GAP = 120;

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
  /** 组合内拖成员时的起点信息（鼠标屏幕/画布坐标 + 成员当时的绝对中心） */
  const dragStartPointerRef = useRef<{ pointer: { x: number; y: number }; frame: { rect: DOMRect | null; vp: { x: number; y: number; zoom: number } }; flow: { x: number; y: number }; abs: { x: number; y: number } } | null>(null);
  // 防止 onPaneClick 在连线释放时误关弹窗
  const connectingRef = useRef(false);
  // 拖拽连线中：源节点 ID + 当前悬停的目标节点 ID（目标节点放大 + 高亮 outline）
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [connectTargetId, setConnectTargetId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  // 空画布引导卡片：手动关闭后本次会话不再弹出
  const [dismissedEmptyGuide, setDismissedEmptyGuide] = useState(false);
  const { fitView, screenToFlowPosition, flowToScreenPosition, getNodes, getViewport, setViewport: rfSetViewport } = useReactFlow();

  // ✅ 性能优化：使用useShallow避免数组引用变化触发重渲染
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, selectedNodeIds, updateNodeData, updateNodeMeta, addNode, addEdge, addNodesAndEdges, removeNodes, projectId, createMediaNodeAt, groupSelectedNodes, ungroupNode, syncGroupBounds, placeMemberAtAbsolute } = useCanvasStore(
    useShallow((s) => ({
      nodes: s.nodes,
      edges: s.edges,
      onNodesChange: s.onNodesChange,
      onEdgesChange: s.onEdgesChange,
      onConnect: s.onConnect,
      selectedNodeIds: s.selectedNodeIds,
      updateNodeData: s.updateNodeData,
      updateNodeMeta: s.updateNodeMeta,
      addNode: s.addNode,
      addEdge: s.addEdge,
      addNodesAndEdges: s.addNodesAndEdges,
      removeNodes: s.removeNodes,
      createMediaNodeAt: s.createMediaNodeAt,
      projectId: s.projectId,
      groupSelectedNodes: s.groupSelectedNodes,
      ungroupNode: s.ungroupNode,
      syncGroupBounds: s.syncGroupBounds,
      placeMemberAtAbsolute: s.placeMemberAtAbsolute,
    }))
  );

  const canUndo = useCanvasStore((s) => s.canUndo);
  const canRedo = useCanvasStore((s) => s.canRedo);
  const undo = useCanvasStore((s) => s.undo);
  const redo = useCanvasStore((s) => s.redo);

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
    // 组合是容器不是素材：复制出来是个没有成员的空框（还得手工往里塞节点，等于没用），
    // 所以和删除一样不允许 —— 要走「取消组合 → 复制成员 → 重新组合」。
    if (node.type === 'group') {
      message.warning('组合节点不支持复制，请先用「取消组合」');
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
    if (clipboardNode.type === 'group') {
      // 兜底：剪贴板里若是组合（历史剪贴板 / 漏网入口），粘贴出来同样是空框
      message.warning('组合节点不支持复制，请先用「取消组合」');
      return;
    }
    const from = (sourceNodeId ? nodes.find((n) => n.id === sourceNodeId) : undefined) ?? clipboardNode;
    // 绝对坐标：from 若是组合成员，position 是相对组合的
    const fromAbs = absolutePositionIn(nodes, from);
    const position = at ?? { x: fromAbs.x + 40, y: fromAbs.y + 40 };
    const clone = buildClonedNode(clipboardNode, position);
    addNode(clone);
    // 选中新节点：提示词面板会直接跟着它打开，便于继续改
    onNodesChange([{ type: 'select', id: clone.id, selected: true }]);
    message.success({ content: '已粘贴节点', key: 'node-clip' });
  }, [clipboardNode, nodes, buildClonedNode, addNode, onNodesChange]);

  /** 删除节点：不传 id 时删除当前所有选中的节点（可用 Ctrl/Cmd+Z 撤销） */
  const handleDeleteNodes = useCallback((nodeId?: string) => {
    const ids = (nodeId ? [nodeId] : selectedNodeIds).filter(
      (id) => nodes.find((n) => n.id === id)?.type !== 'group'
    );
    if (ids.length === 0) {
      // 菜单里组合已经没有「删除节点」项了，这里兜住快捷键等其它入口
      message.warning(
        selectedNodeIds.length > 0 ? '组合节点不能直接删除，请先用「取消组合」' : '请先选中一个节点再删除'
      );
      return;
    }
    removeNodes(ids);
    message.success(`已删除 ${ids.length} 个节点（Ctrl/Cmd+Z 可撤销）`);
  }, [selectedNodeIds, removeNodes, nodes]);

  /**
   * 组合：把当前框选/多选的节点收进一个组合（拖动时整组一起走）。
   * 只作用于「当前选中集合」——右键菜单里的项会按选中数量置灰，不会出现作用对象说不清的情况。
   */
  const handleGroupNodes = useCallback(() => {
    if (groupSelectedNodes()) {
      // 措辞不写 Ctrl/Cmd+Z：画布没有实现这个快捷键（撤销/重做只在画布工具条的按钮上），写了会误导
      message.success({ content: '已组合选中节点（可用画布工具条的撤销回退）' });
    } else {
      message.warning('请先框选至少 2 个节点再组合（也可 Shift / ⌘ / Ctrl + 点击多选）');
    }
  }, [groupSelectedNodes]);

  /** 取消组合：成员回到各自的位置并保持选中（组合节点本身被删掉） */
  const handleUngroupNode = useCallback((groupId: string) => {
    if (ungroupNode(groupId)) {
      message.success({ content: '已取消组合（可用画布工具条的撤销回退）' });
    }
  }, [ungroupNode]);

  /**
   * 屏幕坐标 → 画布坐标（**不做网格吸附**）。
   * 拖动落点校准必须用它：React Flow 的 screenToFlowPosition 默认 snapToGrid=true，
   * 起止两点各自吸附后相减，位移会莫名少掉十几像素（实测 195px 的鼠标位移只换算出 176）。
   * 这里只用「容器矩形 + viewport 平移/缩放」做纯线性换算，与画布自身渲染坐标完全一致。
   */
  const captureFrame = useCallback(
    () => ({ rect: containerRef.current?.getBoundingClientRect() ?? null, vp: getViewport() }),
    [getViewport]
  );
  const screenToFlowInFrame = useCallback(
    (frame: { rect: DOMRect | null; vp: { x: number; y: number; zoom: number } }, clientX: number, clientY: number) => {
      if (!frame.rect) return { x: clientX, y: clientY };
      return {
        x: (clientX - frame.rect.left - frame.vp.x) / frame.vp.zoom,
        y: (clientY - frame.rect.top - frame.vp.y) / frame.vp.zoom,
      };
    },
    []
  );

  /**
   * 键盘 Delete/Backspace 的前置钩子。
   *
   * 组合节点**不作为可删除对象**：命中组合时直接不删（与右键菜单一致），只提示一句
   * 怎么真正拿掉它（先「取消组合」）；成员节点照常可删。
   *
   * 顺带挡住了 React Flow 的默认行为「删父节点时连子节点一起删」
   * （@xyflow/system getElementsToRemove 的 parentHit 规则）：组合根本不进删除集合，
   * 成员也就不会被容器的删除连坐（成员是用户生成的资产）。
   *
   * 这里同时补提示：Delete 键走的是 React Flow 自己的删除（不经过 handleDeleteNodes），
   * 原来批量删除后**一点反馈都没有** —— 删了几个、能不能撤销都不知道。
   */
  const handleBeforeDelete = useCallback(
    async ({ nodes: toDelete, edges: edgesToDelete }: { nodes: LibTVNode[]; edges: LibTVEdge[] }) => {
      const groups = toDelete.filter((n) => n.type === 'group');
      if (groups.length === 0) {
        if (toDelete.length > 0) {
          message.success({ content: `已删除 ${toDelete.length} 个节点（Ctrl/Cmd+Z 可撤销）`, key: 'node-batch-delete' });
        }
        return { nodes: toDelete, edges: edgesToDelete };
      }
      const groupIds = new Set(groups.map((n) => n.id));
      // React Flow 会把组合的子节点一并塞进删除集合（parentHit 规则）。这些"被连坐"的成员用户
      // 根本没选（selected=false）：必须摘出来，否则成员被删空后组合会按"空组合自动清理"的规则消失
      // —— 表现就是"按了 Delete，组合和里面的节点全没了"（正是要避免的那件事）。
      // 用户显式选中（selected=true）的成员照常删：那是他点名要删的，删完空组合才跟着收掉。
      const kept = toDelete.filter((n) => {
        if (n.type === 'group') return false;
        if (n.parentId && groupIds.has(n.parentId) && !n.selected) return false;
        return true;
      });
      message.warning({ content: '组合节点不能直接删除，请先用「取消组合」', key: 'group-no-delete' });
      const keptIds = new Set(kept.map((n) => n.id));
      return {
        nodes: kept,
        // 只留下两端都还在的连线，避免删掉一份却被留下的悬空边
        edges: edgesToDelete.filter((e) => keptIds.has(e.source) && keptIds.has(e.target)),
      };
    },
    []
  );

  // Ctrl/Cmd+C / Ctrl/Cmd+V：画布上快速克隆节点。
  // Ctrl/Cmd+Z 撤销、Ctrl/Cmd+Shift+Z 重做：删除提示里写了「可撤销」，这里把它兑现
  // （批量删除后误删一片节点是最需要撤销的场景）。
  // 输入场景一律交回浏览器默认行为（焦点在输入框/可编辑区，或页面里有文本被选中）——
  // 提示词框的 @ 引用编辑器也是可编辑区，它自己要吃 Ctrl+Z。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== 'c' && key !== 'v' && key !== 'z') return;
      if (e.shiftKey && key !== 'z') return; // Shift+Z 才是重做；Shift+C/V 交回浏览器
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (window.getSelection()?.toString()) return;
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
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
  }, [selectedNodeIds, clipboardNode, handleCopyNode, handlePasteNode, undo, redo]);

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
  /** 从 URL 末段取文件名（去掉 query/hash），取不到就返回空串 */
  const fileNameFromUrl = (url: string): string => {
    try {
      const path = url.split('?')[0].split('#')[0];
      const seg = path.split('/').filter(Boolean).pop() || '';
      return decodeURIComponent(seg);
    } catch {
      return '';
    }
  };

  const handleCanvasDrop = useCallback(
    async (drop: CanvasDrop) => {
      const pos = screenToFlowPosition({ x: drop.x, y: drop.y });

      // —— 来源：左侧资产库（已经是可用的 URL，不需要上传）——
      if (drop.source === 'asset') {
        const { asset } = drop;
        const nodeType: NodeType = asset.type === 'video' ? 'video' : 'image';
        // 资产名优先；历史资产里有 name 为空的（入库时就没带名字），退回从 URL 里取文件名，
        // 总比让节点顶着「图片」这种通用名强（否则几个节点在画布上完全分不清）
        const name = asset.name?.trim() || fileNameFromUrl(asset.url);
        createMediaNodeAt(nodeType, pos, { url: asset.url, name });
        // 提示语用和节点标题同一套规则（去扩展名），否则「提示写 cat.png、节点写 cat」两边对不上
        message.success({ content: `已放入画布：${titleFromFileName(name) || '未命名'}`, key: 'asset-insert' });
        return;
      }

      // —— 来源：系统文件（**先建节点占位、再上传**；多文件按 80px 错开）——
      //
      // 为什么是这个顺序：上传是整条流程里最慢的一步（大图、视频几十秒，视频还要转码），
      // 以前是「上传完拿到 URL 才 createMediaNodeAt」，用户拖完盯着画布半天没动静，
      // 分不清是在传还是根本没反应。现在节点立刻出现并显示「上传中 xx%」，
      // 传完再把 URL 填回同一个节点（走 mediaFieldsFor 这个唯一出口）。
      const items = drop.files
        .map((f) => ({ f, kind: mediaKindOfFile(f) }))
        .filter((x): x is { f: File; kind: 'image' | 'video' | 'audio' } => x.kind !== null);
      if (items.length === 0) return;

      const pending = items.map(({ f, kind }, i) => {
        const at = { x: pos.x + i * 80, y: pos.y + i * 80 };
        const node = createMediaNodeAt(kind, at, {
          url: '', // 占位：URL 还没有，节点先显示上传态
          name: f.name,
          uploading: true,
          uploadPhase: kind === 'image' ? '图片上传中' : '上传中',
        });
        return { f, kind, node };
      });

      let done = 0;
      for (const { f, kind, node } of pending) {
        const key = `canvas-drop-${f.name}-${node.id}`;
        // 进度只写进节点数据，不进历史、不置脏（updateNodeMeta）——否则一次上传会塞满撤销栈
        const onProgress = (pct: number, phase?: 'uploading' | 'processing') =>
          updateNodeMeta(node.id, {
            uploadProgress: pct,
            uploadPhase: phase === 'processing' ? '转码中' : '上传中',
          });
        try {
          if (kind === 'image') {
            const res = await uploadImage(f, projectId || undefined);
            updateNodeData(
              node.id,
              mediaFieldsFor('image', {
                url: res.url,
                thumbUrl: res.thumbUrl,
                width: res.width,
                height: res.height,
              }) as Partial<LibTVNode['data']>
            );
          } else if (kind === 'video') {
            message.loading({ content: `上传中「${f.name}」0%`, key, duration: 0 });
            const res = await uploadVideo(
              f,
              (pct, phase) => {
                onProgress(pct, phase);
                message.loading({
                  content: phase === 'processing' ? `转码中「${f.name}」${pct}%` : `上传中「${f.name}」${pct}%`,
                  key,
                  duration: 0,
                });
              },
              projectId || undefined
            );
            updateNodeData(node.id, mediaFieldsFor('video', { url: res.url }) as Partial<LibTVNode['data']>);
            message.success({ content: `「${f.name}」上传完成`, key, duration: 2 });
          } else {
            message.loading({ content: `上传中「${f.name}」0%`, key, duration: 0 });
            const url = await uploadAudio(
              f,
              (pct) => {
                onProgress(pct);
                message.loading({ content: `上传中「${f.name}」${pct}%`, key, duration: 0 });
              },
              projectId || undefined
            );
            updateNodeData(node.id, mediaFieldsFor('audio', { url }) as Partial<LibTVNode['data']>);
            message.success({ content: `「${f.name}」上传完成`, key, duration: 2 });
          }
          done++;
        } catch (err) {
          message.destroy(key);
          // HTTP 错误已由 axios 拦截器统一提示
          console.error('画布拖拽上传失败:', err);
          // 节点已经在画布上了：把失败原因写在节点上，别留一个看不出所以然的空白节点
          updateNodeData(
            node.id,
            mediaFieldsFor(kind, {
              url: '',
              name: f.name,
              uploading: false,
              uploadError: '上传失败，删除该节点后可重试',
            }) as Partial<LibTVNode['data']>
          );
        }
      }

      // 上传结束后自动保存画布：节点是上传前就建出来的，这一步让画布上的状态（含失败节点）真正落盘
      if (pending.length > 0 && projectId) {
        try {
          const { exportCanvas, setDirty } = useCanvasStore.getState();
          await canvasApi.saveCanvas(projectId, exportCanvas());
          setDirty(false);
          message.success(
            done === pending.length
              ? `已添加 ${pending.length} 个节点并自动保存`
              : `已上传 ${done}/${pending.length} 个文件并自动保存（失败的节点上有原因）`
          );
        } catch (err) {
          // 保存失败：拦截器已提示；节点仍在内存（isDirty=true），可手动保存兜底
          console.error('拖拽上传后自动保存失败:', err);
        }
      }
    },
    [screenToFlowPosition, createMediaNodeAt, updateNodeData, updateNodeMeta, projectId]
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

  /**
   * 场景快捷创建：一次把整条链路建好（节点 + 连线 + 居中布局）。
   *
   * 取景不能紧跟着 setState 调 fitView：fitView 读的是 React Flow 内部 store，
   * 那一份要等 re-render 才同步，立刻调用会按「还没有这些节点」的画面去取景。
   * 所以这里只置个标记，由下面的 effect 在 nodes 更新后再取景。
   */
  const pendingFitRef = useRef(false);
  useEffect(() => {
    if (!pendingFitRef.current) return;
    pendingFitRef.current = false;
    // maxZoom 防止只有两个节点时被放到巨大
    fitView({ padding: 0.3, duration: 400, maxZoom: 1 });
  }, [nodes, fitView]);

  const applyScenario = useCallback(
    (scenario: (typeof EMPTY_GUIDE_SCENARIOS)[number]) => {
      const el = containerRef.current;
      const rect = el?.getBoundingClientRect();
      const center = rect
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      const flowCenter = screenToFlowPosition(center);

      // nodeOrigin 是 [0.5,0.5]，坐标即节点中心；先按各类型默认宽度算出整条链的总宽，
      // 再从中心往两边排，保证整组落在视口正中（只居中第一个节点会歪到右边去）
      const widths = scenario.chain.map(
        (step) => Number(createNode(step.type, { x: 0, y: 0 }).style?.width) || 320
      );
      const totalWidth =
        widths.reduce((sum, w) => sum + w, 0) + CHAIN_GAP * (scenario.chain.length - 1);
      let cursor = flowCenter.x - totalWidth / 2;
      const nodes = scenario.chain.map((step, i) => {
        const node = createNode(
          step.type,
          { x: cursor + widths[i] / 2, y: flowCenter.y },
          { data: { label: step.label } }
        );
        cursor += widths[i] + CHAIN_GAP;
        return node;
      });
      const edges: LibTVEdge[] = nodes.slice(1).map((node, i) => ({
        // 连线 id 统一成 e-{source}-{target}（与 Canvas 其它入口、shotNodeSync 等保持一致）
        id: `e-${nodes[i].id}-${node.id}`,
        source: nodes[i].id,
        target: node.id,
        type: 'dataFlow',
      }));

      // 整组一次提交：一次撤销即可整组回退（逐个 addNode/addEdge 会占掉多条历史）
      addNodesAndEdges(nodes, edges);
      pendingFitRef.current = true;
      // 选中链路首节点 → 自动打开提示词面板，用户点完就能直接开始
      onNodesChange([{ type: 'select', id: nodes[0].id, selected: true }]);
    },
    [screenToFlowPosition, addNodesAndEdges, onNodesChange]
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

  /**
   * 菜单里「组合选中的 N 个节点」以 React Flow 的 selected **标记**为准，而不是 selectedNodeIds：
   * 标记就是画面上蓝色选中框的来源，也是 React Flow 自己按 Delete 时的依据；而 selectedNodeIds
   * 在撤销/重做之后可能与标记不同步（历史快照恢复的是标记），读它会出现"菜单写 3 个、实际组合 1 个"。
   */
  const selectedFlagIds = useMemo(() => nodes.filter((n) => n.selected).map((n) => n.id), [nodes]);

  /** 当前选中的唯一节点如果是组合 → 右键菜单/空白菜单给「取消组合」 */
  const selectedGroupId = selectedNodeIds.length === 1
    ? (nodes.find((n) => n.id === selectedNodeIds[0] && n.type === 'group')?.id ?? null)
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
    && !selectedNode.data.styleId;
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
    // ⚠️ 组合成员（parentId）的 position 是**相对组合左上角**的，不是绝对坐标：
    // 直接拿来算，提示词框就会跑到画布中间去（用户报的「组合里的节点选中后提示词框位置不对」）。
    const abs = absolutePositionIn(getNodes(), node);
    // nodeOrigin [0.5, 0.5] → 绝对坐标是中心点，底部 = y + height/2
    const nodeBottomY = abs.y + (node.measured?.height || 200) / 2;
    // ① 先换成页面坐标 ② 再减掉容器原点，才是容器内 left/top 该用的值
    // ③ 间距用固定屏幕像素，避免"面板与节点的缝随缩放变化"
    const screen = flowToScreenPosition({ x: abs.x, y: nodeBottomY });
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
        onNodeDragStart={(event, node) => {
          dragStartPosRef.current = { x: node.position.x, y: node.position.y };
          // 组合内拖单个成员时记下鼠标与成员的位置，松开时按鼠标实际位移校准落点（见 onNodeDragStop）
          const me = event as MouseEvent | undefined;
          if (node.parentId && me && typeof me.clientX === 'number') {
            const byId = new Map(useCanvasStore.getState().nodes.map((n) => [n.id, n]));
            // ⚠️ 基准帧（容器矩形 + viewport）必须在拖动开始时固定下来：拖动一开始提示词面板会收起，
            // 画布容器左边缘会平移十几像素，起止各读一次会让鼠标位移换算少掉约 16px。
            const frame = captureFrame();
            dragStartPointerRef.current = {
              pointer: { x: me.clientX, y: me.clientY },
              frame,
              flow: screenToFlowInFrame(frame, me.clientX, me.clientY),
              abs: absolutePositionOf(node, byId),
            };
          } else {
            dragStartPointerRef.current = null;
          }
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
          // 拖动结束那一帧 React Flow 还会补写一次子节点 position，所以统一延迟一帧再收尾：
          // ① 组合内拖单个成员 → 先按鼠标实际位移把成员摆回跟手的位置（RF 的父子坐标换算在框
          //    尺寸变化后有十几像素偏差）；② 再让组合框贴合成员。
          const info = dragStartPointerRef.current;
          dragStartPointerRef.current = null;
          const dropEvent = event as MouseEvent | undefined;
          if (info && node.parentId && draggedNodes.length === 1 && dropEvent && typeof dropEvent.clientX === 'number') {
            const stopFlow = screenToFlowInFrame(info.frame, dropEvent.clientX, dropEvent.clientY);
            const target = {
              x: info.abs.x + (stopFlow.x - info.flow.x),
              y: info.abs.y + (stopFlow.y - info.flow.y),
            };
            setTimeout(() => {
              placeMemberAtAbsolute(node.id, target);
              syncGroupBounds();
            }, 0);
          } else {
            setTimeout(() => syncGroupBounds(), 0);
          }
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
        /* zIndexMode="manual"：不让 React Flow 自动抬 z-index。
           默认（basic）下它给「组合成员」（有 parentId 的节点）z = 父 + 1 = 1，
           并且把**连到成员上的连线**也抬到同一个 z（@xyflow/system 的 getElevatedEdgeZIndex 源码注释原话：
           edges connected to nodes with a parent are rendered above the parent node）。
           后果就是：从组合里连出来的线会浮在普通节点（文本/图片…）上面，
           看起来像那些节点变透明了、盖不住线。
           改成 manual 后连线恒为 z=0（连线图层本就排在节点图层之前 → 永远在节点下面）；
           "选中的节点浮到最上层"由 index.css 里 .react-flow__node.selected 的 z-index 显式负责。 */
        zIndexMode="manual"
        nodeOrigin={nodeOrigin}
        defaultEdgeOptions={defaultEdgeOptions}
        proOptions={proOptions}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        snapToGrid
        snapGrid={[16, 16]}
        connectionRadius={40}
        minZoom={0.05}
        maxZoom={4}
        // 生成中不锁画布：拖节点、连线与生成互不影响（过去是 nodesDraggable={!isExecuting}，
        // 生成一次可能几十秒，期间用户完全没法整理画布，体验很差）。
        //
        // 为什么可以放开：
        //   - 后端在「点生成」那一刻就把画布解析成执行计划（engine.Parse），
        //     之后再拖动/连线都不会改变正在跑的这一次；
        //   - 节点位置从不参与执行，产物是按节点 id 回填的（拖动不影响回填，进度浮层跟着节点走）；
        //   - 平移/缩放本来就没被锁（panOnDrag/zoomOnScroll），被锁的只有「动节点」和「拉线」。
        // 仍受生成状态影响的只有节点内部的「生成」按钮（防止对同一节点重复下发）。
        nodesDraggable
        nodesConnectable
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
        onBeforeDelete={handleBeforeDelete}
        /* 多选键：Shift / ⌘ / Ctrl + 点击都能加选。
           React Flow 默认只认 Meta（⌘），原来这里写死成 "Shift" 就把默认值顶掉了 ——
           Windows/Linux 上按 Ctrl 点选没反应。三个都收，跟 Figma/Excalidraw 的习惯一致：
           空白处拖拽 = 框选（selectionOnDrag，平移已改到中键/右键），Shift/⌘/Ctrl+点击 = 加选。 */
        multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
        className="react-flow-cursor-default"
      >
        {/* 点阵颜色跟随暗色主题（React Flow 默认是浅灰点，暗底上会看不见/刺眼） */}
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#33353a" />

      </ReactFlow>
      </div>
      )}

      {/* 空画布引导：融入画布的虚线占位（非弹窗），0 节点且未手动关闭时展示。
            入口给的是「场景」而不是单个节点类型：点一下就把这组节点建好并连好线 */}
      {!dismissedEmptyGuide && !isLoading && nodes.length === 0 && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <div className="relative w-[780px] max-w-[94%] rounded-2xl border-2 border-dashed border-white/15 bg-[rgba(18,19,22,0.5)] backdrop-blur-[2px] px-8 py-8">
            <button
              className="absolute top-3 right-3 text-gray-300 hover:text-gray-500 cursor-pointer pointer-events-auto"
              onClick={() => setDismissedEmptyGuide(true)}
              title="关闭引导"
            >
              <CloseOutlined />
            </button>
            <div className="text-center">
              <div className="text-[16px] font-medium text-gray-600">选一个场景，直接搭好工作流</div>
              <div className="text-[12px] text-gray-400 mt-1">
                点一下即在画布上创建好这组节点并连好线；也可以把图片 / 视频 / 音频直接拖进画布
              </div>
            </div>
            <div className="flex flex-wrap justify-center gap-3 mt-6">
              {EMPTY_GUIDE_SCENARIOS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => applyScenario(s)}
                  className="pointer-events-auto flex flex-col items-start gap-2 w-[164px] rounded-xl bg-white border border-gray-200 hover:border-blue-400 hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer px-3.5 py-3 text-left"
                >
                  <span className="text-[13px] font-medium text-gray-700">{s.title}</span>
                  {/* 链路预览：先让用户看清点下去会创建哪几个节点、怎么接 */}
                  <span className="flex items-center gap-1">
                    {s.chain.map((step, i) => (
                      <span key={`${step.type}-${i}`} className="flex items-center gap-1">
                        {i > 0 && <ArrowRightOutlined className="text-[10px] text-gray-300" />}
                        <span
                          className="w-[22px] h-[22px] rounded-md flex items-center justify-center text-white text-[12px]"
                          style={{ backgroundColor: NODE_TYPE_CONFIG[step.type].color }}
                          title={step.label}
                        >
                          {NODE_ICONS[step.type]}
                        </span>
                      </span>
                    ))}
                  </span>
                  <span className="text-[11px] text-gray-400 leading-snug">{s.desc}</span>
                </button>
              ))}
            </div>
            <div className="text-[11px] text-gray-400 mt-5 text-center">
              右键画布可单独添加任意节点
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
          onDeleteSelection={() => handleDeleteNodes()}
          selectedCount={selectedFlagIds.includes(nodeMenu.nodeId) ? selectedFlagIds.length : 1}
          isGroup={nodeMenu.nodeType === 'group'}
          onGroup={handleGroupNodes}
          onUngroup={() => handleUngroupNode(nodeMenu.nodeId)}
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
          selectedCount={selectedFlagIds.length}
          selectedGroupId={selectedGroupId}
          onGroup={handleGroupNodes}
          onUngroup={() => selectedGroupId && handleUngroupNode(selectedGroupId)}
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
