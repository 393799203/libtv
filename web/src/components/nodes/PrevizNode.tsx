import { memo, useCallback, useMemo } from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import { useNavigate } from 'react-router-dom';
import { DeploymentUnitOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { BaseNode } from './BaseNode';
import type { PrevizNodeData } from '@/types/canvas';
import type { PrevizScene } from '@/pages/previz/types';
import { useCanvasStore } from '@/stores/canvasStore';

type PrevizNodeType = Node<PrevizNodeData, 'previz'>;

export const PrevizNode = memo<NodeProps<PrevizNodeType>>(function PrevizNode({ id, data, selected }) {
  const navigate = useNavigate();
  const projectId = useCanvasStore((s) => s.projectId);

  // 解析场景 JSON，统计场景对象/角色数量
  const { objectCount, characterCount } = useMemo(() => {
    if (!data.scene) return { objectCount: 0, characterCount: 0 };
    try {
      const scene = JSON.parse(data.scene) as PrevizScene;
      return {
        objectCount: Array.isArray(scene.objects) ? scene.objects.length : 0,
        characterCount: Array.isArray(scene.characters) ? scene.characters.length : 0,
      };
    } catch {
      return { objectCount: 0, characterCount: 0 };
    }
  }, [data.scene]);

  // 场景摘要文案
  const summary =
    objectCount + characterCount > 0
      ? `对象 ${objectCount} · 角色 ${characterCount}`
      : '空场景';

  // 打开全屏预演编辑器
  const handleOpenEditor = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!projectId) return;
      navigate(`/project/${projectId}/previz/${id}`);
    },
    [navigate, projectId, id]
  );

  return (
    <BaseNode id={id} data={data} selected={selected} hideInputHandle>
      <div className="w-full flex flex-col gap-2">
        {data.videoUrl ? (
          /* 已导出白片：显示视频缩略 */
          <div className="relative w-full h-40 flex items-center justify-center bg-gray-900 rounded overflow-hidden">
            <video
              src={data.videoUrl}
              className="absolute inset-0 w-full h-full object-cover opacity-50"
              muted
              preload="metadata"
            />
            <PlayCircleOutlined className="relative text-4xl !text-white" />
          </div>
        ) : (
          /* 未导出：占位图 + 场景摘要 */
          <div className="w-full h-28 rounded-lg bg-gray-50 flex flex-col items-center justify-center gap-1.5">
            <DeploymentUnitOutlined className="text-3xl text-gray-300" />
            <span className="text-xs text-gray-400">{summary}</span>
          </div>
        )}

        {data.videoUrl && (
          <span className="text-xs text-gray-400">{summary}</span>
        )}

        <button
          className="w-full py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded transition-colors cursor-pointer"
          onClick={handleOpenEditor}
        >
          打开预演编辑器
        </button>
      </div>
    </BaseNode>
  );
});
