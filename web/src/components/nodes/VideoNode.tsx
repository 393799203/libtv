import { memo, useState, useRef, useCallback, useMemo } from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import { VideoCameraOutlined, PlayCircleOutlined, UploadOutlined } from '@ant-design/icons';
import { BaseNode } from './BaseNode';
import type { VideoNodeData } from '@/types/canvas';
import { useCanvasStore } from '@/stores/canvasStore';
import { uploadVideo } from '@/services/uploadApi';

type VideoNodeType = Node<VideoNodeData, 'video'>;

type UploadPhase = 'uploading' | 'processing';

export const VideoNode = memo<NodeProps<VideoNodeType>>(function VideoNode({ id, data, selected }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectId = useCanvasStore((s) => s.projectId);
  const [showPlayer, setShowPlayer] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>('uploading');
  const [errorMsg, setErrorMsg] = useState<string>('');

  // 视频上传
  const handleUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setUploading(true);
      setUploadPercent(0);
      setUploadPhase('uploading');
      setErrorMsg('');

      try {
        const res = await uploadVideo(
          file,
          (pct, phase) => {
            setUploadPercent(pct);
            if (phase) setUploadPhase(phase);
          },
          projectId || undefined,
        );
        useCanvasStore.getState().updateNodeData(id, {
          videoUrl: res.url,
        } as Partial<VideoNodeData>);
      } catch (err) {
        const message = err instanceof Error ? err.message : '视频上传失败';
        console.error('视频上传失败:', err);
        setErrorMsg(message);
      } finally {
        setUploading(false);
        setUploadPercent(0);
      }

      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [id, projectId]
  );

  const handlePlayClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowPlayer(true);
  }, []);

  const headerRight = useMemo(() => {
    if (data.videoUrl) {
      return (
        <button
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-500 hover:bg-blue-600 text-[11px] text-white transition-colors cursor-pointer"
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
          uploading ? 'bg-blue-300 cursor-wait' : 'bg-blue-500 hover:bg-blue-600'
        }`}
        onClick={(e) => { e.stopPropagation(); if (!uploading) fileInputRef.current?.click(); }}
      >
        <UploadOutlined className="text-[11px]" />
        {uploading ? `${uploadPercent}%` : '上传'}
      </button>
    );
  }, [data.videoUrl, uploading, uploadPercent]);

  const phaseLabel = uploadPhase === 'processing' ? '压缩转码中...' : `上传中 ${uploadPercent}%`;

  return (
    <>
      <BaseNode
        id={id}
        data={data}
        selected={selected}
        headerRight={headerRight}
        noContentPadding
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
              <PlayCircleOutlined className="relative text-5xl !text-white" />
            </div>
          ) : (
            <div className="flex items-center justify-center w-full h-full bg-gray-50 rounded">
              {uploading ? (
                <div className="flex flex-col items-center gap-2 px-4">
                  <div className={`w-6 h-6 border-2 rounded-full animate-spin ${
                    uploadPhase === 'processing'
                      ? 'border-orange-200 border-t-orange-500'
                      : 'border-blue-200 border-t-blue-500'
                  }`} />
                  <span className={`text-xs font-medium ${
                    uploadPhase === 'processing' ? 'text-orange-500' : 'text-gray-500'
                  }`}>
                    {phaseLabel}
                  </span>
                  <div className="w-32 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-200 ${
                        uploadPhase === 'processing' ? 'bg-orange-500' : 'bg-blue-500'
                      }`}
                      style={{ width: `${uploadPercent}%` }}
                    />
                  </div>
                </div>
              ) : errorMsg ? (
                <div className="flex flex-col items-center gap-2 px-4 text-center">
                  <span className="text-xs text-red-500 leading-relaxed">{errorMsg}</span>
                  <button
                    className="px-3 py-1 text-[11px] bg-red-50 text-red-500 rounded hover:bg-red-100 transition-colors cursor-pointer"
                    onClick={(e) => { e.stopPropagation(); setErrorMsg(''); fileInputRef.current?.click(); }}
                  >
                    重新上传
                  </button>
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
