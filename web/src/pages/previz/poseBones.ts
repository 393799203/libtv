// 姿态编辑：主要骨骼匹配 + 姿势快照存取
// 两个人偶模型（male Soldier / female Xbot）都是 Mixamo 骨架，骨骼名形如 mixamorig:Hips，
// 命名一致但前缀可能有差异，统一用包含匹配（不做全等）

import type * as THREE from 'three';

// 参与姿态编辑的 20 个主要骨骼（按名字片段匹配）
export const POSE_BONE_SEGMENTS = [
  'Hips',
  'Spine',
  'Spine1',
  'Spine2',
  'Neck',
  'Head',
  'LeftShoulder',
  'LeftArm',
  'LeftForeArm',
  'LeftHand',
  'RightShoulder',
  'RightArm',
  'RightForeArm',
  'RightHand',
  'LeftUpLeg',
  'LeftLeg',
  'LeftFoot',
  'RightUpLeg',
  'RightLeg',
  'RightFoot',
];

// 排除：手指（LeftHandThumb1 等会误命中 LeftHand）与 IK/控制器辅助骨
const EXCLUDE_FRAGMENTS = [
  'thumb',
  'index',
  'middle',
  'ring',
  'pinky',
  'handslot',
  'ik-',
  'ik_',
  'control-',
  'control_',
];

/**
 * 判断骨骼是否为姿态编辑的主要骨骼，返回规范片段名（如 mixamorig:Spine1 → Spine1）
 * 取最长命中片段，避免 Spine 吃掉 Spine1/Spine2；不匹配返回 null
 */
export function matchPoseBone(boneName: string): string | null {
  const lower = boneName.toLowerCase();
  if (EXCLUDE_FRAGMENTS.some((f) => lower.includes(f))) return null;
  let best: string | null = null;
  for (const seg of POSE_BONE_SEGMENTS) {
    if (lower.includes(seg.toLowerCase()) && (!best || seg.length > best.length)) {
      best = seg;
    }
  }
  return best;
}

// 姿势快照数据：骨骼片段 → 局部四元数
export type PoseSnapshot = Record<string, [number, number, number, number]>;

// 骨骼片段中文名（面板展示用）
export const POSE_BONE_LABELS: Record<string, string> = {
  Hips: '髋部',
  Spine: '下脊柱',
  Spine1: '中脊柱',
  Spine2: '上脊柱',
  Neck: '颈部',
  Head: '头部',
  LeftShoulder: '左肩',
  LeftArm: '左大臂',
  LeftForeArm: '左小臂',
  LeftHand: '左手',
  RightShoulder: '右肩',
  RightArm: '右大臂',
  RightForeArm: '右小臂',
  RightHand: '右手',
  LeftUpLeg: '左大腿',
  LeftLeg: '左小腿',
  LeftFoot: '左脚',
  RightUpLeg: '右大腿',
  RightLeg: '右小腿',
  RightFoot: '右脚',
};

// 骨骼对象注册表：面板旋转滑杆经此直接读写骨骼（CharacterView 挂载时注册）
const poseBoneObjects = new Map<string, PoseBoneMap>();

export function registerPoseBoneObjects(charId: string, map: PoseBoneMap) {
  poseBoneObjects.set(charId, map);
}

export function unregisterPoseBoneObjects(charId: string) {
  poseBoneObjects.delete(charId);
}

export function getPoseBone(charId: string, seg: string): THREE.Object3D | undefined {
  return poseBoneObjects.get(charId)?.get(seg);
}

// 角色 id → 当前姿势快照函数（CharacterView 注册，面板「保存为姿势」时调用）
const poseSnapshotters = new Map<string, () => PoseSnapshot>();

export function registerPoseSnapshotter(charId: string, fn: () => PoseSnapshot) {
  poseSnapshotters.set(charId, fn);
}

export function unregisterPoseSnapshotter(charId: string) {
  poseSnapshotters.delete(charId);
}

// 取角色当前姿势快照；角色未挂载（模型加载失败等）返回 null
export function snapshotPose(charId: string): PoseSnapshot | null {
  return poseSnapshotters.get(charId)?.() ?? null;
}

// three.Object3D 类型助手（供 CharacterView 收集骨骼用）
export type PoseBoneMap = Map<string, THREE.Object3D>;

// 调试钩子：E2E/控制台直接读骨骼对象（验证滑杆写入是否生效）
if (typeof window !== 'undefined') {
  (window as unknown as { __getPoseBone: typeof getPoseBone }).__getPoseBone = getPoseBone;
}
