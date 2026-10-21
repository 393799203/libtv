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
import { NodeToolbar } from '@/components/canvas/NodeToolbar';
import { VideoSegmentBar } from './VideoSegmentBar';
import { applyRangeToPrompt, clampRange, probeVideoDuration, refVideoLimitWarning } from '@/utils/reshootPrompt';
import { findFilmstripFor, patchReshoot, readReshoot } from '@/utils/reshootPatch';
import { imageOpsApi } from '@/services/imageOpsApi';

type VideoNodeType = Node<VideoNodeData, 'video'>;

type UploadPhase = 'uploading' | 'processing';

export const VideoNode = memo<NodeProps<VideoNodeType>>(function VideoNode({ id, data, selected }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectId = useCanvasStore((s) => s.projectId);
  const [showPlayer, setShowPlayer] = useState(false);
  const [localUploading, setLocalUploading] = useState(false);
  const [localUploadPercent, setLocalUploadPercent] = useState(0);
  const [localUploadPhase, setLocalUploadPhase] = useState<UploadPhase>('uploading');
  const [localErrorMsg, setLocalErrorMsg] = useState<string>('');

  /**
   * 上传态的**两个来源**合并成一套显示：
   *  - 本地态：节点内点「上传视频」触发的上传；
   *  - 节点数据：拖入画布时「先建节点、后上传」的占位（见 Canvas 的 drop 流程）。
   * 两者不会同时发生（占位上传期间节点内的上传按钮是禁用的）。
   */
  const uploading = localUploading || !!data.uploading;
  const uploadPercent = localUploading ? localUploadPercent : (data.uploadProgress ?? 0);
  const uploadPhase: UploadPhase = localUploading
    ? localUploadPhase
    : (data.uploadPhase === '转码中' ? 'processing' : 'uploading');
  const errorMsg = localErrorMsg || data.uploadError || '';
  // 从资产库导入视频弹窗
  const [showAssetPicker, setShowAssetPicker] = useState(false);
  // 双击弹窗播放
  const [previewOpen, setPreviewOpen] = useState(false);

  // 视频上传
  const handleUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setLocalUploading(true);
      setLocalUploadPercent(0);
      setLocalUploadPhase('uploading');
      setLocalErrorMsg('');

      try {
        const res = await uploadVideo(
          file,
          (pct, phase) => {
            setLocalUploadPercent(pct);
            if (phase) setLocalUploadPhase(phase);
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
            // 尺寸/时长是测量出来的派生值，不算用户编辑（videoUrl 那次已经置脏）
            useCanvasStore.getState().updateNodeMeta(id, updates);
          }
        };
        video.src = res.url;
      } catch (err) {
        const message = err instanceof Error ? err.message : '视频上传失败';
        console.error('视频上传失败:', err);
        setLocalErrorMsg(message);
      } finally {
        setLocalUploading(false);
        setLocalUploadPercent(0);
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

  // 视频分辨率标签：宽×高（由视频文件元数据测出来的值，上传/生成后自动回写进节点）。
  // 只是一个字符串拼接，不用 useMemo（避免 hook 依赖告警）
  const videoPixelW = (data as { videoWidth?: number }).videoWidth;
  const videoPixelH = (data as { videoHeight?: number }).videoHeight;
  const resolutionLabel = videoPixelW && videoPixelH ? `${videoPixelW}×${videoPixelH}` : '';

  // 弹窗标题右侧：分辨率 · 时长
  const previewMeta = useMemo(
    () => [resolutionLabel, durationLabel].filter(Boolean).join(' · '),
    [resolutionLabel, durationLabel]
  );

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
          {/* 分辨率在时长左边（与弹窗标题「分辨率 · 时长」顺序一致）：
              宽度是整数像素，样式与时长胶囊一致 */}
          {resolutionLabel && (
            <span className="px-1.5 py-1 rounded bg-gray-100 text-gray-600 text-[11px] font-medium leading-none">
              {resolutionLabel}
            </span>
          )}
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
        {uploading && uploadPercent > 0 && (
          <span className="text-[11px] text-blue-500 mr-1">{uploadPercent}%</span>
        )}
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
  }, [data.videoUrl, uploading, uploadPercent, durationLabel, resolutionLabel]);

  const phaseLabel =
    uploadPhase === 'processing' ? '压缩转码中...' : uploadPercent > 0 ? `上传中 ${uploadPercent}%` : '上传中…';

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
    if (ratio === 'adaptive' || ratio === 'free') return 270; // 自适应默认 16:9（free 为历史值）
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
      const storedW = (data as { videoWidth?: number }).videoWidth;
      const storedH = (data as { videoHeight?: number }).videoHeight;
      // 只在"与已存的值不同"时才回写：每次加载都原值回写会把画布标脏，
      // 用户一刷新进来什么都没动就显示"未保存"
      if (video.videoWidth && video.videoHeight &&
          (video.videoWidth !== storedW || video.videoHeight !== storedH)) {
        (updates as any).videoWidth = video.videoWidth;
        (updates as any).videoHeight = video.videoHeight;
      }
      if (video.duration && isFinite(video.duration) && !data.duration) {
        updates.duration = Math.round(video.duration);
      }
      if (Object.keys(updates).length > 0) {
        useCanvasStore.getState().updateNodeMeta(id, updates);
      }
    };
    video.src = data.videoUrl;
  }, [data.videoUrl, id]);

  /**
   * 片段条的区间变更：
   *  - 拖动中 transient=true：只预览，不进撤销历史（否则拖一次灌几十条历史，⌘Z 要按到手酸）
   *  - 松手 transient=false：一次提交，⌘Z 一步回到拖动前
   * 提示词只改**第一处**时间区间，用户自己写的内容原样保留（见 reshootPrompt.ts）。
   */
  const commitReshootRange = useCallback(
    (start: number, end: number, transient: boolean) => {
      const state = data.reshoot;
      if (!state) return;
      // 提示词**在拖动过程中就跟着改**（用户要的是"上面一动、下面立刻变"），
      // 拖动全程走 transient：不进撤销历史，松手时那一次才留档。
      // 用此刻画布上的 prompt 做基准，而不是闭包里的（拖动中它每帧都在变）。
      const fresh = useCanvasStore.getState().nodes.find((n) => n.id === id);
      const cur = (fresh?.data as VideoNodeData | undefined) ?? data;
      if (cur.reshoot && cur.reshoot.start === start && cur.reshoot.end === end) return;
      const prompt = applyRangeToPrompt(cur.prompt || '', start, end);
      useCanvasStore.getState().updateNodeData(
        id,
        { reshoot: { ...(cur.reshoot ?? state), start, end }, prompt } as never,
        { transient }
      );
    },
    [data, id]
  );

  /**
   * 重拍节点到了画布上之后，把片段条需要的东西补齐（只做一次，缺什么补什么）：
   *  - durationSeconds：源视频总时长 —— 拖动的横轴。工具栏创建时就探过一次，
   *    但重开项目/别人协作时节点可能是"没探到时长"的状态存下来的，这里补探。
   *  - filmstripUrl：整条视频的缩略拼图 —— 剪映那种条要有画面才看得出"这一段是什么"。
   * 两者都写回节点数据（走 updateNodeMeta：这是素材元信息，不该进撤销历史）。
   * 用 ref 挡住重复请求：setData 会触发重渲染，没有这道闸就会变成无限循环打接口。
   */
  const hydratedRef = useRef<string | null>(null);
  const [filmstripLoading, setFilmstripLoading] = useState(false);
  const reshoot = data.reshoot;
  useEffect(() => {
    if (!reshoot || hydratedRef.current === id) return;
    const url = reshoot.sourceUrl;
    if (!url) return;
    hydratedRef.current = id;

    /**
     * 时长到了就写回，并把区间夹到片长内、提示词跟着改。
     * ⚠️ 一律走 patchReshoot / 读最新数据：这个回调可能在"用户已经拖过区间"之后才回来，
     * 用闭包里的旧区间会把用户的拖动结果冲掉。
     */
    const applyDuration = (d: number) => {
      const cur = readReshoot(id);
      if (!cur || cur.durationSeconds) return;
      const clamped = clampRange(cur.start, cur.end, d);
      const fresh = useCanvasStore.getState().nodes.find((n) => n.id === id);
      if (!fresh) return;
      // ⚠️ 走 updateNodeMeta 而不是 updateNodeData：这是**探测回来的素材元信息**补齐
      // （区间夹到片长内 + 提示词跟着改），不是用户编辑。用 updateNodeData 会在打开项目、
      // 用户什么都没动的时候把画布标脏（时长探测是挂载时自动跑的）—— 上面那段注释说的也是走它。
      useCanvasStore.getState().updateNodeMeta(id, {
        reshoot: { ...cur, start: clamped.start, end: clamped.end, durationSeconds: d },
        prompt: applyRangeToPrompt((fresh.data as VideoNodeData).prompt || '', clamped.start, clamped.end),
      } as never);
    };

    // 浏览器侧探测：快（只读元数据），但可能被源站拦；失败也不要紧，下面那支接口会带回真实时长
    void probeVideoDuration(url).then((d) => { if (d) applyDuration(d); });

    if (!reshoot.filmstripUrl) {
      // 同一支源视频已经算过就直接抄（见 findFilmstripFor）：不用再等那 30 秒
      const reused = findFilmstripFor(url, id);
      if (reused) {
        patchReshoot(id, { filmstripUrl: reused });
        return;
      }
      // 8 格够看（条宽 480 时每格 60px）
      setFilmstripLoading(true);
      void imageOpsApi
        .videoFilmstrip({ videoUrl: url, count: 8 })
        .then((res) => {
          // 接口顺带带回 ffprobe 实测时长 —— 比前端探的准，且浏览器探测失败时它就是唯一来源
          if (res.duration && res.duration > 0) applyDuration(res.duration);
          patchReshoot(id, { filmstripUrl: res.url });
        })
        .catch(() => {
          // 读不到缩略图不是致命问题：条退化成灰底，区间照样能拖
        })
        .finally(() => setFilmstripLoading(false));
    }
  }, [id, reshoot]);

  return (
    <>
      <BaseNode
        id={id}
        data={data}
        selected={selected}
        headerRight={headerRight}
        noContentPadding
        loadingMinHeight={videoHeight}
        className="!w-[480px]"
      >
        {/* 有视频时：上方与节点头部齐平（圆角 0），下方 0.5rem；
            圆角放在容器上并 overflow-hidden，内层视频不再单独设圆角（否则出现双层圆角缺口） */}
        <div
          className={`w-[480px] overflow-hidden ${data.videoUrl ? 'rounded-t-none rounded-b-[0.5rem]' : ''}`}
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
              className="w-full h-full object-cover"
              muted
              controls
              autoPlay
              // 「截取当前帧」要读播放进度（见 components/canvas/videoPlayhead.ts）：
              // 只标注真正在播放的这个元素，缩略图那个（preload=metadata）不算
              data-video-playhead={id}
            />
          ) : data.videoUrl ? (
            <div
              className="relative w-full h-full flex items-center justify-center bg-[var(--dv-surface-1)] cursor-pointer group"
              onClick={handlePlayClick}
            >
              <video
                src={data.videoUrl}
                className="absolute inset-0 w-full h-full object-cover opacity-50"
                muted
                preload="metadata"
              />
              <PlayCircleOutlined className="relative text-5xl !text-white" />
            </div>
          ) : (
            <div className="flex items-center justify-center w-full h-full bg-transparent rounded">
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
                    onClick={(e) => { e.stopPropagation(); setLocalErrorMsg(''); fileInputRef.current?.click(); }}
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
        {data.reshoot && (
          <VideoSegmentBar
            start={data.reshoot.start}
            end={data.reshoot.end}
            duration={data.reshoot.durationSeconds}
            // 真缩略图没到之前，用节点自己的封面先顶住：条一出现就有画面，等图到了再换
            filmstripUrl={data.reshoot.filmstripUrl || (data as { stillUrl?: string; thumbUrl?: string }).stillUrl || (data as { thumbUrl?: string }).thumbUrl}
            // 条驱动播放器：拖把手/拖整段/按在条上擦洗/方向键，视频都会跳到那一刻
            playerNodeId={id}
            hint={
              filmstripLoading
                ? '缩略图生成中（不影响拖区间）…'
                : '拖把手改起止 · 拖中间整段平移 · 点条上任意位置跳到那一刻'
            }
            onDrag={(s, e) => commitReshootRange(s, e, true)}
            onCommit={(s, e) => commitReshootRange(s, e, false)}
            // 参考视频送的是整条源视频，所以这里要用 source 的总时长算，不是选中的区间长度
            warning={refVideoLimitWarning({
              refSeconds: data.reshoot.durationSeconds,
              genSeconds: data.duration,
              model: data.model,
            })}
          />
        )}
      </BaseNode>
      {/* 节点工具条（所有节点通用：复制/删除/下载/存资产/看历史）：
          作为 BaseNode 的**兄弟**渲染 —— 父级是 .react-flow__node，
          所以 absolute bottom-full 是贴在整个节点上方，不会被内容区的 overflow 裁掉 */}
      <NodeToolbar nodeId={id} />


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
