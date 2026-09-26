import { memo, useState, useRef, useCallback, useMemo, useEffect } from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import { VideoCameraOutlined, PlayCircleOutlined, UploadOutlined, ImportOutlined } from '@ant-design/icons';
import { BaseNode } from './BaseNode';
import type { VideoNodeData } from '@/types/canvas';
import type { UserAsset } from '@/services/assetApi';
import { useCanvasStore } from '@/stores/canvasStore';
import { AssetLibraryModal } from '@/components/auth/AssetLibraryModal';
import { MediaPreviewModal } from '@/components/canvas/MediaPreviewModal';
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
  // 从资产库导入视频弹窗
  const [showAssetPicker, setShowAssetPicker] = useState(false);
  // 双击弹窗播放
  const [previewOpen, setPreviewOpen] = useState(false);

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
        // 获取视频实际尺寸和时长，用于按比例适配节点高度和显示时长
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.onloadedmetadata = () => {
          const updates: Partial<VideoNodeData> = {};
          if (video.videoWidth && video.videoHeight) {
            (updates as any).videoWidth = video.videoWidth;
            (updates as any).videoHeight = video.videoHeight;
          }
          if (video.duration && isFinite(video.duration)) {
            updates.duration = Math.round(video.duration);
          }
          if (Object.keys(updates).length > 0) {
            useCanvasStore.getState().updateNodeData(id, updates);
          }
        };
        video.src = res.url;
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

  // 单击进入内联播放。但双击会先派发两次 click —— 延迟 250ms 再播，
  // 期间若发生双击就把定时器取消，避免"内联播放闪一下又弹窗"。
  const clickTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current);
    },
    []
  );
  const handlePlayClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      return;
    }
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null;
      setShowPlayer(true);
    }, 250);
  }, []);

  // 双击弹窗播放：把内联播放器收起，避免同一个地址两路解码
  const handleOpenPreview = useCallback(() => {
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    setShowPlayer(false);
    setPreviewOpen(true);
  }, []);

  // 视频时长标签：< 60s 显示 "Ns"，否则 "M:SS"
  const durationLabel = useMemo(() => {
    const d = data.duration || 0;
    if (d <= 0) return '';
    if (d < 60) return `${d}s`;
    const m = Math.floor(d / 60);
    const s = d % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }, [data.duration]);

  // 弹窗标题右侧：分辨率 · 时长
  const previewMeta = useMemo(() => {
    const vw = (data as { videoWidth?: number }).videoWidth;
    const vh = (data as { videoHeight?: number }).videoHeight;
    return [vw && vh ? `${vw} × ${vh}` : '', durationLabel].filter(Boolean).join(' · ');
  }, [durationLabel, (data as { videoWidth?: number }).videoWidth, (data as { videoHeight?: number }).videoHeight]);

  // 从资产库选中视频：替换节点视频（清掉旧尺寸/时长，由元数据加载重新计算）
  const handlePickAsset = useCallback(
    (asset: UserAsset) => {
      useCanvasStore.getState().updateNodeData(id, {
        videoUrl: asset.url,
        duration: undefined,
        videoWidth: undefined,
        videoHeight: undefined,
      } as Partial<VideoNodeData>);
    },
    [id]
  );

  const headerRight = useMemo(() => {
    // 图标按钮：上传/重传 + 从资产库导入
    const iconBtnCls = 'flex items-center justify-center w-6 h-6 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer';
    if (data.videoUrl) {
      return (
        <div className="flex items-center gap-0.5">
          {durationLabel && (
            <span className="px-1.5 py-1 rounded bg-gray-100 text-gray-600 text-[11px] font-medium leading-none">
              {durationLabel}
            </span>
          )}
          <button
            className={iconBtnCls}
            title="重新上传视频"
            onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
          >
            <UploadOutlined className="text-[12px]" />
          </button>
          <button
            className={iconBtnCls}
            title="从个人资产库导入"
            onClick={(e) => { e.stopPropagation(); setShowAssetPicker(true); }}
          >
            <ImportOutlined className="text-[12px]" />
          </button>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {uploading && <span className="text-[11px] text-blue-500 mr-1">{uploadPercent}%</span>}
        <button
          className={`${iconBtnCls} ${uploading ? 'opacity-50 cursor-wait' : ''}`}
          title="上传视频"
          onClick={(e) => { e.stopPropagation(); if (!uploading) fileInputRef.current?.click(); }}
        >
          <UploadOutlined className="text-[12px]" />
        </button>
        <button
          className={iconBtnCls}
          title="从个人资产库导入"
          onClick={(e) => { e.stopPropagation(); setShowAssetPicker(true); }}
        >
          <ImportOutlined className="text-[12px]" />
        </button>
      </div>
    );
  }, [data.videoUrl, uploading, uploadPercent, durationLabel]);

  const phaseLabel = uploadPhase === 'processing' ? '压缩转码中...' : `上传中 ${uploadPercent}%`;

  // 根据长宽比动态计算视频容器高度（宽度固定 480px）
  // - 有视频实际尺寸时：按实际比例计算
  // - 无视频时：根据用户选择的 aspectRatio 计算
  const videoHeight = useMemo(() => {
    const vw = (data as { videoWidth?: number }).videoWidth;
    const vh = (data as { videoHeight?: number }).videoHeight;
    if (data.videoUrl && vw && vh) {
      return Math.round(480 * vh / vw); // 按视频实际比例缩放
    }
    // 无视频时根据 aspectRatio 计算
    const ratio = (data as { aspectRatio?: string }).aspectRatio || '16:9';
    if (ratio === 'free') return 270; // 自适应默认 16:9
    const parts = ratio.split(':').map(Number);
    if (parts.length !== 2 || !parts[0] || !parts[1]) return 270;
    const [w, h] = parts;
    return Math.round(480 * h / w);
  }, [data.videoUrl, (data as { videoWidth?: number }).videoWidth, (data as { videoHeight?: number }).videoHeight, (data as { aspectRatio?: string }).aspectRatio]);

  // 弹窗占位尺寸：视频原始分辨率（放在 videoHeight 之后声明，避免 TDZ）
  const intrinsicVideoWidth = (data as { videoWidth?: number }).videoWidth;
  const intrinsicVideoHeight = (data as { videoHeight?: number }).videoHeight;

  // AI 生成视频后，加载视频元数据获取实际尺寸和时长
  // videoUrl 变化时必须重新加载，否则会沿用上一段视频的尺寸导致比例错误
  useEffect(() => {
    if (!data.videoUrl) return;
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const updates: Partial<VideoNodeData> = {};
      if (video.videoWidth && video.videoHeight) {
        (updates as any).videoWidth = video.videoWidth;
        (updates as any).videoHeight = video.videoHeight;
      }
      if (video.duration && isFinite(video.duration) && !data.duration) {
        updates.duration = Math.round(video.duration);
      }
      if (Object.keys(updates).length > 0) {
        useCanvasStore.getState().updateNodeData(id, updates);
      }
    };
    video.src = data.videoUrl;
  }, [data.videoUrl, id]);

  return (
    <>
      <BaseNode
        id={id}
        data={data}
        selected={selected}
        headerRight={headerRight}
        noContentPadding
        className="!w-[480px]"
      >
        <div
          className="w-[480px]"
          style={{ height: `${videoHeight}px` }}
          title={data.videoUrl ? '双击弹窗播放' : undefined}
          onDoubleClick={(e) => {
            if (!data.videoUrl) return;
            e.stopPropagation();
            handleOpenPreview();
          }}
        >
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

      {/* 双击弹窗播放：展示 videoUrl 原视频 */}
      <MediaPreviewModal
        open={previewOpen}
        kind="video"
        url={data.videoUrl}
        title={data.label}
        meta={previewMeta || undefined}
        width={intrinsicVideoWidth}
        height={intrinsicVideoHeight}
        onClose={() => setPreviewOpen(false)}
      />

      {/* 从资产库导入视频（Modal 默认 portal 到 body，不受画布 transform 影响） */}
      {showAssetPicker && (
        <AssetLibraryModal
          pickType="video"
          onClose={() => setShowAssetPicker(false)}
          onPick={handlePickAsset}
        />
      )}
    </>
  );
});
