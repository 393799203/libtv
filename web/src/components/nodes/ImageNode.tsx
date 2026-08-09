import { memo, useRef, useCallback, useMemo, useState, useEffect } from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import {
  PictureOutlined,
  UploadOutlined,
  ExperimentOutlined,
} from '@ant-design/icons';
import { message } from 'antd';
import type { ImageNodeData } from '@/types/canvas';
import { useCanvasStore } from '@/stores/canvasStore';
import { BaseNode } from './BaseNode';
import { uploadImage } from '@/services/uploadApi';

type ImageNodeType = Node<ImageNodeData, 'image'>;

export const ImageNode = memo<NodeProps<ImageNodeType>>(function ImageNode({
  id,
  data,
  selected,
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectId = useCanvasStore((s) => s.projectId);

  // 是否为风格图片节点
  const isStyleNode = id.startsWith('style-');
  // 风格节点使用粉色主题
  const styleColor = isStyleNode ? '#ec4899' : undefined;

  // 图片尺寸：优先使用data中的值（后端返回），否则通过加载图片获取（fallback）
  const [loadedSize, setLoadedSize] = useState<{ width: number; height: number } | null>(null);

  // 最终尺寸：data中有值就用data的，否则用加载获取的
  const imageWidth = data.width || loadedSize?.width;
  const imageHeight = data.height || loadedSize?.height;

  // Fallback：如果data中没有width/height，通过加载图片获取尺寸
  useEffect(() => {
    if (data.imageUrl && !data.width && !data.height) {
      const img = new window.Image();
      img.onload = () => {
        setLoadedSize({
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
      };
      img.onerror = () => {
        setLoadedSize(null);
      };
      img.src = data.imageUrl;
    } else {
      setLoadedSize(null);
    }
  }, [data.imageUrl, data.width, data.height]);

  // 图片上传（上传到服务端 public/canvas/{projectId}/ 目录）
  const handleUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        // ✅ 后端现在返回 url + width + height，统一数据格式
        const result = await uploadImage(file, projectId || undefined);
        useCanvasStore.getState().updateNodeData(id, {
          imageUrl: result.url,
          width: result.width,    // ✅ 保存宽度
          height: result.height,  // ✅ 保存高度
        } as Partial<ImageNodeData>);
      } catch (err) {
        console.error('图片上传失败:', err);
        // HTTP 错误已由 api.ts 拦截器统一 message.error()，此处仅兜底非 HTTP 错误
        if (!(err instanceof Error) || !err.message) {
          message.error('图片上传失败');
        }
      }

      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [id, projectId]
  );

  // 标题栏右侧内容 — useMemo 避免每次渲染重建 JSX 导致 BaseNode 无效重渲染
  const headerRight = useMemo(() => {
    if (isStyleNode) {
      // 风格节点：显示风格标记
      return (
        <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-500 text-[11px] text-white">
          <ExperimentOutlined className="text-[10px]" />
          风格
        </span>
      );
    }
    if (data.imageUrl && imageWidth && imageHeight) {
      return (
        <span className="text-[11px] text-gray-400 flex-shrink-0 ml-2">
          {imageWidth} × {imageHeight}
        </span>
      );
    }
    return (
      <button
        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-500 hover:bg-blue-600 text-[12px] text-white transition-colors cursor-pointer flex-shrink-0"
        onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
      >
        <UploadOutlined className="text-[11px]" />
        上传
      </button>
    );
  }, [data.imageUrl, imageWidth, imageHeight, isStyleNode]);

  // 计算图片容器高度：使用图片的实际尺寸等比例缩放
  const imageContainerHeight = 
    (data.imageUrl && imageWidth && imageHeight
      ? Math.round(280 * imageHeight / imageWidth) // 按节点宽度280px等比例缩放
      : 190);

  return (
    <>
      <BaseNode
        id={id}
        data={data}
        selected={selected}
        headerRight={headerRight}
        headerColor={styleColor}
        noContentPadding
        className="!w-[280px]"
      >
        {/* 图片区域 */}
        {data.imageUrl ? (
          <div
            className="relative rounded-lg overflow-hidden bg-gray-100 w-[280px]"
            style={{ minHeight: `${imageContainerHeight}px` }}
          >
            <img
              src={data.imageUrl}
              alt={data.label}
              className="w-full block"
              loading="lazy"
              decoding="async"
            />
          </div>
        ) : (
          <div
            className="w-full rounded-lg bg-gray-50 flex flex-col items-center justify-center"
            style={{ minHeight: `${imageContainerHeight}px` }}
          >
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
