import { useEffect, useRef, useState } from 'react';
import { Select, App } from 'antd';
import { VideoCameraOutlined } from '@ant-design/icons';
import { usePrevizStore } from './previzStore';
import { pickRecorderMimeType, recordPrevizVideo } from './recorder';
import { uploadVideo } from '@/services/uploadApi';
import { useCanvasStore } from '@/stores/canvasStore';
import { canvasApi } from '@/services/canvasApi';
import { createNode } from '@/utils/nodeFactory';
import type { PrevizNodeData } from '@/types/canvas';

// 导出分辨率选项
const RESOLUTION_OPTIONS = [
  { value: '720p', label: '720p (1280×720)', width: 1280, height: 720 },
  { value: '1080p', label: '1080p (1920×1080)', width: 1920, height: 1080 },
] as const;

type ExportPhase = 'idle' | 'recording' | 'uploading';

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

      // 2. 在 previz 节点右侧 400px 生成视频节点
      const previzNode = canvasStore.nodes.find((n) => n.id === nodeId);
      const { duration, fps: sceneFps } = usePrevizStore.getState();
      const videoNode = createNode(
        'video',
        {
          x: (previzNode?.position.x ?? 0) + 400,
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

  const cameraOptions = cameras.map((c) => ({ value: c.id, label: c.name }));

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
            phase !== 'idle'
              ? 'bg-gray-100 text-gray-400 cursor-wait'
              : 'text-white bg-red-500 hover:bg-red-600'
          }`}
          disabled={phase !== 'idle'}
          onClick={handleStart}
        >
          <VideoCameraOutlined />
          {phase === 'recording' ? '录制中...' : phase === 'uploading' ? '上传中...' : '开始录制'}
        </button>
        <div className="text-[10px] text-gray-300 leading-relaxed">
          录制将以所选相机视角从头播放整段场景，完成后自动上传并在画布生成视频节点
        </div>
      </div>

      {/* 录制/上传遮罩：禁止其他操作 */}
      {phase !== 'idle' && (
        <div className="fixed inset-0 z-[1000] bg-black/60 flex flex-col items-center justify-center gap-3">
          {phase === 'recording' ? (
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
