import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Line, OrbitControls, RoundedBox, TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  usePrevizStore,
  pathPointId,
  parsePathPointId,
  cameraPointId,
  parseCameraPointId,
  parseBoneId,
} from './previzStore';
import { CharacterView } from './CharacterView';
import { sampleCameraPose } from './cameraRig';
import { registerPrevizViewport } from './recorder';
import type { PrevizCamera, PrevizObject } from './types';

// TransformControls 的三种拖拽模式
type TransformMode = 'translate' | 'rotate' | 'scale';

const MODE_LABELS: Record<TransformMode, string> = {
  translate: '移动',
  rotate: '旋转',
  scale: '缩放',
};

// 圆角方块：白模粘土质感的基础件；圆角半径按最小边自适应（薄板件不会过度圆角）
// 注：圆角 + 阴影会增加三角面数，同屏元素很多（上百个组合件）时注意性能
function BBox({
  args,
  children,
  position,
  rotation,
  scale,
}: {
  args: [number, number, number];
  children?: React.ReactNode;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number] | number;
}) {
  const radius = Math.min(0.04, Math.min(...args) * 0.2);
  return (
    <RoundedBox
      args={args}
      radius={radius}
      smoothness={2}
      position={position}
      rotation={rotation}
      scale={scale}
    >
      {children}
    </RoundedBox>
  );
}

// 按对象 id 哈希给材质明度做 ±5% 抖动，减少「全是同一个灰盒子」感
function shadeColor(hex: string, id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  const f = 0.95 + (((h % 100) + 100) % 100) / 1000; // 0.95 ~ 1.049
  const c = new THREE.Color(hex).multiplyScalar(f);
  return `#${c.getHexString()}`;
}

