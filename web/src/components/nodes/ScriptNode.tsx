import { memo } from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import { CodeOutlined } from '@ant-design/icons';
import { BaseNode } from './BaseNode';
import type { ScriptNodeData } from '@/types/canvas';

type ScriptNodeType = Node<ScriptNodeData, 'script'>;

export const ScriptNode = memo<NodeProps<ScriptNodeType>>(function ScriptNode({ id, data, selected }) {
  return (
    <BaseNode id={id} data={data} selected={selected}>
      <div className="space-y-1.5">
        <div className="flex items-center gap-1 text-[10px] text-gray-400">
          <CodeOutlined />
          <span>脚本内容</span>
        </div>
        <p className="text-gray-800 line-clamp-3 whitespace-pre-wrap text-[11px]">
          {data.scriptContent || '双击编辑脚本内容'}
        </p>
        {data.shots.length > 0 && (
          <div className="text-[10px] text-amber-600">
            已拆解 {data.shots.length} 个分镜
          </div>
        )}
      </div>
    </BaseNode>
  );
});
