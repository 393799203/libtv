import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Button, Modal, Slider, Spin, Tooltip } from 'antd';
import {
  CameraOutlined,
  CaretRightOutlined,
  CheckCircleFilled,
  PauseOutlined,
  StepBackwardOutlined,
  StepForwardOutlined,
} from '@ant-design/icons';
import { useCanvasStore } from '@/stores/canvasStore';
import { imageOpsApi } from '@/services/imageOpsApi';
import { commitDerivedNodes, createVideoFrameNode } from '@/utils/imageOpsNodes';
import { message } from '@/utils/antdApp';
import { Z } from '@/utils/zLayers';
import {
  buildFrameRequest,
  clampTime,
  formatTimecode,
  fpsFromFrameTimes,
  frameIndex,
  safeFps,
  stepTime,
  type FrameMode,
} from '@/utils/frameCapture';
import { OPS } from './imageops/tokens';

interface FrameCaptureModalProps {
  /** 要截帧的视频节点 id（视频地址/标签/fps 都从画布 store 现读，不存快照） */
  nodeId: string;
  onClose: () => void;
}

/** 本次弹窗里已截到画布的画面（只用于回显，不放 store —— 关掉弹窗就该忘掉） */
interface Shot {
  id: string;
  label: string;
  url: string;
  thumb: string;
  mode: FrameMode;
  time: number;
}

/** 后端报错文案本来就是给人看的，这里只补两类它说不清的情况 */
function frameErrorMessage(err: unknown): string {
  const raw = err instanceof Error && err.message ? err.message : '';
  if (!raw) return '取帧失败，请稍后重试';
  if (/timeout|超时|ECONNABORTED/i.test(raw)) {
    return '取帧超时：视频较大或源站较慢，等一会儿再试（源文件会缓存，第二次通常几秒就好）';
  }
  if (/Network Error|Failed to fetch|network|断网/i.test(raw)) {
    return '网络断了，没连上服务端：这次没有取到画面，画布也没有改动';
  }
  return raw;
}

const MODE_TEXT: Record<FrameMode, string> = { first: '首帧', last: '尾帧', at: '当前帧' };

/**
 * 「截取画面」弹窗：在一个大画面里把三种截法都做完。
 *
 * 为什么不再用工具条上的三选一下拉：
 *  1. "截取当前帧"依赖节点里那个小播放器的锚点（`data-video-playhead`），播放器没打开就只能
 *     拒绝并提示 —— 大画面里自带播放器 + 进度条，任何时候都能截；
 *  2. 想精确到某一帧得反复"播放→暂停→再截"，弹窗里可以直接拖进度条、逐帧微调、看时间码。
 *
 * 几个刻意的取舍：
 *  - **播放进度只活在这个组件的局部 state 里**，不进 store：`timeupdate` 每秒触发多次，
 *    写 store 会让整条工具条和所有订阅者跟着重渲染。
 *  - 时长/fps **不回写节点**：它们是"看这一条视频"的临时读数，节点数据里的 duration/fps
 *    是素材元信息，不该因为打开过一次弹窗就被改写（真要写也该走 updateNodeMeta）。
 *  - 截帧成功后**直接落画布**（不搞"预览→再确认"）：用户往往要连着截首帧/中间/尾帧，
 *    每张都确认一次太啰嗦；新节点会自动选中、放在源节点右侧，不满意删掉即可。
 *    弹窗里保留一条本次截取的缩略图回显，确认到底截到了什么。
 *  - 关闭弹窗**不碰画布**：只有服务端真的返回了图片才建节点，失败一律不留空节点。
 */
