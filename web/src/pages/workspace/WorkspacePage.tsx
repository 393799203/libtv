import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ReactFlowProvider } from '@xyflow/react';
import { Button, Tooltip, App } from 'antd';
import {
  ArrowLeftOutlined,
  SaveOutlined,
  GlobalOutlined,
  VideoCameraOutlined,
  GoldOutlined,
} from '@ant-design/icons';
import { Canvas } from '@/components/canvas/Canvas';
import { useCanvas } from '@/hooks/useCanvas';
import { useCanvasStore } from '@/stores/canvasStore';
import { useExecutionStore, type ActiveStream } from '@/stores/executionStore';
import { useExecutionStream } from '@/hooks/useExecutionStream';
import { canvasApi } from '@/services/canvasApi';
import { projectApi } from '@/services/projectApi';
import AddShowDialog from '@/components/AddShowDialog';
import { AssetLibraryModal } from '@/components/auth/AssetLibraryModal';
import { showApi, type ShowCategoryItem } from '@/services/showApi';

// 单个 SSE 订阅实例（按 executionId 建立独立 EventSource）
// 不渲染任何 UI，仅用于 hooks 内部订阅
function StreamSubscriber({ stream }: { stream: ActiveStream }) {
  useExecutionStream(stream.projectId, stream.executionId, stream.nodeId);
  return null;
}

function CanvasWithDrop({ urlProjectId }: { urlProjectId: string }) {
  const { createNodeFromDrop, loadCanvasFromServer } = useCanvas();
  const loadedRef = useRef(false);

  useEffect(() => {
    if (urlProjectId && !loadedRef.current) {
      loadedRef.current = true;
      loadCanvasFromServer(urlProjectId);
    }
  }, [urlProjectId, loadCanvasFromServer]);

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
  const showMiniMap = useCanvasStore((s) => s.showMiniMap);

  // SSE 订阅提升到 WorkspacePage 顶层：与节点选中状态解耦
  // 节点失焦/切换面板不会卸载 SSE，避免运行中被关闭
  // 支持多节点并行执行：每个 executionId 一个独立 StreamSubscriber
  const activeStreams = useExecutionStore((s) => s.activeStreams);

  const [projectName, setProjectName] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const projectNameLoadedRef = useRef(false);

  // 提交视频发布弹窗
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [publishCategories, setPublishCategories] = useState<ShowCategoryItem[]>([]);
  const [prefillVideoUrl, setPrefillVideoUrl] = useState('');
  // 个人资产库弹窗
  const [showAssetLibrary, setShowAssetLibrary] = useState(false);

  // 同步设置 store 中的 projectId，避免竞态条件
  if (urlProjectId && useCanvasStore.getState().projectId !== urlProjectId) {
    setProjectId(urlProjectId);
  }

  // 加载项目名称
  useEffect(() => {
    if (urlProjectId && !projectNameLoadedRef.current) {
      projectNameLoadedRef.current = true;
      projectApi.getProject(urlProjectId).then((project) => {
        setProjectName(project.name);
      }).catch(() => {
        setProjectName('未命名项目');
      });
    }
  }, [urlProjectId]);

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
      // HTTP 错误已由 api.ts 拦截器统一 message.error()
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
      // HTTP 错误已由 api.ts 拦截器统一 message.error()
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
      {/* SSE 订阅实例：每个 activeStream 一个独立 EventSource */}
      {activeStreams.map((s) => (
        <StreamSubscriber key={s.executionId} stream={s} />
      ))}

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
        <Tooltip title="提交视频发布">
          <Button
            type="text"
            size="small"
            icon={<VideoCameraOutlined />}
            onClick={async () => {
              // 若当前选中了已生成视频的节点，默认带入其视频 URL
              const { nodes, selectedNodeIds } = useCanvasStore.getState();
              const selectedVideoUrl = nodes.find(
                n => selectedNodeIds.includes(n.id)
                  && n.data?.type === 'video'
                  && (n.data as { videoUrl?: string }).videoUrl
              )?.data as { videoUrl?: string } | undefined;
              setPrefillVideoUrl(selectedVideoUrl?.videoUrl || '');
              try {
                const cats = await showApi.categories();
                setPublishCategories(cats || []);
              } catch {}
              setShowPublishDialog(true);
            }}
          />
        </Tooltip>
        <Tooltip title={showMiniMap ? '关闭小地图' : '打开小地图'}>
          <Button
            type={showMiniMap ? 'primary' : 'text'}
            size="small"
            icon={<GlobalOutlined />}
            onClick={() => useCanvasStore.getState().toggleMiniMap()}
          />
        </Tooltip>
        <Tooltip title="个人资产库">
          <Button
            type="text"
            size="small"
            icon={<GoldOutlined />}
            onClick={() => setShowAssetLibrary(true)}
          />
        </Tooltip>
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
          <CanvasWithDrop urlProjectId={urlProjectId} />
        </ReactFlowProvider>
      </div>

      {/* 个人资产库弹窗 */}
      {showAssetLibrary && (
        <AssetLibraryModal onClose={() => setShowAssetLibrary(false)} />
      )}

      {/* 提交视频发布弹窗 */}
      <AddShowDialog
        open={showPublishDialog}
        onClose={() => setShowPublishDialog(false)}
        onSuccess={() => {
          message.success('视频已提交，等待审核');
          setShowPublishDialog(false);
        }}
        categories={publishCategories}
        prefillVideoUrl={prefillVideoUrl}
        status="pending"
        projectId={urlProjectId || undefined}
        projectName={projectName}
      />
    </div>
  );
}

export default function WorkspacePage() {
  return <WorkspaceInner />;
}
