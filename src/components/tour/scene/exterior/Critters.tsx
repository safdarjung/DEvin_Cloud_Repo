"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { ROOM_ORDER, roomToWorld } from "../../path";
import { C, canvasTexture, mat } from "../kit";

type V3 = [number, number, number];

/* ---------- paper plane: glides an ellipse, banking into the turn ---------- */

export function PaperPlane({ centre, radius, speed = 0.5, phase = 0 }: { centre: V3; radius: [number, number]; speed?: number; phase?: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => {
    const g = ref.current;
    if (!g) return;
    const a = state.clock.elapsedTime * speed + phase;
    const [rx, rz] = radius;
    g.position.set(centre[0] + Math.cos(a) * rx, centre[1] + Math.sin(a * 2) * 0.15, centre[2] + Math.sin(a) * rz);
    g.rotation.set(0, Math.atan2(-Math.sin(a) * rx, Math.cos(a) * rz), 0.45);
  });
  return (
    <group ref={ref}>
      <mesh material={mat(C.white)} rotation-x={Math.PI / 2} scale={[1, 1, 0.18]} castShadow>
        <coneGeometry args={[0.14, 0.42, 3]} />
      </mesh>
    </group>
  );
}

/* ---------- butterflies: flapping wings on a lazy figure-of-eight ---------- */

const wingMats = new Map<string, THREE.MeshBasicMaterial>();
const wing = (c: string) => {
  let m = wingMats.get(c);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide });
    wingMats.set(c, m);
  }
  return m;
};

function Butterfly({ centre, colour, seed }: { centre: V3; colour: string; seed: number }) {
  const ref = useRef<THREE.Group>(null);
  const l = useRef<THREE.Mesh>(null);
  const r = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime * 0.6 + seed;
    if (ref.current) {
      ref.current.position.set(centre[0] + Math.sin(t) * 2.2, centre[1] + Math.sin(t * 2.3) * 0.5, centre[2] + Math.sin(t * 2) * 1.2);
      ref.current.rotation.y = Math.cos(t) > 0 ? 1.2 : -1.9;
    }
    const f = Math.sin(state.clock.elapsedTime * 22 + seed) * 1.1;
    if (l.current) l.current.rotation.y = f;
    if (r.current) r.current.rotation.y = -f;
  });
  return (
    <group ref={ref} scale={0.9}>
      <mesh ref={l} material={wing(colour)}>
        <circleGeometry args={[0.13, 8, 0, Math.PI]} />
      </mesh>
      <mesh ref={r} material={wing(colour)} rotation-z={Math.PI}>
        <circleGeometry args={[0.13, 8, 0, Math.PI]} />
      </mesh>
    </group>
  );
}

export function Butterflies({ around }: { around: V3[] }) {
  const colours = [C.yellow, "#ff6fae", C.purple, C.orange];
  return (
    <>
      {around.map((c, i) => (
        <Butterfly key={i} centre={c} colour={colours[i % colours.length]} seed={i * 2.7} />
      ))}
    </>
  );
}

/* ---------- birds: a small V of flappers drifting across the sky ---------- */

export function Birds({ y = 15, z = -35, speed = 1.2, phase = 0 }: { y?: number; z?: number; speed?: number; phase?: number }) {
  const flock = useRef<THREE.Group>(null);
  const wings = useRef<(THREE.Group | null)[]>([]);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (flock.current) {
      flock.current.position.x = (((t * speed + phase) % 90) + 90) % 90 - 45;
      flock.current.position.y = y + Math.sin(t * 0.7) * 0.5;
    }
    wings.current.forEach((w, i) => {
      if (w) w.rotation.z = Math.sin(t * 9 + i) * 0.5;
    });
  });
  return (
    <group ref={flock} position={[0, y, z]}>
      {[
        [0, 0, 0],
        [-0.9, -0.3, 0.6],
        [-0.9, -0.3, -0.6],
      ].map(([bx, by, bz], i) => (
        <group key={i} position={[bx, by, bz]} rotation-y={Math.PI / 2}>
          {[-1, 1].map((s) => (
            <group
              key={s}
              ref={(el) => {
                wings.current[i * 2 + (s > 0 ? 1 : 0)] = el;
              }}
              scale={[s, 1, 1]}
            >
              <mesh material={mat(C.ink)} position={[0.22, 0, 0]} rotation-z={0.25}>
                <boxGeometry args={[0.42, 0.04, 0.12]} />
              </mesh>
            </group>
          ))}
        </group>
      ))}
    </group>
  );
}

/* ---------- dust motes drifting up through the sunlight in every room ---------- */

const MOTES_PER_ROOM = 26;
/** Soft round sprite: a bare point is a hard square. */
const moteTexture = () =>
  canvasTexture("mote", 32, 32, (g) => {
    const r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    r.addColorStop(0, "rgba(255,255,255,1)");
    r.addColorStop(0.35, "rgba(255,255,255,0.55)");
    r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, 32, 32);
  });

export function DustMotes() {
  const points = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const out = new Float32Array(ROOM_ORDER.length * MOTES_PER_ROOM * 3);
    let i = 0;
    for (const key of ROOM_ORDER) {
      for (let n = 0; n < MOTES_PER_ROOM; n++) {
        const h = (k: number) => {
          const x = Math.sin((i + n) * 12.9898 + k * 78.233) * 43758.5453;
          return x - Math.floor(x);
        };
        const [x, y, z] = roomToWorld(key, [-1 + h(1) * 5, 0.4 + h(2) * 2.8, -3 + h(3) * 6]);
        out.set([x, y, z], (i * MOTES_PER_ROOM + n) * 3);
      }
      i++;
    }
    return out;
  }, []);
  const base = useRef<Float32Array | null>(null);

  useFrame((state) => {
    const attr = points.current?.geometry.attributes.position;
    if (!attr) return;
    const rest = (base.current ??= Float32Array.from(attr.array));
    const t = state.clock.elapsedTime;
    for (let i = 0; i < attr.count; i++) {
      const y0 = rest[i * 3 + 1];
      attr.setY(i, 0.4 + ((y0 - 0.4 + t * 0.08 * (1 + (i % 3) * 0.4)) % 2.9));
      attr.setX(i, rest[i * 3] + Math.sin(t * 0.5 + i) * 0.12);
    }
    attr.needsUpdate = true;
  });

  return (
    <points ref={points} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#fff6d8" map={moteTexture()} size={0.085} sizeAttenuation transparent opacity={0.7} depthWrite={false} toneMapped={false} />
    </points>
  );
}
