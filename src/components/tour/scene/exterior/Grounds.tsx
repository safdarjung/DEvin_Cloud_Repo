"use client";

import { Instance, Instances } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { GATE_Z, ROOM_ORDER, STOPS } from "../../path";
import { Ball, C, Cyl, Label, RBox, Zone, clamp01, glow, mat, metal, spring, stepSpring, surf, useProgress } from "../kit";
import { GrassTufts, Tree } from "./Trees";
import { Yard } from "./Yard";

const IRON = "#2f5c4c";
const STONE = "#d9d2c3";

export function Exterior({ accents }: { accents: readonly string[] }) {
  return (
    <group>
      <Ground />
      {/* Only while the camera is outside. Indoors the street is behind it, and its 110 m strips cross the near
          plane, where their sliver triangles leaked through the principal's-office wall as rows of dots. */}
      <Zone min={0}>
        <Street />
      </Zone>
      <CompoundWall />
      <Gate />
      {TREES.map((t, i) => (
        <Tree key={i} position={t.p} scale={t.s} tint={t.c} seed={i} />
      ))}
      <GrassTufts />
      {CLOUDS.map((c, i) => (
        <Cloud key={i} {...c} />
      ))}
      <Flag accents={accents} />
      <Yard />
    </group>
  );
}

/* ---------- lawn, entrance path, hedges, hills ---------- */

/** [x, y, z, radius, colour]: two ranges of hills, the far one paler so the fog reads as distance. */
const HILLS: readonly (readonly [number, number, number, number, string])[] = [
  [-60, -28, -95, 34, "#5e9a46"],
  [12, -36, -112, 42, "#4f8c40"],
  [70, -24, -92, 30, "#5e9a46"],
  [-95, -19, -30, 26, "#4f8c40"],
  [100, -23, -20, 30, "#5e9a46"],
  [-30, -50, -135, 62, "#7fae78"],
  [55, -56, -140, 70, "#86b381"],
];

function Ground() {
  const lawn = useMemo(() => {
    const g = new THREE.CircleGeometry(150, 48);
    const uv = g.attributes.uv;
    // Circle UVs run 0..1 across 300 m; the grass texture expects metres.
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 300, uv.getY(i) * 300);
    return g;
  }, []);
  return (
    <group>
      <mesh geometry={lawn} rotation-x={-Math.PI / 2} receiveShadow material={surf("grass", "#b4c2a2")} />
      <RBox size={[3.4, 0.06, 8.2]} radius={0.02} m={surf("paving")} position={[0, 0.03, 6.5]} />
      {[-1.82, 1.82].map((x) => (
        <RBox key={x} size={[0.2, 0.14, 8.2]} radius={0.04} color={STONE} position={[x, 0.07, 6.5]} />
      ))}
      {HILLS.map(([x, y, z, r, c], i) => (
        <Ball key={i} r={r} m={mat(c, { rough: 1 })} position={[x, y, z]} scale={[1.4, 1, 1]} detail={28} />
      ))}
      {[-3.4, -5.6, -8.6, 3.4, 5.6, 8.6].map((x, i) => (
        <group key={x} position={[x, 0, 1.2]}>
          <Ball r={0.7} color={C.grassDark} position={[0, 0.4, 0]} scale={[1.25, 0.9, 0.85]} cast />
          <Ball r={0.45} color={i % 2 ? "#5d9b3e" : "#467f36"} position={[0.55, 0.3, 0.15]} scale={[1.1, 0.9, 0.9]} cast />
        </group>
      ))}
    </group>
  );
}

/* ---------- the street outside: pavement, kerbs, tarmac with a centre line and a zebra crossing ---------- */

const STREET_W = 110;

function Street() {
  const line = mat("#ece9df", { rough: 0.8 });
  return (
    <group>
      <RBox size={[STREET_W, 0.1, 2.7]} radius={0.02} m={surf("paving")} position={[0, 0.05, GATE_Z + 1.75]} />
      <RBox size={[STREET_W, 0.16, 0.3]} radius={0.03} color={STONE} position={[0, 0.06, GATE_Z + 3.2]} />
      <RBox size={[STREET_W, 0.04, 6.4]} radius={0.01} m={surf("asphalt")} position={[0, 0.0, GATE_Z + 6.5]} />
      <RBox size={[STREET_W, 0.16, 0.3]} radius={0.03} color={STONE} position={[0, 0.06, GATE_Z + 9.8]} />
      <RBox size={[STREET_W, 0.1, 6]} radius={0.02} m={surf("paving")} position={[0, 0.05, GATE_Z + 12.9]} />
      <Instances material={line} limit={48}>
        <boxGeometry args={[1, 0.012, 1]} />
        {Array.from({ length: 26 }, (_, i) => (i - 12.5) * 3.4)
          .filter((x) => Math.abs(x) > 3)
          .map((x) => (
            <Instance key={x} position={[x, 0.026, GATE_Z + 6.5]} scale={[1.7, 1, 0.14]} />
          ))}
        {Array.from({ length: 7 }, (_, i) => (
          <Instance key={`z${i}`} position={[0, 0.026, GATE_Z + 3.85 + i * 0.88]} scale={[3.4, 1, 0.46]} />
        ))}
      </Instances>
    </group>
  );
}

