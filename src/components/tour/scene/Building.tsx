"use client";

import { Instance, Instances, RoundedBoxGeometry } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { CORRIDOR_END_Z } from "../path";
import { Ball, C, Cyl, RBox, clamp01, cursor, spring, stepSpring, toon } from "./kit";

const HALF_W = 12;
const HEIGHT = 7;
const DEPTH = -CORRIDOR_END_Z + 0.6;
const WIN_X = [4, 7.2, 10.3].flatMap((x) => [x, -x]);
const WINDOWS = [...WIN_X.map((x) => [x, 1.8] as const), ...WIN_X.map((x) => [x, 5.2] as const)];

/** The school seen from the courtyard. Front wall leaves a door-sized hole the camera flies through. */
export function Building() {
  return (
    <group>
      {/* facade pieces around the door hole (x ±1.4, y 0..3.2) */}
      <RBox size={[HALF_W - 1.4, HEIGHT, 0.4]} radius={0.05} color={C.wall} position={[-(HALF_W + 1.4) / 2, HEIGHT / 2, -0.2]} />
      <RBox size={[HALF_W - 1.4, HEIGHT, 0.4]} radius={0.05} color={C.wall} position={[(HALF_W + 1.4) / 2, HEIGHT / 2, -0.2]} />
      <RBox size={[2.8, HEIGHT - 3.2, 0.4]} radius={0.05} color={C.wall} position={[0, (HEIGHT + 3.2) / 2, -0.2]} />
      {/* shell: sides + roof (single-sided, so invisible from inside) */}
      {[-1, 1].map((s) => (
        <RBox key={s} size={[0.4, HEIGHT, DEPTH]} radius={0.05} color={C.wall} position={[s * HALF_W, HEIGHT / 2, -DEPTH / 2]} />
      ))}
      <RBox size={[HALF_W * 2 + 0.8, 0.4, DEPTH + 0.6]} radius={0.1} color={C.trim} position={[0, HEIGHT + 0.2, -DEPTH / 2 + 0.3]} />
      <RBox size={[HALF_W * 2 + 1.2, 0.55, 0.8]} radius={0.2} color={C.trim} position={[0, HEIGHT + 0.25, 0.25]} />
      <RBox size={[HALF_W * 2 + 0.6, 0.6, 0.6]} radius={0.12} color="#ffd29a" position={[0, 0.3, 0.05]} />
      {[-1, 1].map((s) => (
        <RBox key={s} size={[0.9, HEIGHT, 0.7]} radius={0.16} color={C.white} position={[s * HALF_W, HEIGHT / 2, 0.05]} />
      ))}
      {/* pediment: a triangular prism */}
      <mesh material={toon(C.trim)} position={[0, HEIGHT + 0.95, 0.15]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.5, 1, 0.4]} castShadow>
        <cylinderGeometry args={[2.6, 2.6, 0.7, 3]} />
      </mesh>
      <Windows />
      <FrontDoors />
      <Clock />
      <Cupola />
      <RBox size={[4.4, 0.22, 1.4]} radius={0.08} color="#ffd29a" position={[0, 0.11, 0.9]} />
    </group>
  );
}

function Windows() {
  return (
    <group position={[0, 0, 0.02]}>
      <Instances material={toon(C.white)} receiveShadow>
        <RoundedBoxGeometry args={[2.05, 1.85, 0.16]} radius={0.1} smoothness={2} />
        {WINDOWS.map(([x, y]) => (
          <Instance key={`${x}:${y}`} position={[x, y, 0]} />
        ))}
      </Instances>
      <Instances material={toon(C.window)}>
        <RoundedBoxGeometry args={[1.7, 1.5, 0.2]} radius={0.08} smoothness={2} />
        {WINDOWS.map(([x, y]) => (
          <Instance key={`${x}:${y}`} position={[x, y, 0.02]} />
        ))}
      </Instances>
      <Instances material={toon(C.white)}>
        <boxGeometry args={[0.1, 1.5, 0.24]} />
        {WINDOWS.map(([x, y]) => (
          <Instance key={`${x}:${y}`} position={[x, y, 0.03]} />
        ))}
      </Instances>
      <Instances material={toon(C.trim)} castShadow>
        <RoundedBoxGeometry args={[1.9, 0.38, 0.45]} radius={0.1} smoothness={2} />
        {WIN_X.map((x) => (
          <Instance key={x} position={[x, 0.82, 0.25]} />
        ))}
      </Instances>
      <Instances material={toon(C.white)} limit={64}>
        <sphereGeometry args={[0.13, 10, 8]} />
        {WIN_X.flatMap((x) =>
          [-0.6, -0.2, 0.2, 0.6].map((dx, i) => (
            <Instance key={`${x}:${dx}`} position={[x + dx, 1.08, 0.28]} color={["#ff6fae", C.yellow, "#ff6fae", C.orange][i]} />
          )),
        )}
      </Instances>
    </group>
  );
}

/** Double doors that swing in (with a bounce) once the camera is close. */
function FrontDoors() {
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);
  const open = useRef(spring(0));
  useFrame((state, dt) => {
    const near = state.camera.position.z < 8 ? 1 : 0;
    const a = stepSpring(open.current, near * 1.55, dt, 70, 6);
    if (left.current) left.current.rotation.y = a;
    if (right.current) right.current.rotation.y = -a;
  });
  return (
    <group>
      {[-1, 1].map((s) => (
        <RBox key={s} size={[0.32, 3.45, 0.55]} radius={0.1} color={C.trim} position={[s * 1.55, 1.72, 0.05]} />
      ))}
      <RBox size={[3.45, 0.38, 0.55]} radius={0.12} color={C.trim} position={[0, 3.4, 0.05]} />
      {([-1, 1] as const).map((s) => (
        <group key={s} ref={s < 0 ? left : right} position={[s * 1.38, 0, 0]}>
          <RBox size={[1.34, 3.15, 0.14]} radius={0.06} color={C.blue} position={[-s * 0.69, 1.6, 0]} cast />
          <Ball r={0.3} color={C.window} position={[-s * 0.69, 2.35, 0.06]} scale={[1, 1, 0.3]} />
          <Ball r={0.07} color={C.yellow} position={[-s * 1.18, 1.45, 0.1]} detail={10} />
        </group>
      ))}
    </group>
  );
}

