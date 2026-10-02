// 白片录制 + 静帧导出
// 视频流程：切相机视角 → 播放头归零正常播放 → 录到 scene.duration 停止 → 恢复自由视角
// 静帧流程：取所选相机在当前播放头的机位 → 离屏尺寸渲染一帧 → 直接读像素编码 PNG → 全部还原
import * as THREE from 'three';
import { usePrevizStore } from './previzStore';
import { sampleCameraPose } from './cameraRig';

// 视口渲染器/相机/场景引用（Viewport3D 的 Canvas onCreated 时登记）
let glRef: THREE.WebGLRenderer | null = null;
let cameraRef: THREE.PerspectiveCamera | null = null;
let sceneRef: THREE.Scene | null = null;

export function registerPrevizViewport(
  gl: THREE.WebGLRenderer | null,
  camera: THREE.PerspectiveCamera | null,
  scene: THREE.Scene | null = null
) {
  glRef = gl;
  cameraRef = camera;
  sceneRef = scene;
}

/**
 * 编辑器专用辅助物的统一标记名。
 * 导出白片/静帧时必须隐藏，否则网格线、走位路径会拍进产物里。
 * 新增辅助物时给它挂上这个 name 即自动纳入隐藏范围。
 */
export const EDITOR_HELPER_NAME = '__editor_helper__';

/** 隐藏所有编辑器辅助物，返回还原函数（务必在 finally 里调用） */
function hideEditorHelpers(scene: THREE.Scene): () => void {
  const hidden: THREE.Object3D[] = [];
  scene.traverse((obj) => {
    if (obj.name === EDITOR_HELPER_NAME && obj.visible) {
      obj.visible = false;
      hidden.push(obj);
    }
  });
  return () => {
    hidden.forEach((obj) => {
      obj.visible = true;
    });
  };
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
  const scene = sceneRef;
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

  // 白片要干净：录之前藏掉网格与走位路径等编辑器辅助物
  const restoreHelpers = scene ? hideEditorHelpers(scene) : () => {};

  try {
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

    if (blob.size === 0) throw new Error('录制结果为空，请重试');
    return blob;
  } finally {
    restoreHelpers();
    // 恢复自由视角与渲染尺寸
    usePrevizStore.getState().setPreviewCamera(null);
    gl.setSize(prevSize.x, prevSize.y, false);
    camera.aspect = prevAspect;
    camera.updateProjectionMatrix();
  }
}

export interface StillOptions {
  cameraId: string;
  width: number;
  height: number;
}

/**
 * 导出静帧：把所选相机在「当前播放头时刻」看到的画面渲染成 PNG。
 *
 * 与录制的两点区别：
 * 1. 不动 store（不切 previewCamera），直接按 sampleCameraPose 摆好主相机拍完即还原 ——
 *    避免"导出动作"改变用户正在看的东西；
 * 2. 同步渲染一帧后立刻读像素，因此不依赖 preserveDrawingBuffer。
 */
export async function capturePrevizStill(opts: StillOptions): Promise<Blob> {
  const gl = glRef;
  const camera = cameraRef;
  const scene = sceneRef;
  if (!gl || !camera || !scene) throw new Error('3D 视口尚未就绪');

  const store = usePrevizStore.getState();
  const cam = store.cameras.find((c) => c.id === opts.cameraId);
  if (!cam) throw new Error('找不到该相机，请先创建相机');

  // 备份渲染器与相机的全部临时改动
  const prevSize = new THREE.Vector2();
  gl.getSize(prevSize);
  const prevAspect = camera.aspect;
  const prevFov = camera.fov;
  const prevPos = camera.position.clone();
  const prevQuat = camera.quaternion.clone();
  const prevRenderTarget = gl.getRenderTarget();
  const restoreHelpers = hideEditorHelpers(scene);

  try {
    // 用与预览完全相同的机位采样，保证"白模图 = 该镜头此刻的画面"
    const pose = sampleCameraPose(cam, store.currentTime, store.characters);

    gl.setSize(opts.width, opts.height, false);
    camera.aspect = opts.width / opts.height;
    camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
    camera.lookAt(pose.lookAt[0], pose.lookAt[1], pose.lookAt[2]);
    camera.fov = pose.fov;
    camera.updateProjectionMatrix();

    gl.setRenderTarget(null);
    // 同一 tick 内渲染 + 读像素（drawing buffer 尚未被合成器清空）
    gl.render(scene, camera);

    const blob = await new Promise<Blob | null>((resolve) => {
      gl.domElement.toBlob((b) => resolve(b), 'image/png');
    });
    if (!blob || blob.size === 0) throw new Error('静帧编码失败，请重试');
    return blob;
  } finally {
    restoreHelpers();
    gl.setSize(prevSize.x, prevSize.y, false);
    gl.setRenderTarget(prevRenderTarget);
    camera.aspect = prevAspect;
    camera.fov = prevFov;
    camera.position.copy(prevPos);
    camera.quaternion.copy(prevQuat);
    camera.updateProjectionMatrix();
  }
}