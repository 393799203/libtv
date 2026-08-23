import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, App } from 'antd';
import { ArrowLeftOutlined, RobotOutlined } from '@ant-design/icons';
import { useCanvasStore } from '@/stores/canvasStore';
import { canvasApi } from '@/services/canvasApi';
import type { CanvasData, PrevizNodeData } from '@/types/canvas';
import { usePrevizStore, parsePathPointId, parseCameraPointId } from './previzStore';
import { ObjectsPanel } from './ObjectsPanel';
import { CharacterPanel } from './CharacterPanel';
import { CameraPanel } from './CameraPanel';
import { ExportPanel } from './ExportPanel';
import { AIBuildModal } from './AIBuildModal';
import { TimelineBar } from './TimelineBar';
import { Viewport3D } from './Viewport3D';

// 场景变化后防抖保存的间隔（毫秒）
const SAVE_DEBOUNCE = 1000;

// 左侧面板 tab
type LeftTab = 'objects' | 'characters';

export default function PrevizEditor() {
  const { projectId, nodeId } = useParams<{ projectId: string; nodeId: string }>();
  const navigate = useNavigate();
  const { message } = App.useApp();

  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [leftTab, setLeftTab] = useState<LeftTab>('objects');
  const [showAIBuild, setShowAIBuild] = useState(false);
  const objects = usePrevizStore((s) => s.objects);
  const characters = usePrevizStore((s) => s.characters);
  const cameras = usePrevizStore((s) => s.cameras);
  const duration = usePrevizStore((s) => s.duration);

  // ====== 初始化：确保画布已加载，再把节点 data.scene 读进 previz store ======
  useEffect(() => {
    if (!projectId || !nodeId) return;
    let cancelled = false;

    const init = async () => {
      const store = useCanvasStore.getState();
      if (store.projectId !== projectId) {
        store.setProjectId(projectId);
      }

      // store 中找不到该节点（如直接通过链接进入）：从服务端加载画布
      let node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
      if (!node) {
        try {
          const res = await canvasApi.getCanvas(projectId);
          const data = res as unknown as { nodes?: CanvasData['nodes']; data?: CanvasData };
          const canvasData = data?.nodes ? (data as unknown as CanvasData) : data?.data;
          if (canvasData?.nodes) {
            useCanvasStore.getState().loadCanvas(canvasData);
          }
        } catch (err) {
          console.error('加载画布失败:', err);
        }
        node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
      }

      if (cancelled) return;
      if (!node || node.data.type !== 'previz') {
        message.error('未找到白模预演节点');
        navigate(`/project/${projectId}`, { replace: true });
        return;
      }

      // 读入场景数据
      const previzStore = usePrevizStore.getState();
      previzStore.reset();
      const scene = (node.data as PrevizNodeData).scene;
      if (scene) previzStore.fromJSON(scene);
      setReady(true);
    };

    init();
    return () => {
      cancelled = true;
      // 离开编辑器时清空 previz store，避免串到下一个节点
      usePrevizStore.getState().reset();
    };
  }, [projectId, nodeId, navigate, message]);

  // ====== 保存：写回节点 data.scene 并持久化整张画布 ======
  const saveScene = useCallback(async () => {
    if (!projectId || !nodeId) return;
    const store = useCanvasStore.getState();
    const node = store.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    const scene = usePrevizStore.getState().toJSON();
    // 与节点中已存的场景一致则跳过
    if ((node.data as PrevizNodeData).scene === scene) return;

    store.updateNodeData(nodeId, { scene } as Partial<PrevizNodeData>);
    try {
      setSaving(true);
      await canvasApi.saveCanvas(projectId, useCanvasStore.getState().exportCanvas());
      useCanvasStore.getState().setDirty(false);
    } catch (err) {
      console.error('保存白模场景失败:', err);
      // HTTP 错误已由 api.ts 拦截器统一 message.error()
    } finally {
      setSaving(false);
    }
  }, [projectId, nodeId]);

  const saveSceneRef = useRef(saveScene);
  saveSceneRef.current = saveScene;

  // 场景变化防抖 1s 自动保存
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      saveSceneRef.current();
    }, SAVE_DEBOUNCE);
    return () => clearTimeout(timer);
  }, [objects, characters, cameras, duration, ready]);

  // Delete / Backspace 删除选中目标（几何体 / 角色 / 路径点；输入框内不响应）；ESC 退出路径绘制模式
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (e.key === 'Escape') {
        usePrevizStore.getState().setPathDrawMode(false);
        return;
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const store = usePrevizStore.getState();
      const selectedId = store.selectedId;
      if (!selectedId) return;
      // 相机机位点不可删除（相机在右侧面板删除）
      if (parseCameraPointId(selectedId)) return;
      e.preventDefault();
      const pp = parsePathPointId(selectedId);
      if (pp) {
        store.removePathPoint(pp.charId, pp.index);
      } else if (selectedId.startsWith('char-')) {
        store.removeCharacter(selectedId);
      } else {
        store.removeObject(selectedId);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // 返回画布前强制保存一次
  const handleBack = useCallback(async () => {
    await saveSceneRef.current();
    navigate(-1);
  }, [navigate]);

  return (
    <div className="w-full h-full flex flex-col overflow-hidden bg-gray-50">
      {/* 顶部栏 */}
      <div className="h-10 bg-white border-b border-gray-200 flex items-center px-3 gap-2 shrink-0">
        <Button
          type="text"
          size="small"
          icon={<ArrowLeftOutlined />}
          onClick={handleBack}
        >
          返回画布
        </Button>
        <span className="text-sm text-gray-600">白模预演编辑器</span>
        <Button
          type="text"
          size="small"
          icon={<RobotOutlined />}
          onClick={() => setShowAIBuild(true)}
        >
          AI 建白模
        </Button>
        <div className="flex-1" />
        {saving && <span className="text-xs text-gray-400">保存中...</span>}
      </div>

      {/* 三栏布局：左 面板（几何体/角色 tab）/ 中 3D 视口 + 时间轴 / 右 相机面板 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧面板 */}
        <div className="w-56 h-full bg-white border-r border-gray-200 flex flex-col shrink-0">
          <div className="flex border-b border-gray-200 shrink-0">
            {(
              [
                { key: 'objects', label: '场景对象' },
                { key: 'characters', label: '角色' },
              ] as { key: LeftTab; label: string }[]
            ).map((tab) => (
              <button
                key={tab.key}
                className={`flex-1 py-2 text-xs transition-colors cursor-pointer ${
                  leftTab === tab.key
                    ? 'text-blue-600 font-medium border-b-2 border-blue-500'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
                onClick={() => setLeftTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-hidden">
            {leftTab === 'objects' ? <ObjectsPanel /> : <CharacterPanel />}
          </div>
        </div>

        {/* 中间：3D 视口 + 底部时间轴 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-hidden">
            {ready ? (
              <Viewport3D />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
                加载中...
              </div>
            )}
          </div>
          <TimelineBar />
        </div>

        {/* 右侧：相机面板 + 导出白片面板 */}
        {projectId && nodeId && (
          <div className="w-64 bg-white border-l border-gray-200 flex flex-col shrink-0 overflow-hidden">
            <div className="flex-1 overflow-hidden">
              <CameraPanel />
            </div>
            <ExportPanel projectId={projectId} nodeId={nodeId} />
          </div>
        )}
      </div>

      {/* AI 建白模弹窗 */}
      {showAIBuild && projectId && (
        <AIBuildModal projectId={projectId} onClose={() => setShowAIBuild(false)} />
      )}
    </div>
  );
}