/** Clock above the door shows the visitor's real time. */
function Clock() {
  const hour = useRef<THREE.Group>(null);
  const minute = useRef<THREE.Group>(null);
  useFrame(() => {
    const d = new Date();
    const m = d.getMinutes() + d.getSeconds() / 60;
    if (minute.current) minute.current.rotation.z = -(m / 60) * Math.PI * 2;
    if (hour.current) hour.current.rotation.z = -(((d.getHours() % 12) + m / 60) / 12) * Math.PI * 2;
  });
  return (
    <group position={[0, 5.15, 0.05]}>
      <Cyl r={0.85} h={0.14} color={C.white} rotation-x={Math.PI / 2} seg={32} />
      <mesh material={toon(C.trim)}>
        <torusGeometry args={[0.88, 0.09, 8, 32]} />
      </mesh>
      <group ref={hour} position={[0, 0, 0.1]}>
        <RBox size={[0.09, 0.45, 0.04]} radius={0.02} color={C.ink} position={[0, 0.2, 0]} />
      </group>
      <group ref={minute} position={[0, 0, 0.13]}>
        <RBox size={[0.06, 0.66, 0.04]} radius={0.02} color={C.ink} position={[0, 0.3, 0]} />
      </group>
      <Ball r={0.07} color={C.yellow} position={[0, 0, 0.16]} detail={10} />
    </group>
  );
}

const BELL_PROFILE: [number, number][] = [
  [0, 0.4],
  [0.13, 0.39],
  [0.21, 0.32],
  [0.25, 0.15],
  [0.28, -0.05],
  [0.35, -0.2],
  [0.45, -0.3],
  [0.47, -0.36],
  [0, -0.34],
];

/** Bell tower. Click the bell: it swings, pops and sends out rings. */
function Cupola() {
  const bell = useRef<THREE.Group>(null);
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  const live = useRef({ swing: spring(0), pop: spring(1), ringT: -1 });
  const bellGeo = useMemo(() => new THREE.LatheGeometry(BELL_PROFILE.map(([x, y]) => new THREE.Vector2(x, y)), 24), []);
  const ringMats = useMemo(() => [0, 1, 2].map(() => new THREE.MeshBasicMaterial({ color: C.yellow, transparent: true, opacity: 0, depthWrite: false })), []);

  useFrame((state, dt) => {
    const s = live.current;
    const t = state.clock.elapsedTime;
    const a = stepSpring(s.swing, 0, dt, 55, 2);
    const p = stepSpring(s.pop, 1, dt, 320, 8);
    if (bell.current) {
      bell.current.rotation.z = Math.sin(t * 1.4) * 0.04 + a;
      bell.current.scale.setScalar(p);
    }
    if (s.ringT < 0) return;
    s.ringT += Math.min(dt, 1 / 30);
    ringMats.forEach((m, i) => {
      const k = clamp01((s.ringT - i * 0.2) / 0.9);
      m.opacity = k > 0 && k < 1 ? (1 - k) * 0.85 : 0;
      rings.current[i]?.scale.setScalar(0.6 + k * 2.8);
    });
    if (s.ringT > 1.6) s.ringT = -1;
  });

  const ring = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const s = live.current;
    s.swing.v += s.swing.x > 0 ? -7 : 7;
    s.pop.v += 5;
    s.ringT = 0;
  };

  const hover = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    cursor(true)();
    live.current.swing.v += 1.6;
  };

  return (
    <group position={[0, HEIGHT + 1.5, -1.6]} onClick={ring} onPointerOver={hover} onPointerOut={cursor(false)}>
      <RBox size={[2.5, 1.2, 2.5]} radius={0.12} color={C.wall} position={[0, -0.55, 0]} />
      <RBox size={[2.8, 0.3, 2.8]} radius={0.1} color={C.white} position={[0, 0.15, 0]} />
      {[
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1],
      ].map(([x, z]) => (
        <RBox key={`${x}${z}`} size={[0.36, 2, 0.36]} radius={0.12} color={C.wall} position={[x * 1.1, 1.3, z * 1.1]} cast />
      ))}
      <RBox size={[2.9, 0.3, 2.9]} radius={0.1} color={C.trim} position={[0, 2.4, 0]} />
      <mesh material={toon(C.trim)} position={[0, 3.25, 0]} rotation-y={Math.PI / 4} castShadow>
        <coneGeometry args={[2.1, 1.5, 4]} />
      </mesh>
      <Ball r={0.18} color={C.yellow} position={[0, 4.1, 0]} />
      <group ref={bell} position={[0, 2.2, 0]}>
        <mesh geometry={bellGeo} material={toon(C.yellow)} position={[0, -0.55, 0]} castShadow />
        <Ball r={0.11} color={C.orange} position={[0, -0.95, 0]} detail={12} />
      </group>
      {ringMats.map((m, i) => (
        <mesh
          key={i}
          ref={(el) => {
            rings.current[i] = el;
          }}
          material={m}
          position={[0, 1.45, 1.2]}
        >
          <torusGeometry args={[0.6, 0.04, 6, 32]} />
        </mesh>
      ))}
    </group>
  );
}
