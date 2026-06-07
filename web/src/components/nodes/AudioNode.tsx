import { memo, useState, useCallback } from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import { AudioOutlined, PlayCircleOutlined, PauseCircleOutlined } from '@ant-design/icons';
import { BaseNode } from './BaseNode';
import type { AudioNodeData } from '@/types/canvas';

type AudioNodeType = Node<AudioNodeData, 'audio'>;

export const AudioNode = memo<NodeProps<AudioNodeType>>(function AudioNode({ id, data, selected }) {
  const [showPlayer, setShowPlayer] = useState(false);

  const handlePlayClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowPlayer(true);
  }, []);

  return (
    <BaseNode id={id} data={data} selected={selected}>
      <div className="space-y-1.5">
        {data.audioUrl && showPlayer ? (
          <audio
            src={data.audioUrl}
            controls
            autoPlay
            className="w-full"
            style={{ height: 32 }}
          />
        ) : data.audioUrl ? (
          <div
            className="flex items-center justify-center gap-2 h-10 bg-purple-50 rounded cursor-pointer group hover:bg-purple-100 transition-colors"
            onClick={handlePlayClick}
          >
            <PlayCircleOutlined className="text-lg text-purple-400 group-hover:text-purple-600 transition-colors" />
            <span className="text-xs text-purple-400 group-hover:text-purple-600">点击播放</span>
          </div>
        ) : (
          <div className="flex items-center justify-center h-12 bg-gray-50 rounded border border-dashed border-gray-300">
            <AudioOutlined className="text-xl text-gray-300" />
          </div>
        )}
        <p className="text-gray-500 text-[10px] truncate">
          {data.prompt || '输入音频生成提示词'}
        </p>
        <div className="flex gap-1 text-[10px] text-gray-400">
          <span>{data.model}</span>
          <span>·</span>
          <span>{data.duration}s</span>
        </div>
      </div>
    </BaseNode>
  );
});
