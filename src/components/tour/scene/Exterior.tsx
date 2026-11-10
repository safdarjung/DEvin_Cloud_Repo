"use client";

import { Instance, Instances, RoundedBoxGeometry } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { GATE_Z, ROOM_ORDER, STOPS } from "../path";
import { Ball, C, Cyl, Label, RBox, clamp01, spring, stepSpring, toon, useProgress } from "./kit";

export function Exterior({ accents }: { accents: readonly string[] }) {
  return (
    <group>
      <Ground />
      <Fence />
      <Gate />
      {TREES.map((t, i) => (
        <Tree key={i} position={t.p} scale={t.s} tint={t.c} seed={i} />
      ))}
      {CLOUDS.map((c, i) => (
        <Cloud key={i} {...c} />
      ))}
      <Flag accents={accents} />
    </group>
  );
}

/* ---------- ground, hills, path ---------- */

function Ground() {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow material={toon(C.grass)}>
        <circleGeometry args={[150, 48]} />
      </mesh>
      <RBox size={[3.4, 0.08, 10.6]} radius={0.03} color={C.path} position={[0, 0.04, 5]} />
      {[-2.4, 2.4].map((x) => (
        <RBox key={x} size={[0.5, 0.18, 10.6]} radius={0.08} color={C.grassDark} position={[x, 0.09, 5]} />
      ))}
      {[
        [-60, -8, -95, 34],
        [10, -14, -110, 42],
        [70, -9, -90, 30],
        [-95, -6, -30, 26],
        [100, -8, -20, 30],
      ].map(([x, y, z, r], i) => (
        <Ball key={i} r={r} color={i % 2 ? C.grassDark : C.green} position={[x, y, z]} scale={[1.4, 1, 1]} detail={28} />
      ))}
      {[-3.2, -5.6, -8.4, 3.2, 5.6, 8.4].map((x) => (
        <Ball key={x} r={0.7} color={C.grassDark} position={[x, 0.35, 0.9]} scale={[1.2, 0.9, 1]} cast />
      ))}
    </group>
  );
}

/* ---------- fence + gate ---------- */

const FENCE_X = Array.from({ length: 13 }, (_, i) => 3.8 + i * 1.25);

function Fence() {
  return (
    <group position={[0, 0, GATE_Z]}>
      <Instances material={toon(C.white)} castShadow receiveShadow>
        <RoundedBoxGeometry args={[0.3, 1.5, 0.3]} radius={0.1} smoothness={2} />
        {FENCE_X.flatMap((x) => [x, -x]).map((x) => (
          <Instance key={x} position={[x, 0.75, 0]} />
        ))}
      </Instances>
      {[-1, 1].map((s) => (
        <group key={s}>
          <RBox size={[15.6, 0.16, 0.12]} radius={0.05} color={C.white} position={[s * 11.3, 1.1, 0.05]} />
          <RBox size={[15.6, 0.16, 0.12]} radius={0.05} color={C.white} position={[s * 11.3, 0.5, 0.05]} />
        </group>
      ))}
    </group>
  );
}

const BAR_X = [0.3, 0.68, 1.06, 1.44, 1.82, 2.2];

function GateLeaf({ side }: { side: 1 | -1 }) {
  return (
    <group>
      {[0.35, 2.35].map((y) => (
        <RBox key={y} size={[2.45, 0.16, 0.14]} radius={0.06} color={C.yellow} position={[side * 1.25, y, 0]} cast />
      ))}
      {BAR_X.map((x) => (
        <group key={x} position={[side * x, 0, 0]}>
          <Cyl r={0.055} h={2.4} color={C.yellow} position={[0, 1.35, 0]} seg={10} cast />
          <Ball r={0.11} color={C.orange} position={[0, 2.62, 0]} detail={12} />
        </group>
      ))}
    </group>
  );
}

/** Swings open as the first scroll starts; springs overshoot so it bounces against its stops. */
function Gate() {
  const progress = useProgress();
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);
  const live = useRef({ open: spring(0), rattle: spring(0) });
  const openBy = STOPS[0].dwell[1];

  useFrame((_, dt) => {
    const s = live.current;
    const a = stepSpring(s.open, clamp01(progress.current / openBy) * 1.75, dt, 90, 7);
    const r = stepSpring(s.rattle, 0, dt, 300, 6);
    if (left.current) left.current.rotation.y = a + r;
    if (right.current) right.current.rotation.y = -a - r;
  });

  const rattle = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    e.stopPropagation();
    live.current.rattle.v += 2.2;
  };

  return (
    <group position={[0, 0, GATE_Z]}>
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 2.95, 0, 0]}>
          <RBox size={[0.75, 4.2, 0.75]} radius={0.14} color={C.wall} position={[0, 2.1, 0]} cast />
          <RBox size={[0.95, 0.3, 0.95]} radius={0.1} color={C.trim} position={[0, 0.15, 0]} />
        </group>
      ))}
      <RBox size={[6.7, 1.15, 0.35]} radius={0.22} color={C.blue} position={[0, 4.55, 0]} cast />
      <Label text="FABRIC SCHOOL" w={6} h={0.9} bg={C.blue} fg={C.white} position={[0, 4.55, 0.18]} />
      {[-3.15, 3.15].map((x) => (
        <Ball key={x} r={0.3} color={C.yellow} position={[x, 5.3, 0]} cast />
      ))}
      <group ref={left} position={[-2.58, 0, 0]} onPointerOver={rattle} onClick={rattle}>
        <GateLeaf side={1} />
      </group>
      <group ref={right} position={[2.58, 0, 0]} onPointerOver={rattle} onClick={rattle}>
        <GateLeaf side={-1} />
      </group>
    </group>
  );
}

