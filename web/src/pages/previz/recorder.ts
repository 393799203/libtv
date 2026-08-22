// 白片录制：实时录制方案（captureStream + MediaRecorder）
// 流程：切相机视角 → 播放头归零正常播放 → 录到 scene.duration 停止 → 恢复自由视角
import * as THREE from 'three';
import { usePrevizStore } from './previzStore';

// 视口渲染器/相机引用（Viewport3D 的 Canvas onCreated 时登记）
let glRef: THREE.WebGLRenderer | null = null;
let cameraRef: THREE.PerspectiveCamera | null = null;

export function registerPrevizViewport(
  gl: THREE.WebGLRenderer | null,
  camera: THREE.PerspectiveCamera | null
) {
  glRef = gl;
  cameraRef = camera;
}

// 依次尝试可用的 webm 编码；都不支持（老 Safari 无 MediaRecorder）返回 null
export function pickRecorderMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return null;
}

export interface RecordOptions {
  cameraId: string;
  width: number;
  height: number;
}

/**
 * 录制白片：以相机视角从 t=0 播放到 scene.duration，返回 webm Blob
 * 注意：录制期间依赖 TimelineBar 的播放循环驱动播放头，编辑器页面需保持挂载
 */
export async function recordPrevizVideo(opts: RecordOptions): Promise<Blob> {
  const gl = glRef;
  const camera = cameraRef;
  if (!gl || !camera) throw new Error('3D 视口尚未就绪');
  const mime = pickRecorderMimeType();
  if (!mime) {
    throw new Error('当前浏览器不支持视频录制（MediaRecorder），请使用最新版 Chrome / Edge');
  }

  const store = usePrevizStore.getState();
  const fps = store.fps;

  // 备份并调整渲染尺寸（updateStyle=false 保持容器样式不变）与相机宽高比
  const prevSize = new THREE.Vector2();
  gl.getSize(prevSize);
  const prevAspect = camera.aspect;
  gl.setSize(opts.width, opts.height, false);
  camera.aspect = opts.width / opts.height;
  camera.updateProjectionMatrix();

  // 切到相机视角、播放头归零
  store.setPreviewCamera(opts.cameraId);
  store.setCurrentTime(0);

  const stream = gl.domElement.captureStream(fps);
  const recorder = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: 8_000_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
  });

  try {
    recorder.start(250);
    store.setPlaying(true);
    // 等待播放到末尾（TimelineBar 的 rAF 循环到 duration 会自动停止播放）
    await new Promise<void>((resolve) => {
      const check = () => {
        const s = usePrevizStore.getState();
        if (!s.playing || s.currentTime >= s.duration) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      setTimeout(check, 100);
    });
  } finally {
    if (recorder.state !== 'inactive') recorder.stop();
  }
  const blob = await stopped;

  // 恢复自由视角与渲染尺寸
  usePrevizStore.getState().setPreviewCamera(null);
  gl.setSize(prevSize.x, prevSize.y, false);
  camera.aspect = prevAspect;
  camera.updateProjectionMatrix();

  if (blob.size === 0) throw new Error('录制结果为空，请重试');
  return blob;
}
