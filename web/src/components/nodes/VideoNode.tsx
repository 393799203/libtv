import { memo, useState, useRef, useCallback, useMemo } from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import { VideoCameraOutlined, PlayCircleOutlined, UploadOutlined } from '@ant-design/icons';
import { BaseNode } from './BaseNode';
import type { VideoNodeData } from '@/types/canvas';
import { useCanvasStore } from '@/stores/canvasStore';
import { uploadVideo } from '@/services/uploadApi';

type VideoNodeType = Node<VideoNodeData, 'video'>;

export const VideoNode = memo<NodeProps<VideoNodeType>>(function VideoNode({ id, data, selected }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectId = useCanvasStore((s) => s.projectId);
  const [showPlayer, setShowPlayer] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);

  // 视频上传
  const handleUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setUploading(true);
      setUploadPercent(0);

      try {
        const res = await uploadVideo(
          file,
          (pct) => setUploadPercent(pct),
          projectId || undefined,
        );
        useCanvasStore.getState().updateNodeData(id, {
          videoUrl: res.url,
        } as Partial<VideoNodeData>);
      } catch (err) {
        console.error('视频上传失败:', err);
      } finally {
        setUploading(false);
        setUploadPercent(0);
      }

      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [id]
  );

  const handlePlayClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowPlayer(true);
  }, []);

  const headerRight = useMemo(() => {
    if (data.videoUrl) {
      return (
        <button
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/20 hover:bg-white/30 text-[11px] text-white transition-colors cursor-pointer"
          onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
          title="重新上传视频"
        >
          <UploadOutlined className="text-[10px]" />
          重传
        </button>
      );
    }
    return (
      <button
        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[12px] text-white transition-colors cursor-pointer flex-shrink-0 ${
          uploading ? 'bg-white/10 cursor-wait' : 'bg-white/20 hover:bg-white/30'
        }`}
        onClick={(e) => { e.stopPropagation(); if (!uploading) fileInputRef.current?.click(); }}
      >
        <UploadOutlined className="text-[11px]" />
        {uploading ? `${uploadPercent}%` : '上传'}
      </button>
    );
  }, [data.videoUrl, uploading, uploadPercent]);

  return (
    <>
      <BaseNode
        id={id}
        data={data}
        selected={selected}
        headerRight={headerRight}
      >
        <div className="w-full aspect-video">
          {data.videoUrl && showPlayer ? (
            <video
              src={data.videoUrl}
              className="w-full h-full rounded object-cover"
              muted
              controls
              autoPlay
            />
          ) : data.videoUrl ? (
            <div
              className="relative w-full h-full flex items-center justify-center bg-gray-900 rounded cursor-pointer group"
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
            <div className="relative flex items-center justify-center w-full h-full bg-gray-50 rounded border border-dashed border-gray-300 cursor-pointer"
              onClick={(e) => { if (!uploading) { e.stopPropagation(); fileInputRef.current?.click(); } }}
            >
              {uploading ? (
                <div className="flex flex-col items-center gap-2 px-4">
                  <VideoCameraOutlined className="text-xl text-gray-400 animate-pulse" />
                  <span className="text-xs text-gray-500">上传中 {uploadPercent}%</span>
                  <div className="w-32 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all duration-200"
                      style={{ width: `${uploadPercent}%` }}
                    />
                  </div>
                </div>
              ) : (
                <VideoCameraOutlined className="text-2xl text-gray-300" />
              )}
            </div>
          )}
        </div>
      </BaseNode>

      {/* 隐藏的文件 input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={handleUpload}
      />
    </>
  );
});