export const FrameCaptureModal = memo(function FrameCaptureModal({
  nodeId,
  onClose,
}: FrameCaptureModalProps) {
  // 只订阅 nodes 数组本身（用 find 派生对象会让 zustand 每次返回新引用，触发无限重渲染）
  const nodes = useCanvasStore((s) => s.nodes);
  const node = nodes.find((n) => n.id === nodeId);
  const data = node?.data as
    | { videoUrl?: string; label?: string; fps?: number; duration?: number }
    | undefined;
  const videoUrl = data?.videoUrl;
  /** 节点设置里的帧率：只在**量不出真实帧率**时兜底用（实测过它可能是错的，见 fpsFromFrameTimes） */
  const nodeFps = safeFps(data?.fps);
  /** 元数据还没读到时先用节点里记的时长兜底（进度条至少能用） */
  const fallbackDuration = typeof data?.duration === 'number' && data.duration > 0 ? data.duration : 0;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  // duration/current 同时留一份 ref：键盘回调与取帧回调都要读到最新值，
  // 靠 state 会让 useCallback 依赖不停变化（每次 timeupdate 重建回调）
  const durationRef = useRef(fallbackDuration);
  const currentRef = useRef(0);
  const busyRef = useRef(false);

  const [duration, setDuration] = useState(fallbackDuration);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState<FrameMode | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [loadError, setLoadError] = useState(false);
  /** 浏览器实测出来的真实帧率；null = 还没量出来（用节点设置兜底并在界面标明） */
  const [measuredFps, setMeasuredFps] = useState<number | null>(null);
  /** 逐帧步进用的是这个：实测优先 */
  const fps = measuredFps ?? nodeFps;

  // 换节点时把这次的读数清干净（同一个弹窗连续给两个节点截帧也不会串）
  useEffect(() => {
    durationRef.current = fallbackDuration;
    currentRef.current = 0;
    busyRef.current = false;
    setDuration(fallbackDuration);
    setCurrent(0);
    setPlaying(false);
    setBusy(null);
    setShots([]);
    setLoadError(false);
    setMeasuredFps(null);
  }, [nodeId, fallbackDuration]);

  const seekTo = useCallback((seconds: number) => {
    const next = clampTime(seconds, durationRef.current);
    currentRef.current = next;
    setCurrent(next);
    const el = videoRef.current;
    if (el) {
      try {
        el.currentTime = next;
      } catch {
        /* 元数据还没到，等 loadedmetadata 之后自然同步 */
      }
    }
  }, []);

  const applyDuration = useCallback((seconds: number) => {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    durationRef.current = seconds;
    setDuration(seconds);
  }, []);

  /**
   * 量这条文件的**真实帧率**：用一只**画面外的临时 video 元素**连续 seek 一小段，
   * 拿 requestVideoFrameCallback 报出的帧时间戳，从相邻间隔推出帧网格。
   *
   * 为什么必须另开元素：上一版直接在用户看的这个播放器上 seek，量完播放头停在 0.28s
   * （而且 onTimeUpdate 的竞态还会把复位冲掉）—— 用户一打开弹窗就"莫名停在半秒处"，
   * 接着点「截取当前帧」截到的也不是他以为的第一帧。
   *
   * 为什么不直接信节点数据里的 fps：那条 30 秒片节点写着 24fps，文件实际是 30fps；
   * 按 24 步进，"±1 帧"实际跳 41.7ms 却标着 24fps —— 等于骗用户。
   * 量不出来（Firefox 没有 rvfc / 源站不给 Range 没法 seek）就退回节点设置，
   * 并在界面上**标明是估算**，不装作精确。
   */
  const detectFps = useCallback(async (url: string) => {
    const el = document.createElement('video') as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
      cancelVideoFrameCallback?: (handle: number) => void;
    };
    if (typeof el.requestVideoFrameCallback !== 'function') return;
    // offscreen 而不是 display:none：隐藏的媒体元素可能不再往帧管线送帧，rvfc 就不回调了
    el.muted = true;
    el.preload = 'auto';
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = 'position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
    document.body.appendChild(el);
    const cleanup = () => {
      el.removeAttribute('src');
      try { el.load(); } catch { /* 元素已分离，忽略 */ }
      el.remove();
    };
    try {
      el.src = url;
      const ready = await new Promise<boolean>((resolve) => {
        const timer = window.setTimeout(() => resolve(false), 6000);
        el.onloadedmetadata = () => { window.clearTimeout(timer); resolve(true); };
        el.onerror = () => { window.clearTimeout(timer); resolve(false); };
      });
      if (!ready || !el.videoWidth) return;
      const total = Number.isFinite(el.duration) ? el.duration : 0;
      const times: number[] = [];
      for (const offset of [0, 0.04, 0.08, 0.12, 0.16, 0.2, 0.24, 0.28]) {
        const target = clampTime(offset, Math.max(0, total - 0.03));
        const mediaTime = await new Promise<number | null>((resolve) => {
          let handle = 0;
          const timer = window.setTimeout(() => {
            if (handle) el.cancelVideoFrameCallback?.(handle);
            resolve(null);
          }, 700);
          handle = el.requestVideoFrameCallback!((_now, meta) => {
            window.clearTimeout(timer);
            resolve(meta.mediaTime);
          });
          try {
            el.currentTime = target;
          } catch {
            window.clearTimeout(timer);
            resolve(null);
          }
        });
        if (mediaTime !== null) times.push(mediaTime);
      }
      const detected = fpsFromFrameTimes(times);
      if (detected) setMeasuredFps(detected);
    } finally {
      cleanup();
    }
  }, []);

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setPlaying(false));
    else el.pause();
  }, []);

  /** 一次取帧：请求 → 建节点 → 选中 → 回显。任何一步失败都不建节点 */
  const capture = useCallback(
    async (mode: FrameMode) => {
      if (busyRef.current) return;
      const url = videoUrl;
      if (!url) {
        message.warning('这个节点还没有视频（没有可截的画面），先等生成完成');
        return;
      }
      const req = buildFrameRequest(mode, currentRef.current, durationRef.current);
      busyRef.current = true;
      setBusy(mode);
      try {
        const res = await imageOpsApi.videoFrame({
          videoUrl: url,
          mode: req.mode,
          time: req.time,
          projectId: useCanvasStore.getState().projectId || undefined,
        });
        const tile = res?.tile;
        if (!tile?.url) {
          message.error('取帧失败：服务端没有返回图片，这次没有建节点');
          return;
        }
        // 取帧期间用户可能已经删了这个节点
        const fresh = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
        if (!fresh) {
          message.error('源节点已经被删掉了，这次截到的画面没有地方放');
          return;
        }
        const created = createVideoFrameNode(fresh, tile, mode, { time: req.time });
        commitDerivedNodes([created], []);
        // 设为唯一选中：新图片节点的工具条/提示词面板立刻可用，可以直接接着图生视频
        const now = useCanvasStore.getState();
        now.onNodesChange([
          ...now.selectedNodeIds
            .filter((sid) => sid !== created.id)
            .map((sid) => ({ type: 'select' as const, id: sid, selected: false })),
          { type: 'select' as const, id: created.id, selected: true },
        ]);
        setShots((prev) => [
          ...prev,
          {
            id: created.id,
            label: created.data.label || '画面',
            url: tile.url,
            thumb: tile.thumb_url || tile.url,
            mode,
            time: req.time,
          },
        ]);
        const what =
          mode === 'at' ? `当前帧（${formatTimecode(req.time)}）` : MODE_TEXT[mode];
        message.success(`已截取${what}，画面已作为图片节点放在源节点右侧`);
      } catch (err) {
        message.error(frameErrorMessage(err));
      } finally {
        busyRef.current = false;
        setBusy(null);
      }
    },
    [nodeId, videoUrl],
  );

  // 键盘：← / → 逐帧，Shift 逐秒，空格播放/暂停。只在弹窗打开时挂（组件本身是条件渲染）
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        seekTo(
          stepTime(
            currentRef.current,
            event.key === 'ArrowRight' ? 1 : -1,
            fps,
            event.shiftKey,
            durationRef.current,
          ),
        );
        return;
      }
      if (event.key === ' ' || event.code === 'Space') {
        event.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fps, seekTo, togglePlay]);

  if (!node || !videoUrl) return null;

  const title = `截取画面 · ${data?.label || '视频'}`;
  const grade = OPS.accent;
  const primaryStyle = {
    background: grade,
    borderColor: grade,
    color: OPS.accentText,
    fontWeight: 600,
  } as const;

  return (
    <Modal
      open
      title={title}
      onCancel={onClose}
      footer={null}
      centered
      // 与 antd 弹层同层（modalInline）：Slider 的 tooltip、message 都在弹层之上，
      // 用 overlay(1200) 反而会把进度条的 tooltip 压在弹窗下面
      zIndex={Z.modalInline}
      width="min(1180px, 96vw)"
      styles={{
        body: { padding: 16 },
        mask: { background: 'rgba(0, 0, 0, 0.72)' },
      }}
    >
      <div className="flex flex-col gap-3">
        {/* 大画面：等比例放到最大，黑底（视频本身的黑边不该被弹窗底色顶掉） */}
        <div
          className="relative flex items-center justify-center overflow-hidden rounded-lg"
          style={{ background: '#000', border: `1px solid ${OPS.surfaceBorder}`, height: 'min(56vh, 600px)' }}
        >
          <video
            ref={videoRef}
            src={videoUrl}
            preload="auto"
            playsInline
            // 自己的播放/暂停按钮 + 点画面也能切换，所以不用原生控件（原生控件会盖住画面底部）
            onClick={togglePlay}
            onLoadedMetadata={(e) => {
              setLoadError(false);
              applyDuration(e.currentTarget.duration);
              seekTo(currentRef.current);
              // 元数据到了就能 seek，顺手把真实帧率量出来（另开元素，不动用户这份播放器）
              void detectFps(e.currentTarget.currentSrc || videoUrl || '');
            }}
            onTimeUpdate={(e) => {
              currentRef.current = e.currentTarget.currentTime;
              setCurrent(e.currentTarget.currentTime);
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onError={() => setLoadError(true)}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              display: 'block',
              cursor: 'pointer',
            }}
          />

          {loadError && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[13px]"
              style={{ color: OPS.muted }}
            >
              <span>这条视频没加载出来（源站可能拒绝了浏览器直连）</span>
              <span style={{ color: OPS.faint }}>首帧/尾帧仍然可以截：取帧是在服务端本机做的</span>
            </div>
          )}

          {busy && (
            <div
              className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2"
              style={{ background: 'rgba(0, 0, 0, 0.55)' }}
            >
              <Spin />
              <span className="text-[13px]" style={{ color: OPS.ink }}>
                正在取帧：{MODE_TEXT[busy]}…
              </span>
            </div>
          )}
        </div>

        {/* 进度条 + 时间码 + 帧号 */}
        <div className="flex items-center gap-3">
          <Button
            shape="circle"
            icon={playing ? <PauseOutlined /> : <CaretRightOutlined />}
            onClick={togglePlay}
            aria-label={playing ? '暂停' : '播放'}
          />
          <Slider
            className="flex-1"
            min={0}
            max={duration > 0 ? duration : 1}
            step={1 / fps}
            value={current}
            onChange={(v) => seekTo(Number(v))}
            // 关掉 Slider 自己的键盘处理：← / → 由上面的 window 监听统一处理，
            // 否则焦点在进度条上按一次会走两格（Slider 一格 + 全局一格）
            keyboard={false}
            tooltip={{ formatter: (v) => formatTimecode(Number(v)) }}
          />
          <div className="flex shrink-0 items-baseline gap-2 font-mono text-[13px]">
            <span style={{ color: OPS.ink }}>{formatTimecode(current)}</span>
            <span style={{ color: OPS.faint }}>/ {formatTimecode(duration)}</span>
          </div>
          <div className="shrink-0 text-[12px]" style={{ color: OPS.muted }}>
            第 {frameIndex(current, fps) + 1} 帧 ·{' '}
            {measuredFps ? `${measuredFps}fps（实测）` : `按节点设置 ${nodeFps}fps 估算`}
          </div>
        </div>

        {/* 微调：按秒补齐"至少逐秒"，逐帧给到帧网格 */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="small"
            icon={<StepBackwardOutlined />}
            onClick={() => seekTo(stepTime(current, -1, fps, true, duration))}
          >
            1 秒
          </Button>
          <Tooltip title="上一帧（←）">
            <Button size="small" onClick={() => seekTo(stepTime(current, -1, fps, false, duration))}>
              −1 帧
            </Button>
          </Tooltip>
          <Tooltip title="下一帧（→）">
            <Button size="small" onClick={() => seekTo(stepTime(current, 1, fps, false, duration))}>
              +1 帧
            </Button>
          </Tooltip>
          <Button
            size="small"
            icon={<StepForwardOutlined />}
            onClick={() => seekTo(stepTime(current, 1, fps, true, duration))}
          >
            1 秒
          </Button>
          <span className="text-[12px]" style={{ color: OPS.faint }}>
            ← / → 逐帧 · Shift + ← / → 逐秒 · 空格 播放/暂停
          </span>
        </div>

        {/* 三个主操作 */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            icon={<CameraOutlined />}
            loading={busy === 'first'}
            disabled={!!busy}
            onClick={() => capture('first')}
          >
            截取首帧
          </Button>
          <Button
            icon={<CameraOutlined />}
            loading={busy === 'last'}
            disabled={!!busy}
            onClick={() => capture('last')}
          >
            截取尾帧
          </Button>
          <Button
            icon={<CameraOutlined />}
            style={primaryStyle}
            loading={busy === 'at'}
            disabled={!!busy}
            onClick={() => capture('at')}
          >
            截取当前帧（{formatTimecode(current)}）
          </Button>
          <span className="text-[12px]" style={{ color: OPS.faint }}>
            本机 ffmpeg 取帧，不扣积分
          </span>
        </div>

        {/* 本次截取回显：连着截多张时能确认每一张到底是什么 */}
        {shots.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-[12px]" style={{ color: OPS.muted }}>
              <CheckCircleFilled style={{ color: OPS.ink }} />
              本次已截 {shots.length} 张，都已放到画布上源节点右侧
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {shots.map((shot) => (
                <div
                  key={shot.id}
                  className="flex w-[132px] shrink-0 flex-col gap-1 rounded-md p-1"
                  style={{ background: OPS.surface, border: `1px solid ${OPS.surfaceBorder}` }}
                >
                  <img
                    src={shot.thumb}
                    alt={shot.label}
                    className="h-[74px] w-full rounded object-cover"
                  />
                  <span className="truncate text-[11px]" style={{ color: OPS.ink }} title={shot.label}>
                    {shot.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
});