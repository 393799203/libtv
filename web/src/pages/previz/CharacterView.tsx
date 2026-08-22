import { Component, Suspense, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { usePrevizStore, sampleCharacterPosition, activeActionAt } from './previzStore';
import { IDLE_CLIP, LOOPING_CLIPS } from './actionLibrary';
import type { PrevizCharacter } from './types';

// 人偶模型（KayKit Knight，CC0）：骨架 + 76 个动画
// 模型内是 PrototypePete 素体 + 可拆件，隐藏盔甲/武器/披风后就是普通人物白模
export const MANNEQUIN_URL = '/previz/mannequin.glb';

// 加载时隐藏的部件（盔甲/武器/披风），只留素体
const HIDDEN_PARTS = new Set([
  '1H_Sword_Offhand',
  'Badge_Shield',
  'Rectangle_Shield',
  'Round_Shield',
  'Spike_Shield',
  '1H_Sword',
  '2H_Sword',
  'Knight_Helmet',
  'Knight_Cape',
]);

// 白模材质颜色
const MANNEQUIN_COLOR = '#d1d5db';
const SELECT_EMISSIVE = '#2563eb';

// 动作切换时的淡入时长（秒）
const CROSS_FADE = 0.2;

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
        <meshStandardMaterial color="#9ca3af" />
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
  const select = usePrevizStore((s) => s.select);

  const { scene, animations } = useGLTF(MANNEQUIN_URL);

  // 克隆场景（多角色各自独立骨骼），并统一替换成浅灰白模材质
  const { clonedScene, material } = useMemo(() => {
    const cloned = skeletonClone(scene);
    const mat = new THREE.MeshStandardMaterial({
      color: MANNEQUIN_COLOR,
      roughness: 0.85,
      metalness: 0,
    });
    cloned.traverse((o) => {
      // 隐藏盔甲/武器/披风部件，只留普通人物素体
      if (HIDDEN_PARTS.has(o.name)) {
        o.visible = false;
        return;
      }
      if ((o as THREE.Mesh).isMesh) {
        (o as THREE.Mesh).material = mat;
      }
    });
    return { clonedScene: cloned, material: mat };
  }, [scene]);

  const { actions, mixer } = useAnimations(animations, groupRef);

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
    const { currentTime: t, playing, gizmoDragging, selectedId } = usePrevizStore.getState();

    // 位置/朝向（无路径时跟基准 position，TransformControls 拖拽已写回 store）
    // 正在用 gizmo 拖拽本体时不回弹（拖拽值正通过 upsertPathPointAt 写入路径点）
    const draggingSelf = gizmoDragging && selectedId === char.id;
    if (!draggingSelf) {
      const [x, y, z] = sampleCharacterPosition(char, t);
      g.position.set(x, y, z);

      // 朝向：有路径且正在移动时，脸朝运动前方（向前/向后差分确定方向）；静止时用手动设置的朝向
      let rotY = char.rotationY;
      if (char.path.length >= 2) {
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
          rotY = Math.atan2(dx, dz); // 模型正脸朝 +Z，使 +Z 对齐运动方向
        }
      }
      g.rotation.set(0, rotY, 0);
    }

    // 该时刻应播放的动作
    const active = activeActionAt(char, t);
    const clipName = active?.clip ?? IDLE_CLIP;
    const state = playStateRef.current;

    // 动作切换：crossFade 0.2s 淡入新动作
    if (clipName !== state.clipName) {
      const next = actions[clipName];
      if (next) {
        const looping = LOOPING_CLIPS.has(clipName);
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
      const expected = LOOPING_CLIPS.has(clipName)
        ? local % clip.duration
        : Math.min(local, clip.duration);
      if (Math.abs(action.time - expected) > 0.5) {
        action.time = expected;
      }
    } else {
      // 暂停/拖进度条：直接跳到该时刻的姿势
      const clip = action.getClip();
      const local = Math.max(0, t - (active?.start ?? 0));
      action.time = LOOPING_CLIPS.has(clipName)
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
        e.stopPropagation();
        select(char.id);
      }}
    >
      <primitive object={clonedScene} />
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

useGLTF.preload(MANNEQUIN_URL);
