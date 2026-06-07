import { memo } from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import { PictureOutlined } from '@ant-design/icons';
import { BaseNode } from './BaseNode';
import type { ImageNodeData } from '@/types/canvas';

type ImageNodeType = Node<ImageNodeData, 'image'>;

export const ImageNode = memo<NodeProps<ImageNodeType>>(function ImageNode({ id, data, selected }) {
  return (
    <BaseNode id={id} data={data} selected={selected}>
      <div className="space-y-1.5">
        {data.imageUrl ? (
          <img
            src={data.imageUrl}
            alt={data.label}
            className="w-full rounded"
            style={{ maxHeight: 120, objectFit: 'cover' }}
            loading="lazy"
          />
        ) : (
          <div className="flex items-center justify-center h-20 bg-gray-50 rounded border border-dashed border-gray-300">
            <PictureOutlined className="text-2xl text-gray-300" />
          </div>
        )}
        <p className="text-gray-500 text-[10px] truncate">
          {data.prompt || '输入图像生成提示词'}
        </p>
        <div className="flex gap-1 text-[10px] text-gray-400">
          <span>{data.model}</span>
          <span>·</span>
          <span>{data.width}x{data.height}</span>
        </div>
      </div>
    </BaseNode>
  );
});
