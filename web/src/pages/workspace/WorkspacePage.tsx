import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ReactFlowProvider } from '@xyflow/react';
import { Button, Tooltip, App } from 'antd';
import {
  ArrowLeftOutlined,
  SaveOutlined,
  VideoCameraOutlined,
  FolderOutlined,
  GoldOutlined,
  ShopOutlined,
} from '@ant-design/icons';
import { Canvas } from '@/components/canvas/Canvas';
import { CanvasToolbar } from '@/components/canvas/CanvasToolbar';
import { useCanvas } from '@/hooks/useCanvas';
import { useCanvasStore } from '@/stores/canvasStore';
import { useExecutionStore, type ActiveStream } from '@/stores/executionStore';
import { useExecutionStream } from '@/hooks/useExecutionStream';
import { useResumeActiveExecution } from '@/hooks/useResumeActiveExecution';
import { canvasApi } from '@/services/canvasApi';
import { projectApi } from '@/services/projectApi';
import AddShowDialog from '@/components/AddShowDialog';
import { AssetPanel } from '@/components/canvas/AssetPanel';
import { StyleMaterialEntry } from '@/components/canvas/StyleMaterialEntry';
import { PointsMallModal } from '@/components/auth/PointsMallModal';
import { BillingRecordsModal } from '@/components/auth/BillingRecordsModal';
import { useAuthStore } from '@/stores/authStore';
import { showApi, type ShowCategoryItem } from '@/services/showApi';
import { refreshCredits } from '@/utils/refreshCredits';
import { useCreditsSync } from '@/hooks/useCreditsSync';
import { usePageMeta } from '@/hooks/usePageMeta';

/** 画布是否"效果为空"：无节点，或所有节点都是空内容（未填输入、无产出） */
function isEffectivelyEmptyCanvas(nodes: { data?: Record<string, unknown> }[]): boolean {
  if (nodes.length === 0) return true;
  return nodes.every((n) => {
    const d = n.data ?? {};
    if (d.type === 'text' || d.type === 'script') return !(d.content || d.scriptContent || d.prompt);
    if (d.type === 'image') return !(d.imageUrl || d.prompt);
    if (d.type === 'video') return !(d.videoUrl || d.prompt);
    if (d.type === 'audio') return !(d.audioUrl);
    return false; // 未知节点类型：保守视为"非空"，不删除
  });
}

