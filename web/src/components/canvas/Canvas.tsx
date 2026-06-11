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
  type NodeOrigin,
  type DefaultEdgeOptions,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Button, Tooltip } from 'antd';
import {
  FullscreenOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  UndoOutlined,
  RedoOutlined,
  AimOutlined,
} from '@ant-design/icons';

import { useCanvasStore } from '@/stores/canvasStore';
import { useExecutionStore } from '@/stores/executionStore';
import { NODE_TYPE_CONFIG } from '@/types/canvas';
import type { LibTVNode, LibTVEdge, NodeType } from '@/types/canvas';
import { PromptCompose } from '@/components/panels/prompt';

import { nodeTypes } from '@/components/nodes';
import { DataFlowEdge } from '@/components/edges/DataFlowEdge';
import { CanvasContextMenu } from './CanvasContextMenu';
import { NodeSelectPopup } from './NodeSelectPopup';
import { createNode } from '@/utils/nodeFactory';

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
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [nodeSelectPopup, setNodeSelectPopup] = useState<{
    position: { x: number; y: number };
    sourceNodeId: string;
    sourceHandle: string | null;
  } | null>(null);
  // 防止 onPaneClick 在连线释放时误关弹窗
  const connectingRef = useRef(false);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const { fitView, zoomIn, zoomOut, screenToFlowPosition, flowToScreenPosition, getNodes, setViewport: rfSetViewport } = useReactFlow();

  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const onNodesChange = useCanvasStore((s) => s.onNodesChange);
  const onEdgesChange = useCanvasStore((s) => s.onEdgesChange);
  const onConnect = useCanvasStore((s) => s.onConnect);
  const canUndo = useCanvasStore((s) => s.canUndo);
  const canRedo = useCanvasStore((s) => s.canRedo);
  const undo = useCanvasStore((s) => s.undo);
  const redo = useCanvasStore((s) => s.redo);
  const isExecuting = useExecutionStore((s) => s.isExecuting);
  const selectedNodeIds = useCanvasStore((s) => s.selectedNodeIds);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);

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
  const addNode = useCanvasStore((s) => s.addNode);
  const addEdge = useCanvasStore((s) => s.addEdge);
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

  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
    });
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // 连线释放到空白区域时，弹出节点选择菜单（参考官方 add-node-on-edge-drop 示例）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState?: any) => {
      // 标记：本次释放是连线操作，onPaneClick 不应关闭弹窗
      connectingRef.current = true;
      // 短暂延迟后重置，让 onPaneClick 有机会读取
      setTimeout(() => { connectingRef.current = false; }, 50);

      // 释放到空白区域时 isValid 为 false，此时弹出选择菜单
      if (!connectionState?.isValid) {
        const { clientX, clientY } = 'changedTouches' in event
          ? event.changedTouches[0]
          : event as MouseEvent;
        setNodeSelectPopup({
          position: { x: clientX, y: clientY },
          sourceNodeId: connectionState.fromNode?.id,
          sourceHandle: connectionState.fromHandle?.id ?? null,
        });
      }
    },
    []
  );

  // 从选择菜单选中节点类型后：创建新节点 + 建立连线
  const handleNodeSelect = useCallback(
    (nodeType: NodeType) => {
      if (!nodeSelectPopup) return;
      const { position, sourceNodeId, sourceHandle } = nodeSelectPopup;
      const flowPos = screenToFlowPosition(position);

      const newNode = createNode(nodeType, flowPos);

      addNode(newNode);
      addEdge({
        id: `e-${sourceNodeId}-${newNode.id}`,
        source: sourceNodeId,
        target: newNode.id,
        type: 'dataFlow',
        sourceHandle: sourceHandle || undefined,
      });
      setNodeSelectPopup(null);
    },
    [nodeSelectPopup, screenToFlowPosition, addNode, addEdge]
  );

  const onViewportChange = useCallback((viewport: Viewport) => {
    const now = Date.now();
    setViewport(viewport);
    if (now - lastViewportUpdate.current > VIEWPORT_CHANGE_THROTTLE) {
      viewportRef.current = viewport;
      lastViewportUpdate.current = now;
      saveViewport(viewport);
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
    rfSetViewport({ x: 0, y: 0, zoom: 1 }, { duration: 200 });
  }, [rfSetViewport]);

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

  // 支持提示词面板的节点类型（排除风格图片节点）
  const hasPromptPanel = selectedNode
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

  // 计算提示词框的位置 — 用 ReactFlow 坐标系（跟随缩放/平移），从 getNodes() 取最新 measured
  const promptPosition = useMemo(() => {
    if (!selectedNode) return null;
    // 从 store 取最新节点数据（measured 可能异步更新，selectedNode 可能是旧的）
    const latestNode = getNodes().find((n) => n.id === selectedNode.id);
    const node = latestNode || selectedNode;
    // nodeOrigin [0.5, 0.5] → position 是中心点，底部 = position.y + height/2
    const nodeBottomY = node.position.y + (node.measured?.height || 200) / 2;
    return flowToScreenPosition({ x: node.position.x, y: nodeBottomY });
  }, [selectedNode?.id, flowToScreenPosition, viewport, getNodes]);

  return (
    <div className="w-full h-full relative" onContextMenu={handleContextMenu}>
      {isLoading ? (
        <div className="w-full h-full flex items-center justify-center bg-gray-50">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-purple-200 border-t-purple-500 rounded-full animate-spin" />
            <span className="text-sm text-gray-400">加载画布...</span>
          </div>
        </div>
      ) : (
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onConnectEnd={handleConnectEnd}
        onViewportChange={onViewportChange}
        onPaneClick={() => {
          handleCloseContextMenu();
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
        minZoom={0.05}
        maxZoom={4}
        nodesDraggable={!isExecuting}
        nodesConnectable={!isExecuting}
        elementsSelectable
        selectNodesOnDrag={false}
        panOnDrag
        panOnScroll={false}
        panOnScrollSpeed={0.5}
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick={false}
        deleteKeyCode={['Backspace', 'Delete']}
        multiSelectionKeyCode="Shift"
        className="!cursor-grab active:!cursor-grabbing"
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

        <Panel position="top-center">
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

      </ReactFlow>
      )}

      {contextMenu && (
        <CanvasContextMenu
          position={contextMenu}
          onClose={handleCloseContextMenu}
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
              nodeId={selectedNode!.id}
              nodeType={selectedNode!.data.type}
              data={selectedNode!.data}
              onUpdate={(partial) => updateNodeData(selectedNode!.id, partial)}
            />
          </div>
        </div>
      )}
    </div>
  );
});