/* ---------- trees: hover wiggle, click boing ---------- */

const TREES = [
  { p: [-8, 0, 6.5], s: 1, c: C.green },
  { p: [8.5, 0, 6], s: 1.1, c: C.grassDark },
  { p: [-11.5, 0, 13.5], s: 1.25, c: C.grassDark },
  { p: [12, 0, 14.5], s: 1.2, c: C.green },
  { p: [-16, 0, 3], s: 1.4, c: "#89e219" },
  { p: [16.5, 0, 2.5], s: 1.3, c: "#89e219" },
  { p: [-6, 0, 16.5], s: 0.85, c: "#89e219" },
  { p: [6.5, 0, 17.5], s: 0.9, c: C.green },
] as const;

function Tree({ position, scale, tint, seed }: { position: readonly number[]; scale: number; tint: string; seed: number }) {
  const crown = useRef<THREE.Group>(null);
  const live = useRef({ tilt: spring(0), squash: spring(1) });

  useFrame((state, dt) => {
    const s = live.current;
    const sway = Math.sin(state.clock.elapsedTime * 1.3 + seed) * 0.025;
    const tilt = stepSpring(s.tilt, 0, dt, 120, 5);
    const sq = stepSpring(s.squash, 1, dt, 200, 7);
    if (crown.current) {
      crown.current.rotation.z = sway + tilt;
      crown.current.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    }
  });

  const poke = (strength: number) => (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    e.stopPropagation();
    live.current.tilt.v += (seed % 2 ? 1 : -1) * strength;
    live.current.squash.v -= strength * 0.8;
  };

  return (
    <group position={position as [number, number, number]} scale={scale}>
      <Cyl r={0.2} rTop={0.14} h={1.7} color={C.woodDark} position={[0, 0.85, 0]} cast />
      <group ref={crown} position={[0, 1.5, 0]} onPointerOver={poke(1.6)} onClick={poke(4)}>
        <Ball r={1.15} color={tint} position={[0, 1.1, 0]} cast />
        <Ball r={0.75} color={tint} position={[0.8, 0.75, 0.2]} cast />
        <Ball r={0.7} color={tint} position={[-0.75, 0.8, -0.1]} cast />
      </group>
    </group>
  );
}

/* ---------- clouds ---------- */

const CLOUDS = [
  { x: -14, y: 13, z: -20, s: 1.6, speed: 0.35 },
  { x: 10, y: 15, z: -35, s: 2.1, speed: 0.25 },
  { x: -30, y: 17, z: -55, s: 2.6, speed: 0.2 },
  { x: 26, y: 12, z: -12, s: 1.4, speed: 0.4 },
  { x: 2, y: 19, z: -70, s: 3, speed: 0.15 },
];

function Cloud({ x, y, z, s, speed }: (typeof CLOUDS)[number]) {
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    ref.current.position.x = ((x + t * speed + 60) % 120) - 60;
    ref.current.position.y = y + Math.sin(t * 0.6 + x) * 0.25;
  });
  return (
    <group ref={ref} position={[x, y, z]} scale={s}>
      <Ball r={1} color={C.white} />
      <Ball r={0.75} color={C.white} position={[1, -0.2, 0.1]} />
      <Ball r={0.7} color={C.white} position={[-1, -0.25, 0]} />
      <Ball r={0.55} color={C.white} position={[0.3, 0.55, 0.2]} />
    </group>
  );
}

/* ---------- flag: five stripes in the role colours, waves; hover makes it flap harder ---------- */

const FLAG_W = 2;
const FLAG_H = 1.25;

function Flag({ accents }: { accents: readonly string[] }) {
  const mesh = useRef<THREE.Mesh>(null);
  const base = useRef<Float32Array | null>(null);
  const material = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 160;
    const g = canvas.getContext("2d")!;
    const colours = accents.length === ROOM_ORDER.length ? accents : [C.red, C.purple, C.green, C.blue, C.yellow];
    colours.forEach((c, i) => {
      g.fillStyle = c;
      g.fillRect(0, (i * 160) / colours.length, 256, 160 / colours.length + 1);
    });
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshToonMaterial({ map, side: THREE.DoubleSide, gradientMap: toon(C.white).gradientMap });
  }, [accents]);
  const amp = useRef(spring(1));

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const a = stepSpring(amp.current, 1, dt, 30, 4);
    const geo = mesh.current?.geometry;
    if (!geo) return;
    const pos = geo.attributes.position;
    const rest = (base.current ??= Float32Array.from(pos.array));
    for (let i = 0; i < pos.count; i++) {
      const x = rest[i * 3] + FLAG_W / 2; // 0 at the pole, FLAG_W at the free edge
      const k = x / FLAG_W;
      pos.setZ(i, Math.sin(x * 2.6 - t * 6) * 0.2 * k * a);
      pos.setY(i, rest[i * 3 + 1] + Math.sin(x * 1.8 - t * 4) * 0.05 * k * a);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  });

  const flap = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    e.stopPropagation();
    amp.current.v += 9;
  };

  return (
    <group position={[-7, 0, 4.5]}>
      <Cyl r={0.09} h={7.2} color={C.white} position={[0, 3.6, 0]} cast />
      <Ball r={0.2} color={C.yellow} position={[0, 7.3, 0]} />
      <RBox size={[0.8, 0.3, 0.8]} radius={0.1} color={C.trim} position={[0, 0.15, 0]} />
      <mesh ref={mesh} material={material} position={[0.08 + FLAG_W / 2, 6.4, 0]} castShadow onPointerOver={flap} onClick={flap}>
        <planeGeometry args={[FLAG_W, FLAG_H, 16, 8]} />
      </mesh>
    </group>
  );
}
