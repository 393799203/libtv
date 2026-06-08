import { memo, useRef, useCallback, useMemo } from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import {
  PictureOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import type { ImageNodeData } from '@/types/canvas';
import { useCanvasStore } from '@/stores/canvasStore';
import { BaseNode } from './BaseNode';
import { uploadImage } from '@/services/uploadApi';
import { createDefaultNodeData } from '@/utils/nodeFactory';

type ImageNodeType = Node<ImageNodeData, 'image'>;

export const ImageNode = memo<NodeProps<ImageNodeType>>(function ImageNode({
  id,
  data,
  selected,
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addNode = useCanvasStore((s) => s.addNode);
  const addEdge = useCanvasStore((s) => s.addEdge);

  // 图片上传（上传到服务端 public/pic/ 目录）
  const handleUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        const url = await uploadImage(file);
        // 获取图片尺寸
        const img = new window.Image();
        img.onload = () => {
          useCanvasStore.getState().updateNodeData(id, {
            imageUrl: url,
            width: img.naturalWidth,
            height: img.naturalHeight,
          } as Partial<ImageNodeData>);
        };
        img.src = url;
      } catch (err) {
        console.error('图片上传失败:', err);
      }

      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [id]
  );

  // 已有图片时，创建下游节点用于图生图
  const handleCreateDownstream = useCallback(() => {
    const nodes = useCanvasStore.getState().nodes;
    const currentNode = nodes.find((n) => n.id === id);
    const posX = currentNode?.position.x ?? 0;
    const posY = currentNode?.position.y ?? 0;

    const newNodeId = `image-${Date.now()}`;
    addNode({
      id: newNodeId,
      type: 'image',
      position: { x: posX + 350, y: posY },
      data: createDefaultNodeData('image'),
      style: { width: 280 },
    });
    addEdge({
      id: `${id}-${newNodeId}`,
      source: id,
      target: newNodeId,
      type: 'dataFlow',
    });
  }, [id, addNode, addEdge]);

  // 标题栏右侧内容 — useMemo 避免每次渲染重建 JSX 导致 BaseNode 无效重渲染
  const headerRight = useMemo(() => {
    if (data.imageUrl) {
      return (
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          <span className="text-[11px] text-white/70">
            {data.width} × {data.height}
          </span>
          <button
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/20 hover:bg-white/30 text-[11px] text-white transition-colors cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              handleCreateDownstream();
            }}
            title="基于此图片生成新图片"
          >
            <UploadOutlined className="text-[10px]" />
            图生图
          </button>
        </div>
      );
    }
    return (
      <button
        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/20 hover:bg-white/30 text-[12px] text-white transition-colors cursor-pointer flex-shrink-0"
        onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
      >
        <UploadOutlined className="text-[11px]" />
        上传
      </button>
    );
  }, [data.imageUrl, data.width, data.height, handleCreateDownstream]);

  return (
    <>
      <BaseNode id={id} data={data} selected={selected} headerRight={headerRight}>
        {/* 图片区域 */}
        {data.imageUrl ? (
          <div className="relative rounded-lg overflow-hidden bg-gray-100">
            <img
              src={data.imageUrl}
              alt={data.label}
              className="w-full block"
              loading="lazy"
              decoding="async"
            />
          </div>
        ) : (
          <div className="w-full h-[180px] rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 flex flex-col items-center justify-center">
            <PictureOutlined className="text-4xl text-gray-300" />
          </div>
        )}

        {/* 隐藏的文件 input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleUpload}
        />
      </BaseNode>
    </>
  );
});