// 单个 SSE 订阅实例（按 executionId 建立独立 EventSource）
// 不渲染任何 UI，仅用于 hooks 内部订阅
function StreamSubscriber({ stream }: { stream: ActiveStream }) {
  useExecutionStream(stream.projectId, stream.executionId, stream.nodeId, stream.nodeIds);
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

  // 后端队列里的生成与页面无关；刷新/重进后恢复"仍在进行中"的节点状态与进度订阅
  useResumeActiveExecution(urlProjectId);

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
  // 剩余积分：执行完成后 useExecutionStream 会重新拉 /auth/me 同步余额，这里直接读即可保持实时
  const user = useAuthStore((s) => s.user);

  // SSE 订阅提升到 WorkspacePage 顶层：与节点选中状态解耦
  // 节点失焦/切换面板不会卸载 SSE，避免运行中被关闭
  // 支持多节点并行执行：每个 executionId 一个独立 StreamSubscriber
  const activeStreams = useExecutionStore((s) => s.activeStreams);

  const [projectName, setProjectName] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [isPreparingPublish, setIsPreparingPublish] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const projectNameLoadedRef = useRef(false);
  const persistedProjectNameRef = useRef('');
  const cancelNameEditRef = useRef(false);

  // 提交视频发布弹窗
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [publishCategories, setPublishCategories] = useState<ShowCategoryItem[]>([]);
  const [prefillVideoUrl, setPrefillVideoUrl] = useState('');
  // 个人资产库（画布左侧停靠面板，不是弹窗：选图时不该把画布挡掉）
  const [showAssetPanel, setShowAssetPanel] = useState(false);
  // 积分超市（充值入口）：挂在余额左边，看完余额顺手就能充
  const [showPointsMall, setShowPointsMall] = useState(false);
  // 积分明细（扣费/退款/充值）弹窗
  const [showBillingRecords, setShowBillingRecords] = useState(false);

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
        persistedProjectNameRef.current = project.name;
      }).catch(() => {
        setProjectName('未命名项目');
        persistedProjectNameRef.current = '未命名项目';
      });
    }
  }, [urlProjectId]);

  // 编辑项目名称
  const handleNameClick = useCallback(() => {
    cancelNameEditRef.current = false;
    setIsEditingName(true);
    setTimeout(() => nameInputRef.current?.select(), 0);
  }, []);

  const handleNameBlur = useCallback(async () => {
    setIsEditingName(false);
    if (cancelNameEditRef.current) {
      cancelNameEditRef.current = false;
      setProjectName(persistedProjectNameRef.current);
      return;
    }
    const nextName = projectName.trim();
    if (!nextName) {
      setProjectName(persistedProjectNameRef.current);
      message.warning('项目名称不能为空');
      return;
    }
    if (!urlProjectId || nextName === persistedProjectNameRef.current) {
      setProjectName(nextName);
      return;
    }
    try {
      await projectApi.updateProject(urlProjectId, { name: nextName });
      persistedProjectNameRef.current = nextName;
      setProjectName(nextName);
      message.success('项目名称已更新');
    } catch {
      // HTTP 错误已由 api.ts 拦截器统一 message.error()
    }
  }, [message, projectName, urlProjectId]);

  const handleNameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      nameInputRef.current?.blur();
    } else if (e.key === 'Escape') {
      cancelNameEditRef.current = true;
      setProjectName(persistedProjectNameRef.current);
      nameInputRef.current?.blur();
    }
  }, []);

  // 余额同步：进画布拉一次 + 窗口聚焦再拉一次（扣费/退费的实时推送在 useExecutionStream 里）
  useCreditsSync();

  // 保存画布
  const handleSave = useCallback(async () => {
    const { projectId, exportCanvas, setSaving, setDirty } = useCanvasStore.getState();
    if (!projectId) {
      message.warning('项目ID为空，无法保存');
      return;
    }
    if (!isDirty) {
      message.info('当前画布已是最新状态');
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
  }, [isDirty, message]);

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
    <ReactFlowProvider>
    <div className="w-full h-full flex flex-col overflow-hidden bg-[var(--dv-canvas-bg)]">
      {/* SSE 订阅实例：每个 activeStream 一个独立 EventSource */}
      {activeStreams.map((s) => (
        <StreamSubscriber key={s.executionId} stream={s} />
      ))}

      {/* 顶部栏 */}
      <div className="workspace-topbar flex h-11 shrink-0 items-center gap-2 overflow-hidden border-b border-white/[0.06] bg-white px-3">
        <Tooltip title="返回项目列表">
          <Button
            type="text"
            size="small"
            aria-label="返回项目列表"
            icon={<ArrowLeftOutlined />}
            loading={isLeaving}
            onClick={async () => {
              if (isLeaving) return;
              setIsLeaving(true);
              // 空画布（无节点，或所有节点都是空内容）返回时自动删除当前项目
              const { nodes, projectId } = useCanvasStore.getState();
              if (projectId && isEffectivelyEmptyCanvas(nodes)) {
                try {
                  await projectApi.deleteProject(projectId);
                } catch (err) {
                  // 删除失败不阻塞返回（HTTP 错误已由拦截器提示）
                  console.error('空画布项目删除失败:', err);
                }
              }
              navigate('/');
            }}
          />
        </Tooltip>
        {isEditingName ? (
          <input
            ref={nameInputRef}
            className="w-48 rounded-lg border border-cyan-300/30 bg-cyan-400/[0.06] px-2 py-1 text-sm text-gray-100 outline-none transition-shadow focus:shadow-[0_0_0_3px_rgba(34,211,238,0.08)]"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            onBlur={handleNameBlur}
            onKeyDown={handleNameKeyDown}
            autoFocus
          />
        ) : (
          <span
            className="workspace-project-name cursor-pointer rounded-lg px-2 py-1 text-sm text-gray-300 transition-all hover:bg-cyan-400/[0.07] hover:text-cyan-100"
            onClick={handleNameClick}
            title="点击编辑项目名称"
          >
            {projectName || '未命名项目'}
          </span>
        )}
        <div className="flex-1" />
        {/* 顶栏中间：[未保存状态 + 保存] ｜ [撤销/重做 + 放大缩小/适应/100%]
            保存属于"改动画布"的动作，跟撤销/重做放一起才顺手；竖线把两者分开。 */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* 未保存改动：保存按钮右上角的红点（原先是一整行"未保存"文字，太占地方） */}
          <Tooltip title={isDirty ? '保存 (Ctrl+S) · 有未保存的改动' : '保存 (Ctrl+S)'}>
            <span className="relative inline-flex">
              <Button
                type="text"
                size="small"
                icon={<SaveOutlined />}
                loading={isSaving}
                aria-label="保存画布"
                onClick={handleSave}
              />
              {isDirty && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500 ring-2 ring-white pointer-events-none" />
              )}
            </span>
          </Tooltip>
          {/* 竖线分隔：与全局头部同款 */}
          <span className="inline-block w-px h-4 bg-gray-200 mx-1.5 align-middle" /> {/* 与画布工具栏内部的竖线同一种元素（1px 细线），不再用 "|" 文字 */}
          <CanvasToolbar />
        </div>
        <div className="flex-1" />
        <Tooltip title="积分超市（充值）">
          <Button
            type="text"
            size="small"
            icon={<ShopOutlined />}
            aria-label="打开积分超市"
            onClick={() => setShowPointsMall(true)}
            className="!text-amber-500"
          />
        </Tooltip>
        <Tooltip title="查看积分明细（扣费 / 退款 / 充值）">
          <button
            type="button"
            onClick={() => setShowBillingRecords(true)}
            className="tech-credit-badge flex shrink-0 cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium text-amber-300 transition-all hover:border-amber-300/30 hover:bg-amber-300/10 active:scale-[0.97]"
          >
            <GoldOutlined />
            <span>{user?.credits ?? 0}</span>
            <span className="hidden sm:inline">积分</span>
          </button>
        </Tooltip>
        <Tooltip title="提交视频发布">
          <Button
            type="text"
            size="small"
            icon={<VideoCameraOutlined />}
            aria-label="提交视频发布"
            loading={isPreparingPublish}
            onClick={async () => {
              if (isPreparingPublish) return;
              setIsPreparingPublish(true);
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
              setIsPreparingPublish(false);
            }}
          />
        </Tooltip>
      </div>

      {/* 画布区域：左侧停靠个人资产库（与右侧提示词面板对称，不遮挡画布） */}
      <div className="flex-1 flex min-h-0">
        {showAssetPanel && <AssetPanel onClose={() => setShowAssetPanel(false)} />}
        <div className="flex-1 relative min-w-0">
          <CanvasWithDrop urlProjectId={urlProjectId} />

          {/* 左边缘把手列：资产库 + 风格素材。
              两个都是「取材」动作，贴着画布左边缘比占头部位置更顺手；
              同一条列里上下排列（而不是各自算 top 偏移），加第三个入口时也不用再量像素。 */}
          {!showAssetPanel && (
            <div className="absolute left-0 top-1/3 -translate-y-1/2 z-20 flex flex-col gap-2">
              <Tooltip title="个人资产库：点一下从左侧展开" placement="right">
                <button
                  type="button"
                  onClick={() => setShowAssetPanel(true)}
                  className="tech-side-tab flex cursor-pointer flex-col items-center gap-1.5 rounded-r-lg border border-l-0 border-gray-200 bg-white/95 px-1.5 py-3 text-gray-500 shadow-md transition-all hover:border-cyan-300/40 hover:text-cyan-200 active:translate-x-0.5"
                >
                  <FolderOutlined className="text-[14px]" />
                  <span className="text-[11px] tracking-wider [writing-mode:vertical-rl]">资产库</span>
                </button>
              </Tooltip>

              {/* 风格素材：挑一个风格 → 直接建出带该风格的图片节点 */}
              <StyleMaterialEntry />
            </div>
          )}
        </div>
      </div>

      {/* 积分明细弹窗（与头部「费用明细」同一个组件） */}
      {showBillingRecords && (
        <BillingRecordsModal onClose={() => setShowBillingRecords(false)} />
      )}

      {/* 积分超市（充值）：与全局头部同一个组件 */}
      {showPointsMall && <PointsMallModal onClose={() => setShowPointsMall(false)} />}

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
    </ReactFlowProvider>
  );
}

export default function WorkspacePage() {
  // 应用内页：给个正常标题（否则切进来还留着上一个公开页的标题），并明确 noindex
  usePageMeta({ title: '创作画布', noindex: true });
  return <WorkspaceInner />;
}
