import { memo, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { NodeProps, Node } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import { ScriptCard } from './script/ScriptCard';
import { ScriptDetailPanel } from './script/ScriptDetailPanel';
import { useCanvasStore } from '@/stores/canvasStore';
import { canvasApi } from '@/services/canvasApi';
import { clearAllStale } from '@/utils/topology';
import type { ScriptNodeData } from '@/types/canvas';

type ScriptNodeType = Node<ScriptNodeData, 'script'>;

export const ScriptNode = memo<NodeProps<ScriptNodeType>>(function ScriptNode({ id, data, selected }) {
  const [detailOpen, setDetailOpen] = useState(false);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const projectId = useCanvasStore((s) => s.projectId);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // debounce 自动保存（编辑分镜内容后实时同步到后端）
  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      if (!projectId) return;
      const store = useCanvasStore.getState();
      const cleanNodes = clearAllStale(store.nodes);
      const viewport = store._cache.get(projectId)?.savedViewport || { x: 0, y: 0, zoom: 1 };
      try {
        await canvasApi.saveCanvas(projectId, {
          nodes: cleanNodes.length === store.nodes.length ? store.nodes : cleanNodes,
          edges: store.edges,
          viewport,
        });
      } catch (e) {
        console.error('[ScriptNode] 自动保存失败:', e);
      }
    }, 800);
  }, [projectId]);

  // 稳定的 card data 对象 — 只在数据实际变化时新建，保证 ScriptCard.memo 生效
  const cardData = {
    label: data.label,
    currentStep: data.currentStep,
    shots: data.shots,
    scriptContent: data.scriptContent,
    characters: data.characters, // 用于判断是否有数据
    scenes: data.scenes, // 用于判断是否有数据
    props: data.props, // 用于判断是否有数据
    progressMessage: data.progressMessage, // 进度消息（如"已运行 10s"）
  };

  // 稳定的事件处理
  const handleOpenDetail = useCallback(() => setDetailOpen(true), []);
  const handleCloseDetail = useCallback(() => setDetailOpen(false), []);

  // 稳定的更新回调（更新 store + debounce 保存到后端）
  const handleUpdateData = useCallback(
    (updates: Partial<ScriptNodeData>) => {
      updateNodeData(id, updates as Partial<ScriptNodeData>);
      scheduleSave();
    },
    [id, updateNodeData, scheduleSave]
  );

  return (
    <>
      <BaseNode id={id} data={data} selected={selected} noContentPadding>
        <ScriptCard
          data={cardData}
          status={data.status}
          onOpen={handleOpenDetail}
        />
      </BaseNode>

      {/* 条件渲染 Portal：关闭时不创建 DOM，减少节点数 */}
      {detailOpen &&
        createPortal(
          <ScriptDetailPanel
            open={detailOpen}
            scriptNodeId={id}
            data={data}
            onClose={handleCloseDetail}
            onUpdate={handleUpdateData}
          />,
          document.body
        )}
    </>
  );
});
