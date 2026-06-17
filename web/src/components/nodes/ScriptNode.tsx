import { memo, useState, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { NodeProps, Node } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import { ScriptCard } from './script/ScriptCard';
import { ScriptDetailPanel } from './script/ScriptDetailPanel';
import { useScriptGeneration } from '@/hooks/useScriptGeneration';
import type { ScriptNodeData } from '@/types/canvas';
import { useCanvasStore } from '@/stores/canvasStore';

type ScriptNodeType = Node<ScriptNodeData, 'script'>;

export const ScriptNode = memo<NodeProps<ScriptNodeType>>(function ScriptNode({ id, data, selected }) {
  const [detailOpen, setDetailOpen] = useState(false);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const projectId = useCanvasStore((s) => s.projectId);

  // 用 ref 存储 updateNodeData 和 id，让回调保持稳定引用
  const updateRef = useRef(updateNodeData);
  updateRef.current = updateNodeData;
  const idRef = useRef(id);
  idRef.current = id;

  // 稳定的回调 — 永不重建，内部通过 ref 读最新值
  const handleResult = useCallback(
    (shots: any[], scriptContent: string) => {
      updateRef.current(idRef.current, {
        shots,
        scriptContent,
        status: 'success',
        currentStep: 1,
      });
    },
    []
  );

  const handleStatusChange = useCallback((status: string) => {
    updateRef.current(idRef.current, { status });
  }, []);

  // 轮询生成进度 — 回调引用稳定，不会触发 hook 内部多余更新
  const { progress, message: progressMessage } = useScriptGeneration({
    nodeId: id,
    projectId,
    status: data.status,
    onResult: handleResult,
    onStatusChange: handleStatusChange,
  });

  // 稳定的 card data 对象 — 只在数据实际变化时新建，保证 ScriptCard.memo 生效
  const cardData = useMemo(
    () => ({
      label: data.label,
      currentStep: data.currentStep,
      shots: data.shots,
      scriptContent: data.scriptContent,
    }),
    [data.label, data.currentStep, data.shots, data.scriptContent]
  );

  // 稳定的事件处理
  const handleOpenDetail = useCallback(() => setDetailOpen(true), []);
  const handleCloseDetail = useCallback(() => setDetailOpen(false), []);

  // 稳定的更新回调
  const handleUpdateData = useCallback(
    (updates: Partial<ScriptNodeData>) => {
      updateNodeData(id, updates as Partial<ScriptNodeData>);
    },
    [id, updateNodeData]
  );

  return (
    <>
      <BaseNode id={id} data={data} selected={selected} noContentPadding>
        <ScriptCard
          data={cardData}
          status={data.status}
          progress={progress}
          progressMessage={progressMessage}
          onOpen={handleOpenDetail}
        />
      </BaseNode>

      {/* 条件渲染 Portal：关闭时不创建 DOM，减少节点数 */}
      {detailOpen &&
        createPortal(
          <ScriptDetailPanel
            open={detailOpen}
            data={data}
            progress={progress}
            progressMessage={progressMessage}
            onClose={handleCloseDetail}
            onUpdate={handleUpdateData}
          />,
          document.body
        )}
    </>
  );
});
