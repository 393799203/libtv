// 相机运镜：类型中文名 + 姿态采样函数
// 采样输出供视口预览（P3）与导出录制（P4 逐帧驱动相机）共用

import type { PrevizCamera, PrevizCameraMoveType, PrevizCharacter, Vec3 } from './types';
import { sampleCharacterPosition } from './previzStore';

// 运镜类型 → 中文名
export const CAMERA_MOVE_LABELS: Record<PrevizCameraMoveType, string> = {
  static: '固定',
  'push-in': '向前推',
  'pull-out': '向后拉',
  'pan-left': '向左摇',
  'pan-right': '向右摇',
  'tilt-up': '向上摇',
  'tilt-down': '向下摇',
  tracking: '轨道跟移',
  orbit: '环绕',
  crane: '摇臂升降',
  gimbal: '云台跟拍',
  handheld: '手持纪实',
  'dolly-zoom': '希区柯克变焦',
};

// 需要选择跟随角色的运镜类型
export const TARGET_MOVE_TYPES: PrevizCameraMoveType[] = ['tracking', 'orbit', 'gimbal', 'crane'];

// 采样得到的相机姿态
export interface PrevizCameraPose {
  position: Vec3;
  lookAt: Vec3;
  fov: number;
}

// ====== 三维向量小工具（避免引入 three 依赖）======
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lerp = (a: Vec3, b: Vec3, p: number): Vec3 => [
  a[0] + (b[0] - a[0]) * p,
  a[1] + (b[1] - a[1]) * p,
  a[2] + (b[2] - a[2]) * p,
];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// 绕 Y 轴旋转向量
function rotateY(v: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

// 绕任意单位轴旋转向量（罗德里格斯公式）
function rotateAxis(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = norm(axis);
  return add(add(mul(v, c), mul(cross(k, v), s)), mul(k, dot(k, v) * (1 - c)));
}

// 摇镜角度
const PAN_ANGLE = Math.PI / 6;  // 水平摇 ±30°
const TILT_ANGLE = Math.PI / 9; // 垂直摇 ±20°

/**
 * 采样相机在 t 时刻的姿态
 * - t 在运镜区间 [start, start+duration] 外时保持首/末姿态
 * - handheld 抖动为确定性正弦叠加（同一 t 永远得到同一姿态，可逐帧导出）
 */
export function sampleCameraPose(
  cam: PrevizCamera,
  t: number,
  characters: PrevizCharacter[]
): PrevizCameraPose {
  const m = cam.move;
  const dur = Math.max(0.0001, m.duration);
  const p = Math.min(1, Math.max(0, (t - m.start) / dur));
  const target = m.targetCharacterId
    ? characters.find((c) => c.id === m.targetCharacterId)
    : undefined;

  // 默认：机位/朝向在起止之间线性插值
  let position: Vec3 = lerp(m.startPos, m.endPos, p);
  let lookAt: Vec3 = lerp(m.startLook, m.endLook, p);
  let fov = cam.fov;

  switch (m.type) {
    case 'static':
      position = m.startPos;
      lookAt = m.startLook;
      break;

    // 推/拉：机位在 startPos→endPos 间直线移动（创建时 endPos 默认沿视线方向偏移），朝向不变
    case 'push-in':
    case 'pull-out':
      position = lerp(m.startPos, m.endPos, p);
      lookAt = m.startLook;
      break;

    // 摇镜：机位不动，朝向绕 Y 轴水平旋转 ±30°
    case 'pan-left':
    case 'pan-right': {
      position = m.startPos;
      const dir = sub(m.startLook, m.startPos);
      const angle = PAN_ANGLE * p * (m.type === 'pan-left' ? 1 : -1);
      lookAt = add(m.startPos, rotateY(dir, angle));
      break;
    }

    // 俯仰：机位不动，朝向绕水平轴垂直旋转 ±20°
    case 'tilt-up':
    case 'tilt-down': {
      position = m.startPos;
      const dir = sub(m.startLook, m.startPos);
      const axis = cross(dir, [0, 1, 0]); // 水平面上垂直于视线的轴
      const angle = TILT_ANGLE * p * (m.type === 'tilt-up' ? 1 : -1);
      lookAt = add(m.startPos, rotateAxis(dir, axis, angle));
      break;
    }

    // 轨道跟移：机位与目标保持固定偏移平移跟随，朝向保持初始视线方向
    case 'tracking': {
      if (target) {
        const tp = sampleCharacterPosition(target, t);
        const tp0 = sampleCharacterPosition(target, m.start);
        position = add(tp, sub(m.startPos, tp0));
        lookAt = add(position, sub(m.startLook, m.startPos));
      }
      break;
    }

    // 云台跟拍：机位跟随目标（固定偏移），朝向始终锁定目标
    case 'gimbal': {
      if (target) {
        const tp = sampleCharacterPosition(target, t);
        const tp0 = sampleCharacterPosition(target, m.start);
        position = add(tp, sub(m.startPos, tp0));
        lookAt = tp;
      }
      break;
    }

    // 环绕：以目标（或 startLook）为圆心，在水平面上绕 180°
    case 'orbit': {
      const center0 = target ? sampleCharacterPosition(target, m.start) : m.startLook;
      const center = target ? sampleCharacterPosition(target, t) : m.startLook;
      const rel = sub(m.startPos, center0);
      const radius = Math.hypot(rel[0], rel[2]) || 1;
      const angle0 = Math.atan2(rel[2], rel[0]);
      const a = angle0 + Math.PI * p;
      position = [
        center[0] + radius * Math.cos(a),
        m.startPos[1],
        center[2] + radius * Math.sin(a),
      ];
      lookAt = center;
      break;
    }

    // 摇臂升降：机位竖直升降（Y 由 startPos.y → endPos.y），朝向锁目标（无目标则保持 startLook）
    case 'crane': {
      position = [
        m.startPos[0],
        m.startPos[1] + (m.endPos[1] - m.startPos[1]) * p,
        m.startPos[2],
      ];
      lookAt = target ? sampleCharacterPosition(target, t) : m.startLook;
      break;
    }

    // 手持纪实：基础插值 + 确定性低频小幅抖动（机位和朝向都抖）
    case 'handheld': {
      const j1 =
        Math.sin(t * 5.7) * 0.6 + Math.sin(t * 9.3 + 1.3) * 0.3 + Math.sin(t * 2.1 + 2.7) * 0.1;
      const j2 =
        Math.sin(t * 6.9 + 0.7) * 0.6 + Math.sin(t * 11.1 + 2.0) * 0.3 + Math.sin(t * 3.3 + 1.9) * 0.1;
      const j3 = Math.sin(t * 4.3 + 1.1) * 0.6 + Math.sin(t * 8.1 + 2.9) * 0.4;
      position = [position[0] + j1 * 0.03, position[1] + j2 * 0.02, position[2] + j3 * 0.03];
      lookAt = [lookAt[0] + j2 * 0.05, lookAt[1] + j3 * 0.04, lookAt[2] + j1 * 0.05];
      break;
    }

    // 希区柯克变焦：机位沿视线反方向拉远，fov 同步缩小保持主体大小（背景压缩）
    case 'dolly-zoom': {
      const dir = norm(sub(m.startPos, m.startLook)); // 远离主体方向
      const d0 = len(sub(m.startPos, m.startLook)) || 1;
      const d = d0 * (1 + p); // 距离拉远一倍
      position = add(m.startPos, mul(dir, d0 * p));
      lookAt = m.startLook;
      // 主体大小恒定：d * tan(fov/2) = const
      const fov0 = (cam.fov * Math.PI) / 180;
      fov = (2 * Math.atan((d0 / d) * Math.tan(fov0 / 2)) * 180) / Math.PI;
      fov = Math.min(120, Math.max(10, fov));
      break;
    }
  }

  return { position, lookAt, fov };
}