/* ---------- compound wall: brick with stone coping, piers and iron railings ---------- */

const WALL = { from: 3.6, to: 21.6, pier: 4.5 } as const;
const WALL_LEN = WALL.to - WALL.from;
const PIERS = Array.from({ length: Math.round(WALL_LEN / WALL.pier) + 1 }, (_, i) => WALL.from + i * WALL.pier).slice(1);
const RAILS = Array.from({ length: Math.floor(WALL_LEN / 0.2) }, (_, i) => WALL.from + 0.1 + i * 0.2);

function CompoundWall() {
  const brick = surf("brick");
  const iron = metal(IRON, 0.5);
  return (
    <group position={[0, 0, GATE_Z]}>
      {[-1, 1].map((s) => (
        <group key={s}>
          <RBox size={[WALL_LEN, 0.75, 0.36]} radius={0.02} m={brick} position={[(s * (WALL.from + WALL.to)) / 2, 0.375, 0]} cast />
          <RBox size={[WALL_LEN, 0.1, 0.46]} radius={0.03} color={STONE} position={[(s * (WALL.from + WALL.to)) / 2, 0.8, 0]} />
          <RBox size={[WALL_LEN, 0.05, 0.05]} radius={0.01} m={iron} position={[(s * (WALL.from + WALL.to)) / 2, 1.82, 0]} />
          {PIERS.map((x) => (
            <group key={x} position={[s * x, 0, 0]}>
              <RBox size={[0.52, 2.1, 0.52]} radius={0.02} m={brick} position={[0, 1.05, 0]} cast />
              <RBox size={[0.64, 0.14, 0.64]} radius={0.03} color={STONE} position={[0, 2.17, 0]} />
            </group>
          ))}
        </group>
      ))}
      <Instances material={iron} castShadow limit={220}>
        <cylinderGeometry args={[0.018, 0.018, 1.08, 5]} />
        {RAILS.flatMap((x) => [x, -x]).map((x) => (
          <Instance key={x} position={[x, 1.38, 0]} />
        ))}
      </Instances>
    </group>
  );
}

/* ---------- gate: brick pillars with lamps, a painted sign arch, two wrought-iron leaves ---------- */

const BAR_X = [0.3, 0.62, 0.94, 1.26, 1.58, 1.9, 2.22];

function GateLeaf({ side }: { side: 1 | -1 }) {
  const iron = metal(IRON, 0.5);
  const brass = metal(C.brass, 0.3);
  return (
    <group>
      {[0.3, 1.35, 2.4].map((y) => (
        <RBox key={y} size={[2.45, 0.09, 0.07]} radius={0.02} m={iron} position={[side * 1.25, y, 0]} cast />
      ))}
      <RBox size={[0.1, 2.5, 0.1]} radius={0.02} m={iron} position={[side * 0.06, 1.35, 0]} cast />
      <RBox size={[0.1, 2.5, 0.1]} radius={0.02} m={iron} position={[side * 2.44, 1.35, 0]} cast />
      {BAR_X.map((x, i) => (
        <group key={x} position={[side * x, 0, 0]}>
          <Cyl r={0.026} h={2.3 + Math.sin((i / 6) * Math.PI) * 0.35} m={iron} position={[0, 1.4 + Math.sin((i / 6) * Math.PI) * 0.17, 0]} seg={6} cast />
          <Cyl r={0.05} rTop={0} h={0.16} m={brass} position={[0, 2.62 + Math.sin((i / 6) * Math.PI) * 0.35, 0]} seg={6} />
        </group>
      ))}
      <RBox size={[0.34, 0.2, 0.09]} radius={0.02} m={brass} position={[side * 2.3, 1.2, 0]} />
    </group>
  );
}

