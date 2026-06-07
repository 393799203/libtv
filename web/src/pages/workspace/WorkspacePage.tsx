import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ReactFlowProvider } from '@xyflow/react';
import { Button, Tooltip, App } from 'antd';
import {
  ArrowLeftOutlined,
  SaveOutlined,
  PlayCircleOutlined,
  StopOutlined,
  GlobalOutlined,
} from '@ant-design/icons';
import { Canvas } from '@/components/canvas/Canvas';
import { useCanvas } from '@/hooks/useCanvas';
import { useCanvasStore } from '@/stores/canvasStore';
import { useExecutionStore } from '@/stores/executionStore';
import { canvasApi } from '@/services/canvasApi';
import { projectApi } from '@/services/projectApi';

function CanvasWithDrop() {
  const { createNodeFromDrop, loadCanvasFromServer } = useCanvas();
  const projectId = useCanvasStore((s) => s.projectId);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (projectId && !loadedRef.current) {
      loadedRef.current = true;
      loadCanvasFromServer();
    }
  }, [projectId, loadCanvasFromServer]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  return (
    <div
      className="w-full h-full"
      onDrop={createNodeFromDrop}
      onDragOver={onDragOver}
    >
      <Canvas />
    </div>
  );
}

function WorkspaceInner() {
  const { projectId: urlProjectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const setProjectId = useCanvasStore((s) => s.setProjectId);
  const isDirty = useCanvasStore((s) => s.isDirty);
  const isSaving = useCanvasStore((s) => s.isSaving);
  const isExecuting = useExecutionStore((s) => s.isExecuting);
  const showMiniMap = useCanvasStore((s) => s.showMiniMap);

  const [projectName, setProjectName] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // 设置当前项目 ID 并加载项目名称
  useEffect(() => {
    if (urlProjectId) {
      setProjectId(urlProjectId);
      projectApi.getProject(urlProjectId).then((project) => {
        setProjectName(project.name);
      }).catch(() => {
        setProjectName('未命名项目');
      });
    }
  }, [urlProjectId, setProjectId]);

  // 编辑项目名称
  const handleNameClick = useCallback(() => {
    setIsEditingName(true);
    setTimeout(() => nameInputRef.current?.select(), 0);
  }, []);

  const handleNameBlur = useCallback(async () => {
    setIsEditingName(false);
    if (!urlProjectId || !projectName.trim()) return;
    try {
      await projectApi.updateProject(urlProjectId, { name: projectName.trim() });
    } catch {
      message.error('项目名称保存失败');
    }
  }, [urlProjectId, projectName]);

  const handleNameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      nameInputRef.current?.blur();
    } else if (e.key === 'Escape') {
      setProjectName('');
      setIsEditingName(false);
    }
  }, []);

  // 保存画布
  const handleSave = useCallback(async () => {
    const { projectId, exportCanvas, setSaving, setDirty } = useCanvasStore.getState();
    if (!projectId) {
      message.warning('项目ID为空，无法保存');
      return;
    }
    const exportData = exportCanvas();
    try {
      setSaving(true);
      await canvasApi.saveCanvas(projectId, exportData);
      setDirty(false);
      message.success('保存成功');
    } catch (error) {
      console.error('保存画布失败:', error);
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  }, []);

  // Ctrl+S 快捷键保存
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      {/* 顶部栏 */}
      <div className="h-10 bg-white border-b border-gray-200 flex items-center px-3 gap-2 shrink-0 overflow-hidden">
        <Tooltip title="返回项目列表">
          <Button
            type="text"
            size="small"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/')}
          />
        </Tooltip>
        {isEditingName ? (
          <input
            ref={nameInputRef}
            className="text-sm text-gray-800 bg-gray-50 border border-gray-300 rounded px-2 py-0.5 outline-none focus:border-purple-400 w-48"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            onBlur={handleNameBlur}
            onKeyDown={handleNameKeyDown}
            autoFocus
          />
        ) : (
          <span
            className="text-sm text-gray-600 cursor-pointer hover:text-purple-600 hover:bg-gray-50 rounded px-1.5 py-0.5 transition-colors"
            onClick={handleNameClick}
            title="点击编辑项目名称"
          >
            {projectName || '未命名项目'}
          </span>
        )}
        <div className="flex-1" />
        {isDirty && (
          <span className="text-xs text-orange-500">未保存</span>
        )}
        <Tooltip title={showMiniMap ? '关闭小地图' : '打开小地图'}>
          <Button
            type={showMiniMap ? 'primary' : 'text'}
            size="small"
            icon={<GlobalOutlined />}
            onClick={() => useCanvasStore.getState().toggleMiniMap()}
          />
        </Tooltip>
        {isExecuting ? (
          <Tooltip title="停止执行">
            <Button type="text" size="small" danger icon={<StopOutlined />} />
          </Tooltip>
        ) : (
          <Tooltip title="执行工作流">
            <Button type="text" size="small" icon={<PlayCircleOutlined />} className="text-green-500" />
          </Tooltip>
        )}
        <Tooltip title="保存 (Ctrl+S)">
          <Button
            type="text"
            size="small"
            icon={<SaveOutlined />}
            loading={isSaving}
            onClick={handleSave}
          />
        </Tooltip>
      </div>

      {/* 画布区域 */}
      <div className="flex-1">
        <ReactFlowProvider>
          <CanvasWithDrop />
        </ReactFlowProvider>
      </div>
    </div>
  );
}

export default function WorkspacePage() {
  return <WorkspaceInner />;
}
