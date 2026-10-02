import { useEffect, useRef, useState } from 'react';
import { Select, App, Switch } from 'antd';
import { VideoCameraOutlined, PictureOutlined } from '@ant-design/icons';
import { usePrevizStore } from './previzStore';
import { pickRecorderMimeType, recordPrevizVideo, capturePrevizStill } from './recorder';
import { uploadVideo, uploadImage } from '@/services/uploadApi';
import { useCanvasStore } from '@/stores/canvasStore';
import { canvasApi } from '@/services/canvasApi';
import { createNode } from '@/utils/nodeFactory';
import type { PrevizNodeData } from '@/types/canvas';

// 导出分辨率选项
const RESOLUTION_OPTIONS = [
  { value: '720p', label: '720p (1280×720)', width: 1280, height: 720 },
  { value: '1080p', label: '1080p (1920×1080)', width: 1920, height: 1080 },
] as const;

// 静帧比例（漫剧/短视频以竖屏为主，横竖方都要能给）
const STILL_RATIOS = [
  { value: '16:9', label: '横屏 16:9', w: 16, h: 9 },
  { value: '9:16', label: '竖屏 9:16', w: 9, h: 16 },
  { value: '1:1', label: '方形 1:1', w: 1, h: 1 },
  { value: '4:3', label: '经典 4:3', w: 4, h: 3 },
] as const;

type StillRatio = (typeof STILL_RATIOS)[number]['value'];

// 长边像素：短边按比例换算（16:9 + 1920 → 1920×1080；9:16 + 1920 → 1080×1920）
const STILL_LONG_SIDES = [
  { value: 1080, label: '长边 1080' },
  { value: 1440, label: '长边 1440' },
  { value: 1920, label: '长边 1920' },
] as const;

function stillPixelSize(ratio: StillRatio, longSide: number): { width: number; height: number } {
  const r = STILL_RATIOS.find((x) => x.value === ratio) ?? STILL_RATIOS[0];
  return r.w >= r.h
    ? { width: longSide, height: Math.round((longSide * r.h) / r.w) }
    : { width: Math.round((longSide * r.w) / r.h), height: longSide };
}

type ExportPhase = 'idle' | 'recording' | 'uploading';
type StillPhase = 'idle' | 'capturing' | 'uploading';

