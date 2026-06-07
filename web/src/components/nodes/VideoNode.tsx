import { memo, useState, useCallback } from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import { VideoCameraOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { BaseNode } from './BaseNode';
import type { VideoNodeData } from '@/types/canvas';

type VideoNodeType = Node<VideoNodeData, 'video'>;

export const VideoNode = memo<NodeProps<VideoNodeType>>(function VideoNode({ id, data, selected }) {
  const [showPlayer, setShowPlayer] = useState(false);

  const handlePlayClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowPlayer(true);
  }, []);

  return (
    <BaseNode id={id} data={data} selected={selected}>
      <div className="space-y-1.5">
        {data.videoUrl && showPlayer ? (
          <video
            src={data.videoUrl}
            className="w-full rounded"
            style={{ maxHeight: 120, objectFit: 'cover' }}
            muted
            controls
            autoPlay
          />
        ) : data.videoUrl ? (
          <div
            className="relative flex items-center justify-center h-20 bg-gray-900 rounded cursor-pointer group"
            onClick={handlePlayClick}
          >
            <video
              src={data.videoUrl}
              className="absolute inset-0 w-full h-full rounded object-cover opacity-50"
              muted
              preload="metadata"
            />
            <PlayCircleOutlined className="relative text-2xl text-white/80 group-hover:text-white transition-colors" />
          </div>
        ) : (
          <div className="flex items-center justify-center h-20 bg-gray-50 rounded border border-dashed border-gray-300">
            <VideoCameraOutlined className="text-2xl text-gray-300" />
          </div>
        )}
        <p className="text-gray-500 text-[10px] truncate">
          {data.prompt || '输入视频生成提示词'}
        </p>
        <div className="flex gap-1 text-[10px] text-gray-400">
          <span>{data.model}</span>
          <span>·</span>
          <span>{data.duration}s</span>
          <span>·</span>
          <span>{data.fps}fps</span>
        </div>
      </div>
    </BaseNode>
  );
});
