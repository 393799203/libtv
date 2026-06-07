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
} from '@ant-design/icons';

import { useCanvasStore } from '@/stores/canvasStore';
import { useExecutionStore } from '@/stores/executionStore';
import { NODE_TYPE_CONFIG } from '@/types/canvas';
import type { LibTVNode, LibTVEdge } from '@/types/canvas';
import { PromptCompose } from '@/components/PromptCompose';

import { nodeTypes } from '@/components/nodes';
import { DataFlowEdge } from '@/components/edges/DataFlowEdge';
import { CanvasContextMenu } from './CanvasContextMenu';

const edgeTypes = {
  dataFlow: DataFlowEdge,
};

const nodeOrigin: NodeOrigin = [0.5, 0.5];

const defaultEdgeOptions: DefaultEdgeOptions = {
  type: 'dataFlow',
  animated: true,
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

  const isTextNode = selectedNode?.data.type === 'text';
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

  // 计算提示词框的位置
  const promptPosition = useMemo(() => {
    if (!selectedNode) return null;
    // 因为 nodeOrigin 是 [0.5, 0.5]，所以 position 是节点中心点
    const nodeCenterX = selectedNode.position.x;
    const nodeBottomY = selectedNode.position.y + (selectedNode.measured?.height || 200) / 2;
    // 转换为屏幕坐标
    const screenPos = flowToScreenPosition({ x: nodeCenterX, y: nodeBottomY });
    return {
      x: screenPos.x,
      y: screenPos.y, // 完全贴紧节点底部
    };
  }, [selectedNode, flowToScreenPosition, viewport]);

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
        onViewportChange={onViewportChange}
        onPaneClick={handleCloseContextMenu}
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
              <Button type="text" size="small" icon={<FullscreenOutlined />} onClick={handleFitView} />
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

      {/* 选中节点时的提示词编辑组件 */}
      {isTextNode && selectedNode && promptPosition && !selectedNode.data.isEditing && (
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
              top: -6,
              width: 0,
              height: 0,
              borderLeft: '6px solid transparent',
              borderRight: '6px solid transparent',
              borderBottom: '6px solid white'
            }}
          />
          
          <div className="pointer-events-auto">
            <PromptCompose
              value={(selectedNode.data.prompt as string) || ''}
              onChange={(value) => updateNodeData(selectedNode.id, { prompt: value })}
              placeholder="写下你想讲的故事、场景或角色设定。例如：一个来自未来的机器人，在城市屋顶看星星。"
              maxLength={2000}
            />
          </div>
        </div>
      )}
    </div>
  );
});
