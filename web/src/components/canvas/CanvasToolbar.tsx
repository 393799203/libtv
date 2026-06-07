import { memo, useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { Button, Space, Tooltip } from 'antd';
import {
  ZoomInOutlined,
  ZoomOutOutlined,
  FullscreenOutlined,
  SaveOutlined,
  PlayCircleOutlined,
  StopOutlined,
  UndoOutlined,
  RedoOutlined,
} from '@ant-design/icons';
import { useCanvasStore } from '@/stores/canvasStore';
import { useExecutionStore } from '@/stores/executionStore';

export const CanvasToolbar = memo(function CanvasToolbar() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const isDirty = useCanvasStore((s) => s.isDirty);
  const isSaving = useCanvasStore((s) => s.isSaving);
  const isExecuting = useExecutionStore((s) => s.isExecuting);

  const handleZoomIn = useCallback(() => {
    zoomIn({ duration: 200 });
  }, [zoomIn]);

  const handleZoomOut = useCallback(() => {
    zoomOut({ duration: 200 });
  }, [zoomOut]);

  const handleFitView = useCallback(() => {
    fitView({ duration: 300, padding: 0.2 });
  }, [fitView]);

  const handleSave = useCallback(() => {
    // TODO: 调用保存 API
    console.log('Save canvas');
  }, []);

  const handleExecute = useCallback(() => {
    // TODO: 调用执行 API
    console.log('Execute workflow');
  }, []);

  const handleStop = useCallback(() => {
    // TODO: 调用停止 API
    console.log('Stop execution');
  }, []);

  return (
    <div className="bg-white/90 backdrop-blur-sm rounded-lg shadow-md px-3 py-1.5 flex items-center gap-1">
      <Space size={2}>
        <Tooltip title="撤销">
          <Button type="text" size="small" icon={<UndoOutlined />} disabled />
        </Tooltip>
        <Tooltip title="重做">
          <Button type="text" size="small" icon={<RedoOutlined />} disabled />
        </Tooltip>
      </Space>

      <div className="w-px h-4 bg-gray-200 mx-1" />

      <Space size={2}>
        <Tooltip title="放大">
          <Button type="text" size="small" icon={<ZoomInOutlined />} onClick={handleZoomIn} />
        </Tooltip>
        <Tooltip title="缩小">
          <Button type="text" size="small" icon={<ZoomOutOutlined />} onClick={handleZoomOut} />
        </Tooltip>
        <Tooltip title="适应画布">
          <Button type="text" size="small" icon={<FullscreenOutlined />} onClick={handleFitView} />
        </Tooltip>
      </Space>

      <div className="w-px h-4 bg-gray-200 mx-1" />

      <Space size={2}>
        <Tooltip title="保存">
          <Button
            type="text"
            size="small"
            icon={<SaveOutlined />}
            onClick={handleSave}
            loading={isSaving}
            className={isDirty ? 'text-blue-500' : ''}
          />
        </Tooltip>
        {isExecuting ? (
          <Tooltip title="停止执行">
            <Button
              type="text"
              size="small"
              danger
              icon={<StopOutlined />}
              onClick={handleStop}
            />
          </Tooltip>
        ) : (
          <Tooltip title="执行工作流">
            <Button
              type="text"
              size="small"
              icon={<PlayCircleOutlined />}
              onClick={handleExecute}
              className="text-green-500"
            />
          </Tooltip>
        )}
      </Space>
    </div>
  );
});
