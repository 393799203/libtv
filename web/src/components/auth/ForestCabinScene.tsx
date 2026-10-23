import { useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

function Rain({ count, reducedMotion }: { count: number; reducedMotion: boolean }) {
  const positions = useMemo(() => {
    const values = new Float32Array(count * 6);
    for (let i = 0; i < count; i += 1) {
      const index = i * 6;
      values[index] = (Math.random() - 0.5) * 20;
      values[index + 1] = Math.random() * 10;
      values[index + 2] = -8 + Math.random() * 12;
      values[index + 3] = values[index];
      values[index + 4] = values[index + 1] - (0.16 + Math.random() * 0.18);
      values[index + 5] = values[index + 2];
    }
    return values;
  }, [count]);

  const geometry = useMemo(() => {
    const value = new THREE.BufferGeometry();
    value.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return value;
  }, [positions]);

  useFrame((_, delta) => {
    if (reducedMotion) return;
    const attribute = geometry.getAttribute('position') as THREE.BufferAttribute;
    const array = attribute.array as Float32Array;
    const step = Math.min(delta, 0.05);
    for (let i = 0; i < count; i += 1) {
      const index = i * 6;
      const speed = step * (7.2 + (i % 8) * 0.34);
      array[index + 1] -= speed;
      array[index] -= step * 0.5;
      if (array[index + 1] < 0) {
        array[index + 1] = 9 + Math.random() * 2.5;
        array[index] = (Math.random() - 0.5) * 20;
        array[index + 2] = -8 + Math.random() * 12;
      }
      array[index + 3] = array[index] + 0.035;
      array[index + 4] = array[index + 1] - (0.19 + (i % 5) * 0.018);
      array[index + 5] = array[index + 2];
    }
    attribute.needsUpdate = true;
  });

  return (
    <lineSegments geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial
        color="#b9dce5"
        transparent
        opacity={0.54}
        depthWrite={false}
      />
    </lineSegments>
  );
}

function ChimneySmoke() {
  const groupRef = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.getElapsedTime();
    groupRef.current.position.y = 3.62 + Math.sin(t * 0.7) * 0.05;
    groupRef.current.position.x = 1.25 + Math.sin(t * 0.34) * 0.08;
  });

  return (
    <group ref={groupRef}>
      {[0, 1, 2, 3, 4].map((index) => (
        <mesh
          key={index}
          position={[index * 0.13, index * 0.3, -0.64]}
          scale={0.2 + index * 0.055}
        >
          <sphereGeometry args={[1, 8, 8]} />
          <meshBasicMaterial color="#8c9aa0" transparent opacity={0.055 - index * 0.007} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

function WindowFigure() {
  const figureRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (!figureRef.current) return;
    const t = clock.getElapsedTime();
    figureRef.current.position.y = -0.08 + Math.sin(t * 0.72) * 0.008;
    figureRef.current.scale.y = 1 + Math.sin(t * 0.72 + 0.6) * 0.008;
  });

  return (
    <group ref={figureRef} position={[0.02, -0.08, 0.026]}>
      {/* 暖窗上的背影：头、肩、躯干三层轮廓，尺寸刻意压在窗框以内。 */}
      <mesh position={[0.025, 0.19, 0]} scale={[0.82, 1.08, 1]}>
        <sphereGeometry args={[0.095, 16, 12]} />
        <meshBasicMaterial color="#20120c" toneMapped={false} />
      </mesh>
      <mesh position={[0, -0.015, 0]} scale={[1.32, 0.72, 1]}>
        <sphereGeometry args={[0.15, 16, 10]} />
        <meshBasicMaterial color="#20120c" toneMapped={false} />
      </mesh>
      <mesh position={[0.012, -0.18, -0.002]}>
        <boxGeometry args={[0.22, 0.3, 0.012]} />
        <meshBasicMaterial color="#20120c" toneMapped={false} />
      </mesh>
      <mesh position={[-0.115, 0.015, 0]} rotation={[0, 0, -0.18]}>
        <boxGeometry args={[0.07, 0.24, 0.01]} />
        <meshBasicMaterial color="#20120c" toneMapped={false} />
      </mesh>
      <mesh position={[0.12, 0.01, 0]} rotation={[0, 0, 0.15]}>
        <boxGeometry args={[0.065, 0.23, 0.01]} />
        <meshBasicMaterial color="#20120c" toneMapped={false} />
      </mesh>
    </group>
  );
}

function Tree({
  x,
  z,
  scale = 1,
  shade = '#07110f',
}: {
  x: number;
  z: number;
  scale?: number;
  shade?: string;
}) {
  return (
    <group position={[x, 0, z]} scale={scale}>
      <mesh position={[0, 1.1, 0]}>
        <cylinderGeometry args={[0.13, 0.2, 2.2, 6]} />
        <meshStandardMaterial color="#17120e" roughness={0.95} />
      </mesh>
      <mesh position={[0, 2.05, 0]} rotation={[0, 0.25, 0]}>
        <coneGeometry args={[1.05, 2.4, 7]} />
        <meshStandardMaterial color={shade} roughness={0.9} />
      </mesh>
      <mesh position={[0, 3.05, 0]} rotation={[0, -0.18, 0]}>
        <coneGeometry args={[0.82, 2.15, 7]} />
        <meshStandardMaterial color={shade} roughness={0.9} />
      </mesh>
      <mesh position={[0, 3.85, 0]} rotation={[0, 0.12, 0]}>
        <coneGeometry args={[0.56, 1.65, 7]} />
        <meshStandardMaterial color={shade} roughness={0.9} />
      </mesh>
    </group>
  );
}

function Cabin() {
  const candleRef = useRef<THREE.PointLight>(null);
  const innerGlowRef = useRef<THREE.PointLight>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const flicker = 1 + Math.sin(t * 7.3) * 0.08 + Math.sin(t * 13.8) * 0.045 + Math.sin(t * 2.1) * 0.025;
    if (candleRef.current) candleRef.current.intensity = 5.6 * flicker;
    if (innerGlowRef.current) innerGlowRef.current.intensity = 1.8 * flicker;
  });

  return (
    <group position={[0, 0.2, 0.3]}>
      <mesh position={[0, 1.25, 0]} castShadow={false}>
        <boxGeometry args={[4.2, 2.5, 3]} />
        <meshStandardMaterial color="#493325" roughness={0.82} metalness={0.02} />
      </mesh>

      <mesh position={[-1.35, 2.35, 0]} rotation={[0, 0, 0.58]}>
        <boxGeometry args={[3.2, 0.18, 3.9]} />
        <meshStandardMaterial color="#27201b" roughness={0.86} />
      </mesh>
      <mesh position={[1.35, 2.35, 0]} rotation={[0, 0, -0.58]}>
        <boxGeometry args={[3.2, 0.18, 3.9]} />
        <meshStandardMaterial color="#27201b" roughness={0.86} />
      </mesh>

      <mesh position={[1.25, 2.9, -0.65]}>
        <boxGeometry args={[0.42, 1.6, 0.55]} />
        <meshStandardMaterial color="#201914" roughness={0.9} />
      </mesh>

      <mesh position={[0, 0.86, 1.515]}>
        <boxGeometry args={[0.68, 1.72, 0.08]} />
        <meshStandardMaterial color="#22160e" roughness={0.78} />
      </mesh>
      <mesh position={[0.06, 0.9, 1.565]}>
        <sphereGeometry args={[0.035, 8, 8]} />
        <meshStandardMaterial color="#d8a35b" emissive="#8b4d14" emissiveIntensity={0.8} />
      </mesh>

      {[-1.22, 1.22].map((x) => (
        <group key={x} position={[x, 1.43, 1.515]}>
          <mesh>
            <planeGeometry args={[0.82, 0.86]} />
            <meshBasicMaterial color="#ffc66f" toneMapped={false} />
          </mesh>
          <mesh position={[0, 0, -0.01]}>
            <planeGeometry args={[1.15, 1.2]} />
            <meshBasicMaterial color="#ff8a2a" transparent opacity={0.13} depthWrite={false} toneMapped={false} />
          </mesh>
          <mesh position={[0, 0, 0.012]}>
            <boxGeometry args={[0.05, 0.78, 0.03]} />
            <meshStandardMaterial color="#3a2616" />
          </mesh>
          <mesh position={[0, 0, 0.013]}>
            <boxGeometry args={[0.74, 0.05, 0.03]} />
            <meshStandardMaterial color="#3a2616" />
          </mesh>
          {x > 0 && <WindowFigure />}
        </group>
      ))}

      <mesh position={[0, 0.07, 1.95]}>
        <boxGeometry args={[5, 0.16, 1.25]} />
        <meshStandardMaterial color="#35251a" roughness={0.68} />
      </mesh>

      <mesh position={[0, 0.015, 3.2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[5.5, 3.3]} />
        <meshBasicMaterial color="#ad551c" transparent opacity={0.1} depthWrite={false} toneMapped={false} />
      </mesh>

      <pointLight
        ref={candleRef}
        position={[0.15, 1.45, 2.3]}
        color="#ff9f43"
        intensity={7.2}
        distance={10}
        decay={2}
      />
      <pointLight
        ref={innerGlowRef}
        position={[0, 1.55, 0.45]}
        color="#ffbe68"
        intensity={2.4}
        distance={4.5}
        decay={2}
      />
      <ChimneySmoke />
    </group>
  );
}

function CameraDrift({ reducedMotion, wide }: { reducedMotion: boolean; wide: boolean }) {
  useFrame(({ camera, clock }) => {
    if (reducedMotion) return;
    const t = clock.getElapsedTime();
    camera.position.x = 0.18 + Math.sin(t * 0.075) * (wide ? 0.34 : 0.2);
    camera.position.y = (wide ? 3.05 : 2.9) + Math.sin(t * 0.11) * 0.07;
    camera.position.z = (wide ? 12.2 : 10.9) + Math.cos(t * 0.065) * 0.3;
    camera.lookAt(wide ? -0.55 : -0.08, 1.45, 0);
  });
  return null;
}

function SceneWorld({ rainCount, reducedMotion }: { rainCount: number; reducedMotion: boolean }) {
  const width = useThree((state) => state.size.width);
  const wide = width >= 768;
  const offsetX = wide ? -1.5 : 0;

  return (
    <>
      <mesh position={[0, -0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[42, 28]} />
        <meshStandardMaterial color="#101917" roughness={0.48} metalness={0.1} />
      </mesh>

      <group position={[offsetX, 0.12, 0]} scale={wide ? 1.22 : 1.08}>
        <Cabin />
        <Tree x={-5.2} z={-1.4} scale={1.55} shade="#102a20" />
        <Tree x={5.1} z={-1.8} scale={1.7} shade="#0e271e" />
        <Tree x={-3.8} z={-4.5} scale={1.25} shade="#112c22" />
        <Tree x={3.8} z={-4.8} scale={1.35} shade="#0d251c" />
        <Tree x={-7.1} z={2} scale={1.2} shade="#0a1c16" />
        <Tree x={7.2} z={1.7} scale={1.25} shade="#0a1c16" />
        <Tree x={-1.9} z={-5.8} scale={1.05} shade="#10281f" />
        <Tree x={-4.6} z={3.6} scale={1.55} shade="#0b1f18" />
        <Tree x={4.7} z={4.1} scale={1.5} shade="#091a14" />

        <mesh position={[-2.7, 0.05, 2.8]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[1.45, 24]} />
          <meshStandardMaterial color="#182327" roughness={0.18} metalness={0.32} />
        </mesh>
      </group>

      <Rain count={rainCount} reducedMotion={reducedMotion} />
      <CameraDrift reducedMotion={reducedMotion} wide={wide} />
    </>
  );
}

export default function ForestCabinScene() {
  const reducedMotion = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );
  const rainCount = typeof window === 'undefined' || window.innerWidth < 768 ? 360 : 720;

  return (
    <Canvas
      dpr={[1, 1.35]}
      frameloop={reducedMotion ? 'demand' : 'always'}
      camera={{ position: [0.18, 3.05, 12.2], fov: 38, near: 0.1, far: 70 }}
      gl={{ antialias: false, alpha: false, powerPreference: 'low-power' }}
      onCreated={({ gl }) => gl.setClearColor('#05080b')}
    >
      <color attach="background" args={['#05080b']} />
      <fogExp2 attach="fog" args={['#071016', 0.047]} />
      <ambientLight color="#9bb4bc" intensity={0.52} />
      <directionalLight position={[-5, 8, 5]} color="#a8ced8" intensity={1.05} />
      <directionalLight position={[5, 4, -3]} color="#326273" intensity={0.5} />

      <SceneWorld rainCount={rainCount} reducedMotion={reducedMotion} />
    </Canvas>
  );
}
