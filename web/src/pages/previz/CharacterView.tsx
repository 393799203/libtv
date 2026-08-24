import { Component, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { usePrevizStore, sampleCharacterPosition, activeActionAt, boneObjectId } from './previzStore';
import { modelDef, MODEL_DEFS, POSE_CLIP, isLoopingClip } from './actionLibrary';
import { matchPoseBone, registerPoseSnapshotter, unregisterPoseSnapshotter, registerPoseBoneObjects, unregisterPoseBoneObjects } from './poseBones';
import type { PoseBoneMap, PoseSnapshot } from './poseBones';
import type { PrevizCharacter } from './types';

// 人偶目标身高（米）：加载后按包围盒高度归一缩放（模型单位不一定是米）
const CHARACTER_HEIGHT = 1.75;

// 朝向校正：模型正脸若非 +Z，行走自动朝向会反向——人偶倒着走就改成 Math.PI
const FACING_OFFSET = 0;

// 白模材质默认颜色（未染色的角色）
const MANNEQUIN_COLOR = '#d1d5db';
const SELECT_EMISSIVE = '#2563eb';

// 动作切换时的淡入时长（秒）
const CROSS_FADE = 0.2;

// 骨骼世界坐标换算复用向量（避免每帧分配）
const tmpVec = new THREE.Vector3();

// ====== GLB 加载失败兜底：静态灰色胶囊占位，不影响编辑器其余部分 ======
function CharacterFallback({ char }: { char: PrevizCharacter }) {
  const select = usePrevizStore((s) => s.select);
  return (
    <group
      position={char.position}
      rotation={[0, char.rotationY, 0]}
      onClick={(e) => {
        e.stopPropagation();
        select(char.id);
      }}
    >
      <mesh position={[0, 0.9, 0]}>
        <capsuleGeometry args={[0.3, 1.2, 4, 8]} />
        <meshStandardMaterial color={char.color ?? '#9ca3af'} />
      </mesh>
    </group>
  );
}

// GLB 加载/解析错误边界：console 报错 + 置 store 标记（面板提示），渲染占位胶囊
class MannequinErrorBoundary extends Component<
  { char: PrevizCharacter; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(err: unknown) {
    console.error('人偶模型加载失败:', err);
    usePrevizStore.getState().setMannequinError(true);
  }

  render() {
    if (this.state.failed) return <CharacterFallback char={this.props.char} />;
    return this.props.children;
  }
}

// ====== 人偶模型本体 ======
function CharacterModel({
  char,
  registerRef,
}: {
  char: PrevizCharacter;
  registerRef: (id: string, obj: THREE.Object3D | null) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const selected = usePrevizStore((s) => s.selectedId === char.id);
  const selectedId = usePrevizStore((s) => s.selectedId);
  const select = usePrevizStore((s) => s.select);
  // 姿态编辑模式（仅当前角色开启时）
  const poseEditing = usePrevizStore((s) => s.poseEditingCharId === char.id);

  // 按角色选择的模型加载（男体 / 女体）
  const def = modelDef(char.model);
  const { scene, animations } = useGLTF(def.url);


  // 克隆场景（多角色各自独立骨骼），统一换成白模材质，并按包围盒归一到目标身高
  const { clonedScene, material } = useMemo(() => {
    const cloned = skeletonClone(scene);
    const mat = new THREE.MeshStandardMaterial({
      color: MANNEQUIN_COLOR,
      roughness: 0.85,
      metalness: 0,
    });
    cloned.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        (o as THREE.Mesh).material = mat;
        // 人偶参与阴影投射/接收
        o.castShadow = true;
        o.receiveShadow = true;
        // 骨骼蒙皮模型的几何包围球不可靠，防止视锥剔除误判
        o.frustumCulled = false;
      }
    });
    // 尺寸归一：蒙皮模型用蒙皮感知的包围盒（静态几何包围盒对部分模型不可信）
    const bbox = new THREE.Box3();
    const tmpBox = new THREE.Box3();
    cloned.updateMatrixWorld(true);
    cloned.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (sm.isSkinnedMesh) {
        sm.computeBoundingBox();
        tmpBox.copy(sm.boundingBox).applyMatrix4(sm.matrixWorld);
        bbox.union(tmpBox);
      }
    });
    if (bbox.isEmpty()) bbox.setFromObject(cloned);
    const height = bbox.max.y - bbox.min.y;
    if (height > 1e-6 && Math.abs(height - CHARACTER_HEIGHT) > 0.01) {
      cloned.scale.multiplyScalar(CHARACTER_HEIGHT / height);
    }
    return { clonedScene: cloned, material: mat };
  }, [scene, def.kind]);

  const { actions, mixer } = useAnimations(animations, groupRef);

  // 动画列表变化（扩展动作加载完成并入）后 useAnimations 会重建 actions 并停掉旧动作，
  // 重置播放状态，让下一帧用新 actions 重新拉起当前 clip
  useEffect(() => {
    playStateRef.current = { clipName: '', action: null };
  }, [animations]);

  // 收集 20 个主要骨骼（包含匹配，见 poseBones.ts）
  const poseBones: PoseBoneMap = useMemo(() => {
    const map: PoseBoneMap = new Map();
    clonedScene.traverse((o) => {
      if ((o as THREE.Bone).isBone) {
        const seg = matchPoseBone(o.name);
        if (seg && !map.has(seg)) map.set(seg, o);
      }
    });
    return map;
  }, [clonedScene]);

  // 骨骼小球引用表（姿态编辑模式下每帧跟随骨骼世界位置）
  const boneSpheres = useRef(new Map<string, THREE.Mesh>());

  // 姿态编辑期间停掉该角色所有动画动作：
  // drei useAnimations 内部有独立的 useFrame 每帧 mixer.update，
  // 不停止动作的话 Idle 动画每帧覆写骨骼，手动摆姿势/滑杆全被冲掉
  useEffect(() => {
    if (poseEditing) {
      mixer.stopAllAction();
      playStateRef.current = { clipName: '', action: null };
    }
  }, [poseEditing, mixer]);

  // 注册姿势快照函数（面板「保存为姿势」时取当前 20 骨的局部四元数）
  useEffect(() => {
    registerPoseSnapshotter(char.id, () => {
      const pose: Record<string, [number, number, number, number]> = {};
      poseBones.forEach((bone, seg) => {
        pose[seg] = [bone.quaternion.x, bone.quaternion.y, bone.quaternion.z, bone.quaternion.w];
      });
      return pose;
    });
    return () => unregisterPoseSnapshotter(char.id);
  }, [char.id, poseBones]);

  // 注册骨骼对象表（面板旋转滑杆经注册表直接读写骨骼）
  useEffect(() => {
    registerPoseBoneObjects(char.id, poseBones);
    return () => unregisterPoseBoneObjects(char.id);
  }, [char.id, poseBones]);

  // 角色染色（白片中区分角色；未设置用默认灰）
  useEffect(() => {
    material.color.set(char.color ?? MANNEQUIN_COLOR);
  }, [material, char.color]);

  // 选中高亮（直接改材质自发光，避免重建）
  useEffect(() => {
    material.emissive.set(selected ? SELECT_EMISSIVE : '#000000');
    material.emissiveIntensity = selected ? 0.35 : 0;
  }, [material, selected]);

  // 卸载时释放克隆体与材质
  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  // 当前播放的动画状态（跨帧保持）
  const playStateRef = useRef<{ clipName: string; action: THREE.AnimationAction | null }>({
    clipName: '',
    action: null,
  });

  // 每帧驱动：位置按走位路径插值；动画按时间轴切换/对时
  useFrame((_, delta) => {
    const g = groupRef.current;
    if (!g) return;
    const {
      currentTime: t,
      playing,
      gizmoDragging,
      selectedId: sid,
      poseEditingCharId,
    } = usePrevizStore.getState();

    // 位置/朝向（无路径时跟基准 position，TransformControls 拖拽已写回 store）
    // 正在用 gizmo 拖拽本体时不回弹（拖拽值正通过 upsertPathPointAt 写入路径点）
    const draggingSelf = gizmoDragging && sid === char.id;
    if (!draggingSelf) {
      const [x, y, z] = sampleCharacterPosition(char, t);
      g.position.set(x, y, z);

      // 朝向：有路径且未手动锁定朝向时，脸朝运动前方（向前/向后差分确定方向）；否则用手动设置的朝向
      let rotY = char.rotationY;
      if (char.path.length >= 2 && !char.manualFacing) {
        const EPS = 1e-4;
        const STEP = 0.1;
        const ahead = sampleCharacterPosition(char, t + STEP);
        let dx = ahead[0] - x;
        let dz = ahead[2] - z;
        if (Math.hypot(dx, dz) <= EPS) {
          // 已在路径末尾（前方没有位移），改用后方差分保持最后的前进方向
          const behind = sampleCharacterPosition(char, Math.max(0, t - STEP));
          dx = x - behind[0];
          dz = z - behind[2];
        }
        if (Math.hypot(dx, dz) > EPS) {
          rotY = Math.atan2(dx, dz); // 模型正脸朝 +Z（见 FACING_OFFSET），使 +Z 对齐运动方向
        }
      }
      g.rotation.set(0, rotY + FACING_OFFSET, 0);
    }

    // 姿态编辑模式：骨骼小球跟随骨骼世界位置；跳过动画驱动（骨骼由用户 gizmo 摆姿势，mixer 不覆盖）
    if (poseEditingCharId === char.id) {
      poseBones.forEach((bone, seg) => {
        const s = boneSpheres.current.get(seg);
        if (!s) return;
        bone.getWorldPosition(tmpVec);
        s.position.copy(g.worldToLocal(tmpVec));
      });
      return;
    }

    // 该时刻应播放的动作
    const active = activeActionAt(char, t);

    // 自定义姿势动作：把快照四元数写到骨骼，不走 mixer（骨骼找不到的跳过）
    // 相邻两个姿势之间按时间做球面插值（slerp），姿势序列变成连贯的关键帧动画。
    // 注：姿势↔动画之间的过渡目前是硬切（mixer 权重机制无法从任意骨骼状态混入），
    // 编排时把姿势收尾摆到接近下一个动画的起始姿态即可
    if (active?.pose) {
      const poseState = playStateRef.current;
      if (poseState.clipName !== POSE_CLIP) {
        poseState.action?.stop();
        poseState.action = null;
        poseState.clipName = POSE_CLIP;
      }
      // 查找下一条动作：若也是自定义姿势，按播放头在两者之间的位置插值
      const activeIdx = char.actions.indexOf(active);
      const next = char.actions[activeIdx + 1];
      const nextPose = next?.pose ?? null;
      const span = nextPose ? next.start - active.start : 0;
      const ratio = nextPose && span > 1e-3 ? Math.min(1, Math.max(0, (t - active.start) / span)) : 0;
      const qa = new THREE.Quaternion();
      const qb = new THREE.Quaternion();
      poseBones.forEach((bone, seg) => {
        const a = active.pose?.[seg];
        if (!a) return;
        qa.set(a[0], a[1], a[2], a[3]);
        if (nextPose && ratio > 0) {
          const b = nextPose[seg];
          if (b) {
            qb.set(b[0], b[1], b[2], b[3]);
            qa.slerp(qb, ratio);
          }
        }
        bone.quaternion.copy(qa);
      });
      return;
    }

    const clipName = active?.clip ?? def.idleClip;
    const state = playStateRef.current;

    // 动作切换：crossFade 0.2s 淡入新动作
    // 扩展动作未加载完成时兜底播 idle（加载完成后下一轮自动切换过去）
    if (clipName !== state.clipName) {
      let target = clipName;
      let next = actions[target];
      if (!next) {
        target = def.idleClip;
        next = actions[target];
      }
      if (next && target !== state.clipName) {
        const looping = isLoopingClip(char.model, target);
        next.reset();
        next.setLoop(looping ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
        next.clampWhenFinished = true;
        if (state.action && state.action !== next) {
          next.crossFadeFrom(state.action, CROSS_FADE, false);
        }
        next.play();
        state.action = next;
        state.clipName = target;
      }
    }

    const action = state.action;
    if (!action) return;

    if (playing) {
      // 播放中：mixer 自然推进；若与时间轴偏差过大（如拖动进度条）则强制对时
      mixer.update(delta);
      const clip = action.getClip();
      const local = Math.max(0, t - (active?.start ?? 0));
      const expected = isLoopingClip(char.model, state.clipName)
        ? local % clip.duration
        : Math.min(local, clip.duration);
      if (Math.abs(action.time - expected) > 0.5) {
        action.time = expected;
      }
    } else {
      // 暂停/拖进度条：直接跳到该时刻的姿势
      const clip = action.getClip();
      const local = Math.max(0, t - (active?.start ?? 0));
      action.time = isLoopingClip(char.model, state.clipName)
        ? local % clip.duration
        : Math.min(local, Math.max(0, clip.duration - 1e-4));
      mixer.update(0);
    }
  });

  return (
    <group
      ref={(g) => {
        groupRef.current = g;
        registerRef(char.id, g);
      }}
      onClick={(e) => {
        // 姿态编辑中：身体不拦截点击（不 stopPropagation），事件穿透到内部骨骼小球，
        // 骨骼处理器后触发、覆盖选中为骨骼；点在身体上无骨骼处则保持选中角色
        if (poseEditing) return;
        e.stopPropagation();
        select(char.id);
      }}
    >
      <primitive object={clonedScene} />

      {/* 姿态编辑模式：主要骨骼小球（点击选中后用面板滑杆摆姿势；depthTest 关闭保证不被身体挡住） */}
      {poseEditing &&
        [...poseBones.keys()].map((seg) => {
          const bid = boneObjectId(char.id, seg);
          const isBoneSelected = selectedId === bid;
          return (
            <mesh
              key={seg}
              ref={(m) => {
                if (m) boneSpheres.current.set(seg, m);
                else boneSpheres.current.delete(seg);
              }}
              renderOrder={999}
              onClick={(e) => {
                e.stopPropagation();
                select(bid);
              }}
            >
              <sphereGeometry args={[isBoneSelected ? 0.05 : 0.032, 12, 8]} />
              <meshBasicMaterial
                color={isBoneSelected ? '#f59e0b' : '#38bdf8'}
                depthTest={false}
                transparent
                opacity={0.9}
              />
            </mesh>
          );
        })}
    </group>
  );
}

// 对外导出：错误边界 + Suspense 包裹的人偶
export function CharacterView({
  char,
  registerRef,
}: {
  char: PrevizCharacter;
  registerRef: (id: string, obj: THREE.Object3D | null) => void;
}) {
  return (
    <MannequinErrorBoundary char={char}>
      <Suspense fallback={<CharacterFallback char={char} />}>
        <CharacterModel char={char} registerRef={registerRef} />
      </Suspense>
    </MannequinErrorBoundary>
  );
}

useGLTF.preload(MODEL_DEFS.male.url);
useGLTF.preload(MODEL_DEFS.female.url);