// 每种类型对应的渲染内容：基础几何体为单 mesh，组合式白模组件为 group 拼装
// 组合内部相对比例写死、外包围盒约 1m，实际尺寸由对象 scale 承担（与单位几何体同一约定）
function ObjectContent({ obj, selected }: { obj: PrevizObject; selected: boolean }) {
  // 统一灰白白模材质（选中蓝色高亮）；按 id 做轻微明度抖动，road 等自带颜色由 obj.color 承担
  const matColor = useMemo(() => shadeColor(obj.color, obj.id), [obj.color, obj.id]);
  const mat = (
    <meshStandardMaterial
      color={matColor}
      emissive={selected ? '#2563eb' : '#000000'}
      emissiveIntensity={selected ? 0.5 : 0}
      side={THREE.DoubleSide}
    />
  );

  switch (obj.type) {
    case 'box':
    case 'wall':
      return (
        <BBox args={[1, 1, 1]}>{mat}</BBox>
      );
    case 'cylinder':
      return (
        <mesh>
          <cylinderGeometry args={[0.5, 0.5, 1, 32]} />
          {mat}
        </mesh>
      );
    case 'sphere':
      return (
        <mesh>
          <sphereGeometry args={[0.5, 32, 16]} />
          {mat}
        </mesh>
      );
    // 平面：平躺烘进几何（mesh 层 rotation-x=-90°），不再依赖对象 rotation（AI 返回 [0,0,0]）
    case 'plane':
      return (
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[1, 1]} />
          {mat}
        </mesh>
      );

    // 楼梯：5 级台阶逐级上升（沿 -z 上行），包围盒 1x1x1
    case 'stairs':
      return (
        <group>
          {[0, 1, 2, 3, 4].map((i) => {
            const h = 0.2 * (i + 1);
            return (
              <BBox key={i} position={[0, h / 2, 0.4 - 0.2 * i]} args={[1, h, 0.2]}>{mat}</BBox>
            );
          })}
        </group>
      );

    // 房子：box 主体 + 四棱锥屋顶（45° 旋转扣在顶上），包围盒约 1x1x0.8
    case 'house':
      return (
        <group>
          <BBox position={[0, 0.325, 0]} args={[1, 0.65, 0.8]}>{mat}</BBox>
          <mesh position={[0, 0.825, 0]} rotation={[0, Math.PI / 4, 0]}>
            <coneGeometry args={[0.72, 0.35, 4]} />
            {mat}
          </mesh>
        </group>
      );

    // 路面：薄长条（y≈0.02），深灰色由 obj.color 承担
    case 'road':
      return (
        <BBox position={[0, 0.01, 0]} args={[1, 0.02, 1]}>{mat}</BBox>
      );

    // 树：cylinder 树干 + sphere 树冠，总高 1
    case 'tree':
      return (
        <group>
          <mesh position={[0, 0.225, 0]}>
            <cylinderGeometry args={[0.06, 0.08, 0.45, 12]} />
            {mat}
          </mesh>
          <mesh position={[0, 0.7, 0]}>
            <sphereGeometry args={[0.3, 20, 14]} />
            {mat}
          </mesh>
        </group>
      );

    // 栅栏：薄矮板（比 wall 矮）
    case 'fence':
      return (
        <BBox position={[0, 0.5, 0]} args={[1, 1, 0.05]}>{mat}</BBox>
      );

    // 车辆：box 车身 + 小一号 box 车厢，包围盒 1x0.9x0.45
    case 'car':
      return (
        <group>
          <BBox position={[0, 0.25, 0]} args={[1, 0.5, 0.45]}>{mat}</BBox>
          <BBox position={[-0.05, 0.7, 0]} args={[0.55, 0.4, 0.4]}>{mat}</BBox>
        </group>
      );

    // ====== 建筑结构 ======

    // 斜坡：斜置薄板坡道（沿 -z 上行，坡角约 24°）
    case 'ramp':
      return (
        <BBox position={[0, 0.22, 0]} rotation={[0.42, 0, 0]} args={[1, 0.05, 1.1]}>{mat}</BBox>
      );

    // 平台/高台：扁平台子
    case 'platform':
      return (
        <BBox position={[0, 0.5, 0]} args={[1, 1, 1]}>{mat}</BBox>
      );

    // 门：竖直薄板 + 边框（两侧框 + 顶框）
    case 'door':
      return (
        <group>
          <BBox position={[0, 0.48, 0]} args={[0.85, 0.96, 0.5]}>{mat}</BBox>
          <BBox position={[-0.46, 0.5, 0]} args={[0.08, 1, 1]}>{mat}</BBox>
          <BBox position={[0.46, 0.5, 0]} args={[0.08, 1, 1]}>{mat}</BBox>
          <BBox position={[0, 0.98, 0]} args={[1, 0.05, 1]}>{mat}</BBox>
        </group>
      );

    // 窗：外框 + 内嵌板（装墙上用）
    case 'window':
      return (
        <group>
          <BBox position={[0, 0.5, 0]} args={[1, 1, 0.6]}>{mat}</BBox>
          <BBox position={[0, 0.5, 0]} args={[0.85, 0.85, 1]}>{mat}</BBox>
        </group>
      );

    // 拱门：两根柱 + 顶部横梁
    case 'arch':
      return (
        <group>
          <BBox position={[-0.45, 0.4, 0]} args={[0.1, 0.8, 0.5]}>{mat}</BBox>
          <BBox position={[0.45, 0.4, 0]} args={[0.1, 0.8, 0.5]}>{mat}</BBox>
          <BBox position={[0, 0.9, 0]} args={[1, 0.2, 0.5]}>{mat}</BBox>
        </group>
      );

    // 栏杆：矮薄板 + 顶杆
    case 'railing':
      return (
        <group>
          <BBox position={[0, 0.3, 0]} args={[1, 0.6, 0.05]}>{mat}</BBox>
          <BBox position={[0, 0.9, 0]} args={[1, 0.08, 0.08]}>{mat}</BBox>
        </group>
      );

    // ====== 街道设施 ======

    // 路灯：细圆柱杆 + 顶部横臂 + 灯头
    case 'streetlamp':
      return (
        <group>
          <mesh position={[0, 0.425, 0]}>
            <cylinderGeometry args={[0.02, 0.03, 0.85, 10]} />
            {mat}
          </mesh>
          <BBox position={[0.12, 0.86, 0]} args={[0.25, 0.04, 0.05]}>{mat}</BBox>
          <BBox position={[0.24, 0.83, 0]} args={[0.1, 0.05, 0.07]}>{mat}</BBox>
        </group>
      );

    // 长椅：座板 + 靠背 + 两短腿
    case 'bench':
      return (
        <group>
          <BBox position={[0, 0.45, 0]} args={[1, 0.06, 0.3]}>{mat}</BBox>
          <BBox position={[0, 0.66, -0.14]} args={[1, 0.36, 0.05]}>{mat}</BBox>
          <BBox position={[-0.45, 0.22, 0]} args={[0.05, 0.45, 0.25]}>{mat}</BBox>
          <BBox position={[0.45, 0.22, 0]} args={[0.05, 0.45, 0.25]}>{mat}</BBox>
        </group>
      );

    // 招牌：立柱 + 矩形牌面
    case 'signboard':
      return (
        <group>
          <mesh position={[0, 0.35, 0]}>
            <cylinderGeometry args={[0.03, 0.03, 0.7, 10]} />
            {mat}
          </mesh>
          <BBox position={[0, 0.85, 0]} args={[0.6, 0.3, 0.04]}>{mat}</BBox>
        </group>
      );

    // 人行道：薄板条（浅灰由 obj.color 承担，区别于 road 深灰）
    case 'sidewalk':
      return (
        <BBox position={[0, 0.015, 0]} args={[1, 0.03, 1]}>{mat}</BBox>
      );

    // 电线杆：高圆柱 + 顶部横担
    case 'utilitypole':
      return (
        <group>
          <mesh position={[0, 0.5, 0]}>
            <cylinderGeometry args={[0.025, 0.035, 1, 10]} />
            {mat}
          </mesh>
          <BBox position={[0, 0.9, 0]} args={[0.5, 0.04, 0.05]}>{mat}</BBox>
        </group>
      );

    // ====== 家具 ======

    // 桌子：面板 + 四腿
    case 'table':
      return (
        <group>
          <BBox position={[0, 0.94, 0]} args={[1, 0.06, 0.55]}>{mat}</BBox>
          {[
            [-0.45, -0.22],
            [0.45, -0.22],
            [-0.45, 0.22],
            [0.45, 0.22],
          ].map(([x, z]) => (
            <BBox key={`${x},${z}`} position={[x, 0.47, z]} args={[0.05, 0.94, 0.05]}>{mat}</BBox>
          ))}
        </group>
      );

    // 椅子：座面 + 靠背 + 四腿
    case 'chair':
      return (
        <group>
          <BBox position={[0, 0.5, 0]} args={[0.9, 0.07, 0.9]}>{mat}</BBox>
          <BBox position={[0, 0.78, -0.42]} args={[0.9, 0.55, 0.07]}>{mat}</BBox>
          {[
            [-0.4, -0.4],
            [0.4, -0.4],
            [-0.4, 0.4],
            [0.4, 0.4],
          ].map(([x, z]) => (
            <BBox key={`${x},${z}`} position={[x, 0.25, z]} args={[0.07, 0.5, 0.07]}>{mat}</BBox>
          ))}
        </group>
      );

    // 沙发：底座 + 靠背 + 两扶手
    case 'sofa':
      return (
        <group>
          <BBox position={[0, 0.18, 0]} args={[1, 0.36, 0.45]}>{mat}</BBox>
          <BBox position={[0, 0.58, -0.16]} args={[1, 0.45, 0.12]}>{mat}</BBox>
          <BBox position={[-0.44, 0.5, 0]} args={[0.12, 0.3, 0.45]}>{mat}</BBox>
          <BBox position={[0.44, 0.5, 0]} args={[0.12, 0.3, 0.45]}>{mat}</BBox>
        </group>
      );

    // 床：床架 + 床垫 + 床头板
    case 'bed':
      return (
        <group>
          <BBox position={[0, 0.1, 0]} args={[1, 0.2, 1]}>{mat}</BBox>
          <BBox position={[0, 0.28, 0]} args={[0.95, 0.16, 0.95]}>{mat}</BBox>
          <BBox position={[0, 0.45, -0.47]} args={[1, 0.5, 0.06]}>{mat}</BBox>
        </group>
      );

    // 柜子：高柜体 + 顶沿
    case 'cabinet':
      return (
        <group>
          <BBox position={[0, 0.48, 0]} args={[1, 0.96, 1]}>{mat}</BBox>
          <BBox position={[0, 0.98, 0]} args={[1.05, 0.04, 1.05]}>{mat}</BBox>
        </group>
      );

    // 屏幕/电视：薄板 + 支架 + 底座
    case 'screen':
      return (
        <group>
          <BBox position={[0, 0.7, 0]} args={[1, 0.6, 0.06]}>{mat}</BBox>
          <BBox position={[0, 0.3, 0]} args={[0.08, 0.2, 0.06]}>{mat}</BBox>
          <BBox position={[0, 0.03, 0]} args={[0.4, 0.05, 0.3]}>{mat}</BBox>
        </group>
      );

    // ====== 载具 ======

    // 卡车：货厢大 box + 车头小 box（沿 x 走向）
    case 'truck':
      return (
        <group>
          <BBox position={[-0.15, 0.5, 0]} args={[0.65, 0.65, 0.9]}>{mat}</BBox>
          <BBox position={[0.36, 0.4, 0]} args={[0.28, 0.4, 0.85]}>{mat}</BBox>
        </group>
      );

    // 摩托：两轮（细圆柱横放）+ 车身小 box
    case 'motorcycle':
      return (
        <group>
          <mesh position={[-0.35, 0.15, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.15, 0.15, 0.05, 16]} />
            {mat}
          </mesh>
          <mesh position={[0.35, 0.15, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.15, 0.15, 0.05, 16]} />
            {mat}
          </mesh>
          <BBox position={[0, 0.3, 0]} args={[0.5, 0.15, 0.12]}>{mat}</BBox>
        </group>
      );

    // 自行车：两个细轮 + 斜梁 + 立管（三角架近似）
    case 'bicycle':
      return (
        <group>
          <mesh position={[-0.3, 0.18, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.18, 0.18, 0.03, 16]} />
            {mat}
          </mesh>
          <mesh position={[0.3, 0.18, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.18, 0.18, 0.03, 16]} />
            {mat}
          </mesh>
          {/* 斜梁 */}
          <BBox position={[0, 0.4, 0]} rotation={[0, 0, 0.5]} args={[0.55, 0.03, 0.03]}>{mat}</BBox>
          {/* 车把立管 */}
          <BBox position={[0.28, 0.55, 0]} args={[0.03, 0.35, 0.03]}>{mat}</BBox>
        </group>
      );

    // ====== 自然 ======

    // 岩石：压扁的十二面体（不规则感）
    case 'rock':
      return (
        <mesh position={[0, 0.3, 0]} scale={[1, 0.7, 0.9]}>
          <dodecahedronGeometry args={[0.5, 0]} />
          {mat}
        </mesh>
      );

    // 灌木：半球
    case 'bush':
      return (
        <mesh position={[0, 0, 0]}>
          <sphereGeometry args={[0.5, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          {mat}
        </mesh>
      );

    // 水面：薄平面，半透明蓝色（白模中唯一的彩色元素）
    case 'water':
      return (
        <BBox args={[1, 0.02, 1]} position={[0, 0.01, 0]}>
          <meshStandardMaterial
            color={matColor}
            transparent
            opacity={0.55}
            emissive={selected ? '#2563eb' : '#000000'}
            emissiveIntensity={selected ? 0.5 : 0}
            side={THREE.DoubleSide}
          />
        </BBox>
      );

    // 土坡/山丘：半球（默认 scale 压成扁平坡）
    case 'hill':
      return (
        <mesh position={[0, 0, 0]}>
          <sphereGeometry args={[0.5, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
          {mat}
        </mesh>
      );
  }
}

// 单个场景对象：外层 group 承载位置/旋转/缩放，灰色系白模材质，选中时蓝色高亮
function SceneObject({
  obj,
  registerRef,
}: {
  obj: PrevizObject;
  registerRef: (id: string, mesh: THREE.Object3D | null) => void;
}) {
  const selected = usePrevizStore((s) => s.selectedId === obj.id);
  const select = usePrevizStore((s) => s.select);

  // 阴影：组内所有 mesh 统一投射+接收阴影（组合件子件多，逐件标注太啰嗦）
  const handleRef = useCallback(
    (g: THREE.Group | null) => {
      registerRef(obj.id, g);
      g?.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
    },
    [obj.id, registerRef]
  );

  // plane 兼容：平躺已烘进几何，忽略对象 rotation 的 X 分量
  // （存量场景 JSON 里 plane 存的 -π/2 若再应用会被转两次）
  const rotation: [number, number, number] =
    obj.type === 'plane' ? [0, obj.rotation[1], 0] : obj.rotation;

  return (
    <group
      ref={handleRef}
      position={obj.position}
      rotation={rotation}
      scale={obj.scale}
      onClick={(e) => {
        e.stopPropagation();
        select(obj.id);
      }}
    >
      <ObjectContent obj={obj} selected={selected} />
    </group>
  );
}

// 角色的走位路径：折线（所有角色）+ 路径点小球（仅选中角色，可拖动）
function CharacterPaths({ registerRef }: { registerRef: (id: string, obj: THREE.Object3D | null) => void }) {
  const characters = usePrevizStore((s) => s.characters);
  const selectedId = usePrevizStore((s) => s.selectedId);
  const select = usePrevizStore((s) => s.select);

  return (
    <>
      {characters.map((char) => {
        if (char.path.length === 0) return null;
        const isCharSelected = selectedId === char.id || selectedId?.startsWith(`pp:${char.id}:`);
        const points = char.path.map((p) => p.position);
        return (
          <group key={`path-${char.id}`}>
            <Line
              points={points}
              color={isCharSelected ? '#f59e0b' : '#64748b'}
              lineWidth={isCharSelected ? 2 : 1}
              dashed={!isCharSelected}
              dashSize={0.2}
              gapSize={0.1}
            />
            {/* 路径点小球：点击选中后可拖拽（TransformControls 挂在小球上） */}
            {isCharSelected &&
              char.path.map((p, i) => {
                const pid = pathPointId(char.id, i);
                const isPointSelected = selectedId === pid;
                return (
                  <mesh
                    key={pid}
                    ref={(m) => registerRef(pid, m)}
                    position={p.position}
                    onClick={(e) => {
                      e.stopPropagation();
                      select(pid);
                    }}
                  >
                    <sphereGeometry args={[isPointSelected ? 0.12 : 0.08, 16, 12]} />
                    <meshStandardMaterial
                      color={isPointSelected ? '#f59e0b' : '#fbbf24'}
                      emissive={isPointSelected ? '#f59e0b' : '#000000'}
                      emissiveIntensity={0.4}
                    />
                  </mesh>
                );
              })}
          </group>
        );
      })}
    </>
  );
}

// 相机辅助可视化：起始机位小相机图标（圆锥朝向 startLook）+ 朝向线 + 起止机位点（可拖动）
function CameraHelper({
  cam,
  registerRef,
}: {
  cam: PrevizCamera;
  registerRef: (id: string, obj: THREE.Object3D | null) => void;
}) {
  const selectedId = usePrevizStore((s) => s.selectedId);
  const select = usePrevizStore((s) => s.select);
  const iconRef = useRef<THREE.Group>(null);

  const m = cam.move;
  const startPid = cameraPointId(cam.id, 'start');
  const endPid = cameraPointId(cam.id, 'end');

  // 相机图标朝向 startLook
  useEffect(() => {
    iconRef.current?.lookAt(new THREE.Vector3(...m.startLook));
  }, [m.startLook]);

  return (
    <group>
      {/* 起始机位相机图标：机身 + 镜头圆锥 */}
      <group
        ref={(g) => {
          iconRef.current = g;
          registerRef(startPid, g);
        }}
        position={m.startPos}
        onClick={(e) => {
          e.stopPropagation();
          select(startPid);
        }}
      >
        <mesh>
          <boxGeometry args={[0.24, 0.18, 0.32]} />
          <meshStandardMaterial
            color="#3b82f6"
            emissive={selectedId === startPid ? '#2563eb' : '#000000'}
            emissiveIntensity={0.4}
          />
        </mesh>
        <mesh position={[0, 0, 0.28]} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.12, 0.22, 16, 1, true]} />
          <meshStandardMaterial color="#60a5fa" side={THREE.DoubleSide} transparent opacity={0.7} />
        </mesh>
      </group>

      {/* 朝向线：startPos → startLook */}
      <Line points={[m.startPos, m.startLook]} color="#60a5fa" lineWidth={1} dashed dashSize={0.15} gapSize={0.1} />
      {/* 运镜线：startPos → endPos */}
      <Line points={[m.startPos, m.endPos]} color="#34d399" lineWidth={1} dashed dashSize={0.15} gapSize={0.1} />

      {/* 朝向目标点 */}
      <mesh position={m.startLook}>
        <sphereGeometry args={[0.05, 12, 8]} />
        <meshStandardMaterial color="#93c5fd" />
      </mesh>

      {/* 结束机位点（绿色，可拖动） */}
      <mesh
        ref={(mesh) => registerRef(endPid, mesh)}
        position={m.endPos}
        onClick={(e) => {
          e.stopPropagation();
          select(endPid);
        }}
      >
        <sphereGeometry args={[selectedId === endPid ? 0.14 : 0.1, 16, 12]} />
        <meshStandardMaterial
          color="#34d399"
          emissive={selectedId === endPid ? '#10b981' : '#000000'}
          emissiveIntensity={0.4}
        />
      </mesh>
    </group>
  );
}

// 相机视角驱动：预览时每帧用 sampleCameraPose(currentTime) 驱动主相机（getState 读取，不订阅 currentTime）
function CameraPreviewDriver() {
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    const { previewCameraId, cameras, characters, currentTime } = usePrevizStore.getState();
    if (!previewCameraId) return;
    const cam = cameras.find((c) => c.id === previewCameraId);
    if (!cam) return;
    const pose = sampleCameraPose(cam, currentTime, characters);
    camera.position.set(...pose.position);
    camera.lookAt(...pose.lookAt);
    if (camera instanceof THREE.PerspectiveCamera && camera.fov !== pose.fov) {
      camera.fov = pose.fov;
      camera.updateProjectionMatrix();
    }
  });
  return null;
}

