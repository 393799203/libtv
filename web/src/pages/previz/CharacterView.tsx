import { Component, Suspense, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { usePrevizStore, sampleCharacterPosition, activeActionAt, boneObjectId } from './previzStore';
import { modelDef, MODEL_DEFS, POSE_CLIP } from './actionLibrary';
import { matchPoseBone, registerPoseSnapshotter, unregisterPoseSnapshotter, registerPoseBoneObjects, unregisterPoseBoneObjects } from './poseBones';
import type { PoseBoneMap } from './poseBones';
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

  // 姿态编辑期间把骨骼注册进 gizmo 引用表（TransformControls 挂骨骼本体）
  useEffect(() => {
    if (!poseEditing) return;
    poseBones.forEach((bone, seg) => registerRef(boneObjectId(char.id, seg), bone));
    return () => {
      poseBones.forEach((_, seg) => registerRef(boneObjectId(char.id, seg), null));
    };
  }, [poseEditing, poseBones, char.id, registerRef]);

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

  // 骨骼拖拽旋转：按住骨骼小球直接拖动摆姿势
  const camera = useThree((s) => s.camera);
  const boneDrag = useRef<{ seg: string; x: number; y: number } | null>(null);
  const startBoneDrag = (seg: string, e: { stopPropagation: () => void; clientX: number; clientY: number; target: EventTarget | null; pointerId: number; nativeEvent: PointerEvent }) => {
    e.stopPropagation();
    // 关键：阻断 DOM 事件继续派发给 OrbitControls（它和 R3F 都挂在 canvas 上，
    // 不阻断的话同一按下手势会先启动相机旋转，骨骼就拖不动了）
    e.nativeEvent.stopImmediatePropagation();
    select(boneObjectId(char.id, seg));
    // 指针捕获到 canvas：拖动移出小球后 move/up 事件仍派发给该骨骼
    (e.target as Element | null)?.setPointerCapture?.(e.pointerId);
    boneDrag.current = { seg, x: e.clientX, y: e.clientY };
    usePrevizStore.getState().setGizmoDragging(true); // 双保险：禁用轨道相机
  };
  const moveBoneDrag = (e: { clientX: number; clientY: number }) => {
    const d = boneDrag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    if (dx === 0 && dy === 0) return;
    const bone = poseBones.get(d.seg);
    if (!bone || !bone.parent) return;
    // 屏幕方向映射到世界轴：横向拖=绕相机上轴转，纵向拖=绕相机右轴转
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const qWorld = new THREE.Quaternion()
      .setFromAxisAngle(up, dx * 0.01)
      .multiply(new THREE.Quaternion().setFromAxisAngle(right, dy * 0.01));
    // 世界旋转增量转到骨骼父空间，再前乘到骨骼局部四元数
    const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    bone.quaternion.premultiply(pq.clone().invert().multiply(qWorld).multiply(pq));
  };
  const endBoneDrag = () => {
    boneDrag.current = null;
    usePrevizStore.getState().setGizmoDragging(false);
  };

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

    // 自定义姿势动作：直接把快照四元数写到骨骼，不走 mixer（骨骼找不到的跳过）
    if (active?.pose) {
      const poseState = playStateRef.current;
      if (poseState.clipName !== POSE_CLIP) {
        poseState.action?.stop();
        poseState.action = null;
        poseState.clipName = POSE_CLIP;
      }
      poseBones.forEach((bone, seg) => {
        const q = active.pose?.[seg];
        if (q) bone.quaternion.set(q[0], q[1], q[2], q[3]);
      });
      return;
    }

    const clipName = active?.clip ?? def.idleClip;
    const state = playStateRef.current;

    // 动作切换：crossFade 0.2s 淡入新动作
    if (clipName !== state.clipName) {
      const next = actions[clipName];
      if (next) {
        const looping = def.looping.has(clipName);
        next.reset();
        next.setLoop(looping ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
        next.clampWhenFinished = true;
        if (state.action && state.action !== next) {
          next.crossFadeFrom(state.action, CROSS_FADE, false);
        }
        next.play();
        state.action = next;
        state.clipName = clipName;
      }
    }

    const action = state.action;
    if (!action) return;

    if (playing) {
      // 播放中：mixer 自然推进；若与时间轴偏差过大（如拖动进度条）则强制对时
      mixer.update(delta);
      const clip = action.getClip();
      const local = Math.max(0, t - (active?.start ?? 0));
      const expected = def.looping.has(clipName)
        ? local % clip.duration
        : Math.min(local, clip.duration);
      if (Math.abs(action.time - expected) > 0.5) {
        action.time = expected;
      }
    } else {
      // 暂停/拖进度条：直接跳到该时刻的姿势
      const clip = action.getClip();
      const local = Math.max(0, t - (active?.start ?? 0));
      action.time = def.looping.has(clipName)
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

      {/* 姿态编辑模式：主要骨骼小球（点击选中后挂 gizmo 旋转摆姿势；depthTest 关闭保证不被身体挡住） */}
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
              onPointerDown={(e) => startBoneDrag(seg, e)}
              onPointerMove={moveBoneDrag}
              onPointerUp={endBoneDrag}
              onPointerCancel={endBoneDrag}
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
