import { useCallback, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Line, OrbitControls, TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  usePrevizStore,
  pathPointId,
  parsePathPointId,
  cameraPointId,
  parseCameraPointId,
} from './previzStore';
import { CharacterView } from './CharacterView';
import { sampleCameraPose } from './cameraRig';
import { registerPrevizViewport } from './recorder';
import type { PrevizCamera, PrevizObject, PrevizObjectType } from './types';

// TransformControls 的三种拖拽模式
type TransformMode = 'translate' | 'rotate' | 'scale';

const MODE_LABELS: Record<TransformMode, string> = {
  translate: '移动',
  rotate: '旋转',
  scale: '缩放',
};

// 每种几何体类型对应的 three 几何体（墙用薄方块、平面用单面片，尺寸差异由对象 scale 承担）
function ObjectGeometry({ type }: { type: PrevizObjectType }) {
  switch (type) {
    case 'box':
    case 'wall':
      return <boxGeometry args={[1, 1, 1]} />;
    case 'cylinder':
      return <cylinderGeometry args={[0.5, 0.5, 1, 32]} />;
    case 'sphere':
      return <sphereGeometry args={[0.5, 32, 16]} />;
    case 'plane':
      return <planeGeometry args={[1, 1]} />;
  }
}

// 单个场景对象：灰色系白模材质，选中时蓝色高亮
function SceneObject({
  obj,
  registerRef,
}: {
  obj: PrevizObject;
  registerRef: (id: string, mesh: THREE.Object3D | null) => void;
}) {
  const selected = usePrevizStore((s) => s.selectedId === obj.id);
  const select = usePrevizStore((s) => s.select);

  return (
    <mesh
      ref={(mesh) => registerRef(obj.id, mesh)}
      position={obj.position}
      rotation={obj.rotation}
      scale={obj.scale}
      onClick={(e) => {
        e.stopPropagation();
        select(obj.id);
      }}
    >
      <ObjectGeometry type={obj.type} />
      <meshStandardMaterial
        color={obj.color}
        emissive={selected ? '#2563eb' : '#000000'}
        emissiveIntensity={selected ? 0.5 : 0}
        side={THREE.DoubleSide}
      />
    </mesh>
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
  // 绘制模式的目标角色（选中的人偶）
  const drawCharId = pathDrawMode && selectedId?.startsWith('char-') ? selectedId : null;

  const [mode, setMode] = useState<TransformMode>('translate');
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

    // 角色：有路径时，拖拽本体 = 在「当前播放头时刻」记录/更新路径点；
    // 无路径时，写回基准位置。朝向（rotationY）始终写回
    if (sid.startsWith('char-')) {
      const char = store.characters.find((c) => c.id === sid);
      if (char && char.path.length > 0) {
        if (!store.playing) {
          // 播放中不写路径点（播放头持续前进会刷出一串点）
          store.upsertPathPointAt(sid, store.currentTime, [obj3d.position.x, obj3d.position.y, obj3d.position.z]);
        }
      } else {
        store.updateCharacter(sid, {
          position: [obj3d.position.x, obj3d.position.y, obj3d.position.z],
        });
      }
      store.updateCharacter(sid, { rotationY: obj3d.rotation.y });
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
        camera={{ position: [8, 6, 8], fov: 50 }}
        onCreated={(state) =>
          // 登记渲染器/相机引用，供录制模块（P4 白片导出）使用
          registerPrevizViewport(state.gl, state.camera as THREE.PerspectiveCamera)
        }
        onPointerMissed={() => select(null)}
      >
        <color attach="background" args={['#1e293b']} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[10, 12, 8]} intensity={1.2} />
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
        {/* 相机视角下禁用自由视角控制 */}
        {!previewCameraId && <OrbitControls makeDefault />}
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