export function Viewport3D() {
  const objects = usePrevizStore((s) => s.objects);
  const characters = usePrevizStore((s) => s.characters);
  const cameras = usePrevizStore((s) => s.cameras);
  const selectedCameraId = usePrevizStore((s) => s.selectedCameraId);
  const previewCameraId = usePrevizStore((s) => s.previewCameraId);
  const selectedId = usePrevizStore((s) => s.selectedId);
  const select = usePrevizStore((s) => s.select);
  const setPreviewCamera = usePrevizStore((s) => s.setPreviewCamera);
  const pathDrawMode = usePrevizStore((s) => s.pathDrawMode);
  const gizmoDragging = usePrevizStore((s) => s.gizmoDragging); // gizmo 拖拽时禁用轨道相机
  // 绘制模式的目标角色（选中的人偶）
  const drawCharId = pathDrawMode && selectedId?.startsWith('char-') ? selectedId : null;

  const [mode, setMode] = useState<TransformMode>('translate');
  // handleObjectChange 是空依赖 useCallback，通过 ref 读最新模式
  const modeRef = useRef<TransformMode>('translate');
  modeRef.current = mode;
  // 选中目标 id → three 对象（几何体 / 角色 group / 路径点小球 / 相机机位点）的引用表，供 TransformControls 挂载
  const objRefs = useRef(new Map<string, THREE.Object3D>());

  const registerRef = useCallback((id: string, obj: THREE.Object3D | null) => {
    if (obj) {
      objRefs.current.set(id, obj);
    } else {
      objRefs.current.delete(id);
    }
  }, []);

  // TransformControls 拖拽过程中实时把变换写回 store
  const handleObjectChange = useCallback(() => {
    const store = usePrevizStore.getState();
    const sid = store.selectedId;
    if (!sid) return;
    const obj3d = objRefs.current.get(sid);
    if (!obj3d) return;

    // 相机机位点：写回 startPos / endPos
    const cp = parseCameraPointId(sid);
    if (cp) {
      const pos: [number, number, number] = [obj3d.position.x, obj3d.position.y, obj3d.position.z];
      store.updateCameraMove(cp.camId, cp.point === 'start' ? { startPos: pos } : { endPos: pos });
      return;
    }

    // 路径点：只写回位置
    const pp = parsePathPointId(sid);
    if (pp) {
      store.updatePathPoint(pp.charId, pp.index, {
        position: [obj3d.position.x, obj3d.position.y, obj3d.position.z],
      });
      return;
    }

    // 角色：旋转模式只写朝向（并标记手动锁定，行走不再自动朝前）；
    // 移动模式写位置——有路径时写进当前播放头时刻的路径点，无路径时写基准位置
    if (sid.startsWith('char-')) {
      const char = store.characters.find((c) => c.id === sid);
      if (!char) return;
      if (modeRef.current === 'rotate') {
        store.updateCharacter(sid, { rotationY: obj3d.rotation.y, manualFacing: true });
        return;
      }
      if (char.path.length > 0) {
        if (!store.playing) {
          // 播放中不写路径点（播放头持续前进会刷出一串点）
          store.upsertPathPointAt(sid, store.currentTime, [obj3d.position.x, obj3d.position.y, obj3d.position.z]);
        }
      } else {
        store.updateCharacter(sid, {
          position: [obj3d.position.x, obj3d.position.y, obj3d.position.z],
        });
      }
      return;
    }

    // 几何体：写回完整变换
    store.updateObject(sid, {
      position: [obj3d.position.x, obj3d.position.y, obj3d.position.z],
      rotation: [obj3d.rotation.x, obj3d.rotation.y, obj3d.rotation.z],
      scale: [obj3d.scale.x, obj3d.scale.y, obj3d.scale.z],
    });
  }, []);

  // 计算当前选中目标应挂的 gizmo 配置
  const selectedObj3d = selectedId ? objRefs.current.get(selectedId) : undefined;
  let gizmoMode: TransformMode | null = null;
  let gizmoRotateYOnly = false;
  if (selectedId && selectedObj3d) {
    if (parseCameraPointId(selectedId)) {
      gizmoMode = 'translate'; // 相机机位点只能平移
    } else if (parseBoneId(selectedId)) {
      gizmoMode = null; // 骨骼不挂 gizmo：选中后用面板滑杆调整旋转
    } else if (parsePathPointId(selectedId)) {
      gizmoMode = 'translate'; // 路径点只能平移
    } else if (selectedId.startsWith('char-')) {
      const char = characters.find((c) => c.id === selectedId);
      if (mode === 'rotate') {
        gizmoMode = 'rotate';
        gizmoRotateYOnly = true; // 角色旋转只锁 Y 轴
      } else if (mode === 'translate' && char) {
        // 有走位路径时拖本体 = 在当前播放头时刻记录/更新路径点（见 handleObjectChange）
        gizmoMode = 'translate';
      }
    } else {
      gizmoMode = mode;
    }
  }

  const previewCam = cameras.find((c) => c.id === previewCameraId) ?? null;

  return (
    <div className="relative w-full h-full">
      <Canvas
        shadows
        camera={{ position: [8, 6, 8], fov: 50 }}
        onCreated={(state) =>
          // 登记渲染器/相机引用，供录制模块（P4 白片导出）使用
          registerPrevizViewport(state.gl, state.camera as THREE.PerspectiveCamera)
        }
        onPointerMissed={() => {
          // 姿态编辑模式下不响应落空点击（不退出编辑、不清除选中），退出编辑后恢复原逻辑
          if (usePrevizStore.getState().poseEditingCharId) return;
          select(null);
        }}
      >
        <color attach="background" args={['#1e293b']} />
        {/* 三点打光（免下载 Environment 的替代方案）：环境底光 + 半球天光 + 主方向光（投影）+ 背光补光 */}
        <ambientLight intensity={0.35} />
        <hemisphereLight args={['#cbd5e1', '#334155', 0.5]} />
        <directionalLight
          position={[10, 12, 8]}
          intensity={1.1}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-14}
          shadow-camera-right={14}
          shadow-camera-top={14}
          shadow-camera-bottom={-14}
          shadow-camera-far={60}
        />
        <directionalLight position={[-6, 8, -8]} intensity={0.3} />
        {/* 地面阴影承接垫（透明 shadowMaterial，只显示阴影，与 gridHelper 共存） */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.005, 0]} receiveShadow>
          <planeGeometry args={[60, 60]} />
          <shadowMaterial transparent opacity={0.3} />
        </mesh>
        {/* 地面参考网格 20x20 */}
        <gridHelper args={[20, 20, '#94a3b8', '#475569']} />

        {objects.map((obj) => (
          <SceneObject key={obj.id} obj={obj} registerRef={registerRef} />
        ))}

        {characters.map((char) => (
          <CharacterView key={char.id} char={char} registerRef={registerRef} />
        ))}

        {/* 路径绘制模式：透明地面接收点击，点击处为选中角色追加路径点 */}
        {drawCharId && (
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, 0.01, 0]}
            onClick={(e) => {
              e.stopPropagation();
              usePrevizStore.getState().appendDrawnPathPoint(drawCharId, [e.point.x, 0, e.point.z]);
            }}
          >
            <planeGeometry args={[100, 100]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        )}

        <CharacterPaths registerRef={registerRef} />

        {/* 相机辅助图标：相机视角下隐藏（正在用该相机看场景） */}
        {!previewCameraId &&
          cameras.map((cam) =>
            cam.id === selectedCameraId ? (
              <CameraHelper key={cam.id} cam={cam} registerRef={registerRef} />
            ) : null
          )}

        {/* 相机视角驱动（previewCameraId 为空时不做任何事） */}
        <CameraPreviewDriver />

        {/* 选中目标后挂变换控制器（makeDefault 的 OrbitControls 会在拖拽时自动禁用） */}
        {selectedObj3d && gizmoMode && !previewCameraId && (
          <TransformControls
            object={selectedObj3d}
            mode={gizmoMode}
            showX={gizmoRotateYOnly ? false : true}
            showZ={gizmoRotateYOnly ? false : true}
            onObjectChange={handleObjectChange}
            onMouseDown={() => usePrevizStore.getState().setGizmoDragging(true)}
            onMouseUp={() => usePrevizStore.getState().setGizmoDragging(false)}
          />
        )}
        {/* 相机视角下禁用自由视角控制；骨骼选中/拖拽期间也禁用（防止手势被相机抢走） */}
        {!previewCameraId && (
          <OrbitControls makeDefault enabled={!gizmoDragging} />
        )}
      </Canvas>

      {/* 变换模式切换工具条（相机视角下隐藏） */}
      {!previewCameraId && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 flex gap-1 bg-slate-800/80 rounded-lg p-1">
          {(Object.keys(MODE_LABELS) as TransformMode[]).map((m) => (
            <button
              key={m}
              className={`px-3 py-1 text-xs rounded-md transition-colors cursor-pointer ${
                mode === m ? 'bg-blue-500 text-white' : 'text-slate-300 hover:bg-slate-700'
              }`}
              onClick={() => setMode(m)}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
      )}

      {/* 相机视角：悬浮提示 + 返回自由视角 */}
      {previewCam && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-slate-800/80 rounded-lg px-3 py-1.5">
          <span className="text-xs text-slate-200">相机视角：{previewCam.name}</span>
          <button
            className="px-2 py-0.5 text-xs text-white bg-blue-500 hover:bg-blue-600 rounded transition-colors cursor-pointer"
            onClick={() => setPreviewCamera(null)}
          >
            返回自由视角
          </button>
        </div>
      )}
    </div>
  );
}
