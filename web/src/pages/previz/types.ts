// 白模预演（previz）场景 JSON 类型定义
// 场景整体序列化为 JSON 字符串，持久化在 previz 节点 data.scene 字段中，随画布保存

// 场景几何体类型
export type PrevizObjectType = 'box' | 'cylinder' | 'sphere' | 'plane' | 'wall';

// 三元组（位置/旋转/缩放）
export type Vec3 = [number, number, number];

// 场景中的一个几何体对象
export interface PrevizObject {
  id: string;
  type: PrevizObjectType;
  name: string;
  position: Vec3;
  rotation: Vec3; // 欧拉角（弧度）
  scale: Vec3;
  color: string;
}

// 走位路径关键帧：t 时刻角色处于 position
export interface PrevizPathPoint {
  t: number; // 时间（秒）
  position: Vec3;
}

// 动作片段：start 时刻开始播放 clip 动画（clip 为 mannequin.glb 内的动画名）
export interface PrevizActionClip {
  clip: string;
  start: number; // 开始时间（秒）
}

// 灰模人偶角色
export interface PrevizCharacter {
  id: string;
  name: string;
  position: Vec3;   // 出生/基准位置（无走位路径时的站位；有路径时路径优先）
  rotationY: number; // 朝向（绕 Y 轴，弧度）
  path: PrevizPathPoint[];     // 走位路径（按 t 升序）
  actions: PrevizActionClip[]; // 动作时间轴（按 start 升序）
}

// 运镜类型（与平台运镜关键词表对应）
export type PrevizCameraMoveType =
  | 'static'      // 固定
  | 'push-in'     // 向前推
  | 'pull-out'    // 向后拉
  | 'pan-left'    // 向左摇
  | 'pan-right'   // 向右摇
  | 'tilt-up'     // 向上摇
  | 'tilt-down'   // 向下摇
  | 'tracking'    // 轨道跟移
  | 'orbit'       // 环绕
  | 'crane'       // 摇臂升降
  | 'gimbal'      // 云台跟拍
  | 'handheld'    // 手持纪实
  | 'dolly-zoom'; // 希区柯克变焦

// 相机运镜参数
export interface PrevizCameraMove {
  type: PrevizCameraMoveType;
  // 机位/朝向起止（orbit/tracking/gimbal 以 target 为圆心/跟随目标）
  startPos: Vec3;
  endPos: Vec3;
  startLook: Vec3;
  endLook: Vec3;
  targetCharacterId?: string; // tracking/orbit/gimbal/crane 跟随的角色
  duration: number; // 运镜时长（秒），<= scene.duration
  start: number;    // 运镜开始时间（秒）
}

// 预演相机
export interface PrevizCamera {
  id: string;
  name: string;
  fov: number; // 视场角（度），默认 50
  move: PrevizCameraMove;
}

// 完整场景结构
export interface PrevizScene {
  objects: PrevizObject[];
  characters: PrevizCharacter[];
  cameras: PrevizCamera[];
  duration: number; // 场景时长（秒）
  fps: number;      // 帧率（P3 时间轴用）
}

// 创建空场景
export function createEmptyScene(): PrevizScene {
  return {
    objects: [],
    characters: [],
    cameras: [],
    duration: 10,
    fps: 24,
  };
}