/** Swings open as the first scroll starts. Each leaf is its own heavy spring, so they lag, overshoot and settle apart. */
function Gate() {
  const progress = useProgress();
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);
  const live = useRef({ l: spring(0), r: spring(0), rattle: spring(0) });
  const openBy = STOPS[0].dwell[1];

  useFrame((_, dt) => {
    const s = live.current;
    const target = clamp01(progress.current / openBy) * 1.72;
    const l = stepSpring(s.l, target, dt, 46, 5.2);
    const r = stepSpring(s.r, target, dt, 34, 4.4);
    const rattle = stepSpring(s.rattle, 0, dt, 300, 6);
    if (left.current) left.current.rotation.y = l + rattle;
    if (right.current) right.current.rotation.y = -r - rattle;
  });

  const rattle = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    e.stopPropagation();
    live.current.rattle.v += 2.2;
  };

  return (
    <group position={[0, 0, GATE_Z]}>
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 2.95, 0, 0]}>
          <RBox size={[0.95, 0.4, 0.95]} radius={0.03} m={surf("paving", "#cfc6b6")} position={[0, 0.2, 0]} />
          <RBox size={[0.8, 3.9, 0.8]} radius={0.02} m={surf("brick")} position={[0, 2.3, 0]} cast />
          <RBox size={[1.0, 0.18, 1.0]} radius={0.04} color={STONE} position={[0, 4.32, 0]} cast />
          <Cyl r={0.05} h={0.3} m={metal("#2d3238", 0.5)} position={[0, 4.55, 0]} seg={8} />
          <mesh material={glow("#fff0c4")} position={[0, 4.86, 0]}>
            <sphereGeometry args={[0.2, 16, 12]} />
          </mesh>
        </group>
      ))}
      <RBox size={[5.6, 1.0, 0.16]} radius={0.06} m={mat("#1f4d3a", { rough: 0.5 })} position={[0, 4.05, 0]} cast />
      <RBox size={[5.8, 0.09, 0.22]} radius={0.03} m={metal(C.brass, 0.35)} position={[0, 4.6, 0]} />
      <RBox size={[5.8, 0.09, 0.22]} radius={0.03} m={metal(C.brass, 0.35)} position={[0, 3.5, 0]} />
      <Label text="FABRIC SCHOOL" w={5.2} h={0.78} bg="#1f4d3a" fg="#f3d98f" position={[0, 4.05, 0.085]} />
      <group ref={left} position={[-2.53, 0, 0]} onPointerOver={rattle} onClick={rattle}>
        <GateLeaf side={1} />
      </group>
      <group ref={right} position={[2.53, 0, 0]} onPointerOver={rattle} onClick={rattle}>
        <GateLeaf side={-1} />
      </group>
    </group>
  );
}

/* ---------- trees ---------- */

const TREES = [
  { p: [-8.6, 0, 7.2], s: 1.15, c: C.green },
  { p: [8.4, 0, 3.6], s: 1.2, c: C.grassDark },
  { p: [-12.5, 0, 11.9], s: 1.45, c: C.grassDark },
  { p: [13, 0, 11.9], s: 1.4, c: "#7fb043" },
  { p: [-16.5, 0, 3], s: 1.6, c: "#7fb043" },
  { p: [16.5, 0, 2.5], s: 1.5, c: C.green },
  { p: [-22, 0, 11.9], s: 1.5, c: C.green },
  { p: [22.5, 0, 11.9], s: 1.55, c: C.grassDark },
] as const;

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
      <Ball r={1} color="#ffffff" />
      <Ball r={0.75} color="#ffffff" position={[1, -0.2, 0.1]} />
      <Ball r={0.7} color="#ffffff" position={[-1, -0.25, 0]} />
      <Ball r={0.55} color="#ffffff" position={[0.3, 0.55, 0.2]} />
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
    return new THREE.MeshToonMaterial({ map, side: THREE.DoubleSide });
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
      <Cyl r={0.07} h={7.2} m={metal("#c9ced4", 0.35)} position={[0, 3.6, 0]} seg={10} cast />
      <Ball r={0.16} m={metal(C.brass, 0.3)} position={[0, 7.28, 0]} />
      <RBox size={[0.9, 0.36, 0.9]} radius={0.04} m={surf("paving", "#cfc6b6")} position={[0, 0.18, 0]} />
      <mesh ref={mesh} material={material} position={[0.08 + FLAG_W / 2, 6.4, 0]} castShadow onPointerOver={flap} onClick={flap}>
        <planeGeometry args={[FLAG_W, FLAG_H, 16, 8]} />
      </mesh>
    </group>
  );
}
