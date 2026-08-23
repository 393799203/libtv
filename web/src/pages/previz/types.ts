// 白模预演（previz）场景 JSON 类型定义
// 场景整体序列化为 JSON 字符串，持久化在 previz 节点 data.scene 字段中，随画布保存

// 场景元素类型（共 35 种，按分类组织）
// 基础几何为单几何体，其余为组合式白模组件（内部比例写死、外包围盒约 1m，scale 表达实际米数）
export type PrevizObjectType =
  // 基础几何
  | 'box'
  | 'cylinder'
  | 'sphere'
  | 'plane'
  | 'wall'
  // 建筑结构
  | 'stairs' // 楼梯
  | 'house' // 房子
  | 'fence' // 栅栏/围栏
  | 'ramp' // 斜坡
  | 'platform' // 平台/高台
  | 'door' // 门
  | 'window' // 窗
  | 'arch' // 拱门
  | 'railing' // 栏杆
  // 街道设施
  | 'road' // 路面/街道
  | 'streetlamp' // 路灯
  | 'bench' // 长椅
  | 'signboard' // 招牌
  | 'sidewalk' // 人行道
  | 'utilitypole' // 电线杆
  // 家具
  | 'table' // 桌子
  | 'chair' // 椅子
  | 'sofa' // 沙发
  | 'bed' // 床
  | 'cabinet' // 柜子
  | 'screen' // 屏幕/电视
  // 载具
  | 'car' // 车辆
  | 'truck' // 卡车
  | 'motorcycle' // 摩托
  | 'bicycle' // 自行车
  // 自然
  | 'tree' // 树
  | 'rock' // 岩石
  | 'bush' // 灌木
  | 'water' // 水面
  | 'hill'; // 土坡/山丘

// 元素分类（添加面板分组、AI 词汇表共用）
export interface PrevizObjectCategory {
  key: string;
  label: string;
  types: PrevizObjectType[];
}

export const OBJECT_CATEGORIES: PrevizObjectCategory[] = [
  { key: 'basic', label: '基础几何', types: ['box', 'cylinder', 'sphere', 'plane', 'wall'] },
  {
    key: 'structure',
    label: '建筑结构',
    types: ['stairs', 'house', 'fence', 'ramp', 'platform', 'door', 'window', 'arch', 'railing'],
  },
  {
    key: 'street',
    label: '街道设施',
    types: ['road', 'streetlamp', 'bench', 'signboard', 'sidewalk', 'utilitypole'],
  },
  { key: 'furniture', label: '家具', types: ['table', 'chair', 'sofa', 'bed', 'cabinet', 'screen'] },
  { key: 'vehicle', label: '载具', types: ['car', 'truck', 'motorcycle', 'bicycle'] },
  { key: 'nature', label: '自然', types: ['tree', 'rock', 'bush', 'water', 'hill'] },
];

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
// 人偶模型类型：male=Soldier 男体；female=Xbot 女体（仅移动/表演类常规动作）
export type PrevizModelKind = 'male' | 'female';

export interface PrevizCharacter {
  id: string;
  name: string;
  model?: PrevizModelKind; // 人偶模型（未设置或已下架的模型回退男体，兼容旧场景）
  position: Vec3;   // 出生/基准位置（无走位路径时的站位；有路径时路径优先）
  rotationY: number; // 朝向（绕 Y 轴，弧度）
  // 手动锁定朝向：用户用 gizmo 旋转过后为 true，行走时不再自动朝向前进方向
  manualFacing?: boolean;
  color?: string;      // 人偶染色（十六进制，白片中区分角色用；未设置用默认灰）
  assetName?: string;  // 绑定的剧本角色名（生成身份映射提示词用）
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
