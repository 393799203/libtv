import { useCallback } from 'react';
import { Button, Tooltip } from 'antd';
import { useReactFlow, useViewport, useStore } from '@xyflow/react';
import {
  UndoOutlined,
  RedoOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  AimOutlined,
  FullscreenOutlined,
} from '@ant-design/icons';
import { useCanvasStore } from '@/stores/canvasStore';

/**
 * 画布工具条：撤销 / 重做 + 放大缩小 / 适应画布 / 100% 复位。
 *
 * 原先它是画布右上角的浮动条（Panel position="top-right"），会压住画布内容；
 * 现在放在画布外层头部条的中间区域，与顶栏融成一条。
 *
 * 因为脱离了画布 DOM，容器尺寸从 React Flow 自己的 store 取（width/height）——
 * 但这也要求本组件渲染在 ReactFlowProvider 内部（WorkspacePage 已把 Provider 提到页面外层）。
 */
export function CanvasToolbar() {
  const { fitView, zoomIn, zoomOut, getNodes, setViewport } = useReactFlow();
  const { zoom } = useViewport();
  const canUndo = useCanvasStore((s) => s.canUndo);
  const canRedo = useCanvasStore((s) => s.canRedo);
  const undo = useCanvasStore((s) => s.undo);
  const redo = useCanvasStore((s) => s.redo);

  // 画布可视区尺寸：工具条在头部条里，拿不到画布容器的 getBoundingClientRect
  const paneWidth = useStore((s) => s.width);
  const paneHeight = useStore((s) => s.height);

  const handleZoomIn = useCallback(() => {
    zoomIn({ duration: 200 });
  }, [zoomIn]);

  const handleZoomOut = useCallback(() => {
    zoomOut({ duration: 200 });
  }, [zoomOut]);

  const handleFitView = useCallback(() => {
    fitView({ duration: 300, padding: 0.2 });
  }, [fitView]);

  /** 100% 复位：以内容中心对齐画布中心（与原先浮动条的行为一致） */
  const handleZoomReset = useCallback(() => {
    const nodes = getNodes();
    if (nodes.length === 0) {
      setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 200 });
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of nodes) {
      const w = node.measured?.width ?? ((node.style?.width as number) ?? 320);
      const h = node.measured?.height ?? ((node.style?.height as number) ?? 200);
      // nodeOrigin [0.5, 0.5] → position 是节点中心
      minX = Math.min(minX, node.position.x - w / 2);
      minY = Math.min(minY, node.position.y - h / 2);
      maxX = Math.max(maxX, node.position.x + w / 2);
      maxY = Math.max(maxY, node.position.y + h / 2);
    }
    const contentCenterX = (minX + maxX) / 2;
    const contentCenterY = (minY + maxY) / 2;
    setViewport(
      { x: paneWidth / 2 - contentCenterX, y: paneHeight / 2 - contentCenterY, zoom: 1 },
      { duration: 200 },
    );
  }, [getNodes, setViewport, paneWidth, paneHeight]);

  return (
    <div className="flex items-center gap-0.5 shrink-0">
      <Tooltip title="撤销">
        <Button type="text" size="small" icon={<UndoOutlined />} disabled={!canUndo} onClick={undo} />
      </Tooltip>
      <Tooltip title="重做">
        <Button type="text" size="small" icon={<RedoOutlined />} disabled={!canRedo} onClick={redo} />
      </Tooltip>

      <div className="w-px h-4 bg-gray-200 mx-1.5" />

      <Tooltip title="放大">
        <Button type="text" size="small" icon={<ZoomInOutlined />} onClick={handleZoomIn} />
      </Tooltip>
      <div className="w-12 text-center text-xs text-gray-600 select-none tabular-nums">
        {Math.round(zoom * 100)}%
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
  );
}