// 导出白片面板：录制 → 上传 → 写回 previz 节点并在画布生成视频节点
export function ExportPanel({ projectId, nodeId }: { projectId: string; nodeId: string }) {
  const { message } = App.useApp();
  const cameras = usePrevizStore((s) => s.cameras);
  const selectedCameraId = usePrevizStore((s) => s.selectedCameraId);
  const fps = usePrevizStore((s) => s.fps);
  const setFps = usePrevizStore((s) => s.setFps);

  const [camId, setCamId] = useState<string | null>(null);
  const [resolution, setResolution] = useState<'720p' | '1080p'>('720p');
  const [phase, setPhase] = useState<ExportPhase>('idle');
  const [recordPct, setRecordPct] = useState(0);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadPhase, setUploadPhase] = useState<'uploading' | 'processing'>('uploading');
  // 录制期间切过标签页的警告（不强制停止）
  const [hiddenWarning, setHiddenWarning] = useState(false);

  // 静帧导出：默认横屏 16:9、长边 1440（2560×1440，作构图参考够清晰且不占太多上传体积）
  const [stillRatio, setStillRatio] = useState<StillRatio>('16:9');
  const [stillLongSide, setStillLongSide] = useState<number>(1440);
  const [stillAllCams, setStillAllCams] = useState(false);
  const [stillPhase, setStillPhase] = useState<StillPhase>('idle');
  const [stillPct, setStillPct] = useState(0);
  const [stillDone, setStillDone] = useState(0);

  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 录制进度轮询（读播放头位置）
  const startProgressTimer = () => {
    recordTimerRef.current = setInterval(() => {
      const s = usePrevizStore.getState();
      setRecordPct(Math.min(100, Math.round((s.currentTime / s.duration) * 100)));
    }, 200);
  };
  const stopProgressTimer = () => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  };

  // 录制期间监听标签页切换：仅警告不停止
  useEffect(() => {
    if (phase !== 'recording') return;
    const onVisibility = () => {
      if (document.hidden) {
        console.warn('录制期间切换了标签页，可能导致录制丢帧');
        setHiddenWarning(true);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [phase]);

  useEffect(() => stopProgressTimer, []);

  const handleStart = async () => {
    const store = usePrevizStore.getState();
    const targetCamId = camId ?? store.selectedCameraId ?? store.cameras[0]?.id;
    if (!targetCamId) {
      message.warning('请先在上方创建并选择一个相机');
      return;
    }
    if (!pickRecorderMimeType()) {
      message.error('当前浏览器不支持视频录制（MediaRecorder），请使用最新版 Chrome / Edge');
      return;
    }

    const res = RESOLUTION_OPTIONS.find((r) => r.value === resolution) ?? RESOLUTION_OPTIONS[0];

    try {
      // ====== 录制 ======
      setPhase('recording');
      setRecordPct(0);
      setHiddenWarning(false);
      startProgressTimer();
      const blob = await recordPrevizVideo({
        cameraId: targetCamId,
        width: res.width,
        height: res.height,
      });
      stopProgressTimer();

      // ====== 上传（后端 ffmpeg 会把 webm 转 mp4）======
      setPhase('uploading');
      setUploadPct(0);
      setUploadPhase('uploading');
      const file = new File([blob], `previz-${Date.now()}.webm`, { type: 'video/webm' });
      const uploaded = await uploadVideo(
        file,
        (pct, ph) => {
          setUploadPct(pct);
          if (ph) setUploadPhase(ph);
        },
        projectId
      );
      const url = uploaded.url;

      // ====== 写回画布 ======
      const canvasStore = useCanvasStore.getState();
      // 1. previz 节点记录白片 URL（节点上显示视频缩略），同时把最新场景一并写入
      canvasStore.updateNodeData(nodeId, {
        videoUrl: url,
        scene: usePrevizStore.getState().toJSON(),
      } as Partial<PrevizNodeData>);

      // 2. 在 previz 节点右侧生成视频节点（previz 宽 480，偏移 560 留出间距）
      const previzNode = canvasStore.nodes.find((n) => n.id === nodeId);
      const { duration, fps: sceneFps } = usePrevizStore.getState();
      const videoNode = createNode(
        'video',
        {
          x: (previzNode?.position.x ?? 0) + 560,
          y: previzNode?.position.y ?? 0,
        },
        {
          data: {
            label: '白模预演',
            prompt: '',
            videoUrl: url,
            duration: Math.round(duration),
            fps: sceneFps,
            resolution: '720p',
            aspectRatio: '16:9',
          },
        }
      );
      canvasStore.addNode(videoNode);

      // 3. 持久化整张画布
      await canvasApi.saveCanvas(projectId, useCanvasStore.getState().exportCanvas());
      useCanvasStore.getState().setDirty(false);
      message.success('白片已生成并保存到画布');
    } catch (err) {
      console.error('录制/导出白片失败:', err);
      message.error(err instanceof Error ? err.message : '导出白片失败');
    } finally {
      stopProgressTimer();
      setPhase('idle');
    }
  };

  // 导出静帧：当前播放头、所选相机视角 → PNG → 上传 → 自动在画布生成图片节点
  const handleExportStill = async () => {
    const store = usePrevizStore.getState();
    const singleId = camId ?? store.selectedCameraId ?? store.cameras[0]?.id;
    const targets = stillAllCams
      ? store.cameras.map((c) => ({ id: c.id, name: c.name }))
      : store.cameras.filter((c) => c.id === singleId).map((c) => ({ id: c.id, name: c.name }));

    if (targets.length === 0) {
      message.warning('请先在上方创建并选择一个相机');
      return;
    }

    const { width, height } = stillPixelSize(stillRatio, stillLongSide);
    const resolutionTag = stillLongSide >= 1920 ? '2K' : '1K';

    try {
      setStillDone(0);
      let firstUrl = '';
      for (let i = 0; i < targets.length; i++) {
        const cam = targets[i];

        // ====== 渲染一帧并编码 PNG（纯前端，不消耗积分）======
        setStillPhase('capturing');
        setStillPct(0);
        const blob = await capturePrevizStill({ cameraId: cam.id, width, height });

        // ====== 上传 ======
        setStillPhase('uploading');
        const file = new File([blob], `previz-still-${Date.now()}-${i}.png`, { type: 'image/png' });
        const uploaded = await uploadImage(file, projectId);
        const url = uploaded.url;
        if (i === 0) firstUrl = url;
        setStillPct(Math.round(((i + 1) / targets.length) * 100));
        setStillDone(i + 1);

        // ====== 在 previz 节点右侧生成图片节点（多机位时纵向排列）======
        const canvasStore = useCanvasStore.getState();
        const previzNode = canvasStore.nodes.find((n) => n.id === nodeId);
        const imageNode = createNode(
          'image',
          {
            x: (previzNode?.position.x ?? 0) + 560,
            y: (previzNode?.position.y ?? 0) + i * 380,
          },
          {
            data: {
              label: `白模预演 · ${cam.name}`,
              prompt: '',
              imageUrl: url,
              resolution: resolutionTag,
              aspectRatio: stillRatio,
            },
          }
        );
        canvasStore.addNode(imageNode);
      }

      // 写回 previz 节点：静帧缩略图（取第一张）+ 最新场景
      useCanvasStore.getState().updateNodeData(nodeId, {
        stillUrl: firstUrl,
        scene: usePrevizStore.getState().toJSON(),
      } as Partial<PrevizNodeData>);

      await canvasApi.saveCanvas(projectId, useCanvasStore.getState().exportCanvas());
      useCanvasStore.getState().setDirty(false);
      message.success(
        targets.length > 1
          ? `已导出 ${targets.length} 张白模静帧并自动生成图片节点`
          : '白模静帧已生成并自动生成图片节点'
      );
    } catch (err) {
      console.error('导出静帧失败:', err);
      message.error(err instanceof Error ? err.message : '导出静帧失败');
    } finally {
      setStillPhase('idle');
      setStillPct(0);
    }
  };

  const cameraOptions = cameras.map((c) => ({ value: c.id, label: c.name }));
  const stillSize = stillPixelSize(stillRatio, stillLongSide);
  const busy = phase !== 'idle' || stillPhase !== 'idle';

  return (
    <>
      <div className="border-t border-gray-200 p-3 flex flex-col gap-2.5 shrink-0">
        <div className="text-xs text-gray-400 font-medium">导出白片</div>

        {/* 相机选择（默认跟相机面板选中项） */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-500 w-14 shrink-0">相机</span>
          <Select
            size="small"
            className="flex-1"
            placeholder="选择录制相机"
            value={camId ?? selectedCameraId ?? cameras[0]?.id}
            options={cameraOptions}
            onChange={(v) => setCamId(v)}
          />
        </div>

        {/* 分辨率 */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-500 w-14 shrink-0">分辨率</span>
          <Select
            size="small"
            className="flex-1"
            value={resolution}
            options={RESOLUTION_OPTIONS.map((r) => ({ value: r.value, label: r.label }))}
            onChange={(v) => setResolution(v)}
          />
        </div>

        {/* 帧率（写入 scene.fps，随场景保存） */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-500 w-14 shrink-0">帧率</span>
          <Select
            size="small"
            className="flex-1"
            value={fps}
            options={[
              { value: 24, label: '24 fps' },
              { value: 30, label: '30 fps' },
            ]}
            onChange={(v) => setFps(v)}
          />
        </div>

        <button
          className={`w-full flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer ${
            busy
              ? 'bg-gray-100 text-gray-400 cursor-wait'
              : 'text-white bg-red-500 hover:bg-red-600'
          }`}
          disabled={busy}
          onClick={handleStart}
        >
          <VideoCameraOutlined />
          {phase === 'recording' ? '录制中...' : phase === 'uploading' ? '上传中...' : '开始录制'}
        </button>
        <div className="text-[10px] text-gray-300 leading-relaxed">
          录制将以所选相机视角从头播放整段场景，完成后自动上传并在画布生成视频节点
        </div>

        {/* ===== 白模静帧：锁构图的参考图 ===== */}
        <div className="mt-1 pt-2.5 border-t border-dashed border-gray-200 flex flex-col gap-2.5">
          <div className="text-xs text-gray-400 font-medium">导出白模静帧（锁构图参考）</div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-gray-500 w-14 shrink-0">相机</span>
            <Select
              size="small"
              className="flex-1"
              placeholder="选择相机"
              value={camId ?? selectedCameraId ?? cameras[0]?.id}
              options={cameraOptions}
              onChange={(v) => setCamId(v)}
              disabled={stillAllCams}
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-gray-500 w-14 shrink-0">比例</span>
            <Select
              size="small"
              className="flex-1"
              value={stillRatio}
              options={STILL_RATIOS.map((r) => ({ value: r.value, label: r.label }))}
              onChange={(v) => setStillRatio(v)}
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-gray-500 w-14 shrink-0">尺寸</span>
            <Select
              size="small"
              className="flex-1"
              value={stillLongSide}
              options={STILL_LONG_SIDES.map((s) => ({ value: s.value, label: s.label }))}
              onChange={(v) => setStillLongSide(v)}
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[11px] text-gray-500">每个机位各出一张</span>
            <Switch
              size="small"
              checked={stillAllCams}
              onChange={setStillAllCams}
              disabled={cameras.length < 2}
            />
          </div>

          <button
            className={`w-full flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer ${
              busy
                ? 'bg-gray-100 text-gray-400 cursor-wait'
                : 'text-white bg-blue-500 hover:bg-blue-600'
            }`}
            disabled={busy}
            onClick={handleExportStill}
          >
            <PictureOutlined />
            {stillPhase === 'capturing'
              ? '渲染中...'
              : stillPhase === 'uploading'
                ? `上传中 ${stillPct}%`
                : '导出静帧'}
          </button>
          <div className="text-[10px] text-gray-300 leading-relaxed">
            取所选相机在<b>当前播放头</b>时刻的画面（{stillSize.width}×{stillSize.height}），完成后自动上传并在画布生成图片节点，
            可直接作为图生图/图生视频的构图参考。<b>不消耗积分。</b>
          </div>
        </div>
      </div>

      {/* 导出遮罩：录制 / 静帧渲染 / 上传期间禁止其他操作 */}
      {busy && (
        <div className="fixed inset-0 z-[1000] bg-black/60 flex flex-col items-center justify-center gap-3">
          {stillPhase === 'capturing' ? (
            <>
              <div className="text-white text-sm font-medium">渲染静帧中…</div>
              <div className="text-white/70 text-xs">正在按所选相机机位渲染画面</div>
            </>
          ) : stillPhase === 'uploading' ? (
            <>
              <div className="text-white text-sm font-medium">静帧上传中...</div>
              <div className="w-56 h-1.5 bg-white/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-200"
                  style={{ width: `${stillPct}%` }}
                />
              </div>
              <div className="text-white/70 text-xs font-mono">
                {stillDone}/{stillAllCams ? cameras.length : 1} 张
              </div>
            </>
          ) : phase === 'recording' ? (
            <>
              <div className="text-white text-sm font-medium">录制中… 请勿切换标签页</div>
              <div className="w-56 h-1.5 bg-white/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-red-500 rounded-full transition-all duration-200"
                  style={{ width: `${recordPct}%` }}
                />
              </div>
              <div className="text-white/70 text-xs font-mono">{recordPct}%</div>
              {hiddenWarning && (
                <div className="text-orange-300 text-xs">
                  检测到标签页切换，可能导致录制丢帧
                </div>
              )}
            </>
          ) : (
            <>
              <div className="text-white text-sm font-medium">
                {uploadPhase === 'processing' ? '转码中...' : '上传中...'}
              </div>
              <div className="w-56 h-1.5 bg-white/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-200"
                  style={{ width: `${uploadPct}%` }}
                />
              </div>
              <div className="text-white/70 text-xs font-mono">{uploadPct}%</div>
            </>
          )}
        </div>
      )}
    </>
  );
}
