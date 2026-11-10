"use client";

import { Instance, Instances } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { BACK_DOOR, CORRIDOR_END_Z } from "../../path";
import { Clock } from "../interior/decor";
import { Ball, C, Cyl, RBox, clamp01, cursor, glass, glow, mat, metal, spring, stepSpring, surf } from "../kit";

const HALF_W = 12;
const HEIGHT = 7;
const DEPTH = -CORRIDOR_END_Z + 0.6;
const WIN_X = [4, 7.2, 10.3].flatMap((x) => [x, -x]);
const WINDOWS = [...WIN_X.map((x) => [x, 1.9] as const), ...WIN_X.map((x) => [x, 5.2] as const)];
const WIN = { w: 1.6, h: 1.75 } as const;
/** Hip roof: eaves overhang the walls, slopes rise `rise` over `inset` to a flat deck the cupola stands on. */
const ROOF = { half: HALF_W + 0.7, z0: 0.9, z1: -DEPTH - 0.7, inset: 3.2, rise: 1.7 } as const;
const EAVE_Y = HEIGHT + 0.25;
const ROOF_TOP = EAVE_Y + ROOF.rise;
const STONE = "#d9d2c3";

/** Four tiled slopes and a deck, with UVs in metres so the tile texture keeps its scale. */
function hipRoofGeometry(): THREE.BufferGeometry {
  const { half, z0, z1, inset, rise } = ROOF;
  const slope = Math.hypot(inset, rise);
  const eave = [new THREE.Vector3(-half, 0, z0), new THREE.Vector3(half, 0, z0), new THREE.Vector3(half, 0, z1), new THREE.Vector3(-half, 0, z1)];
  const top = [new THREE.Vector3(-half + inset, rise, z0 - inset), new THREE.Vector3(half - inset, rise, z0 - inset), new THREE.Vector3(half - inset, rise, z1 + inset), new THREE.Vector3(-half + inset, rise, z1 + inset)];
  const pos: number[] = [];
  const uv: number[] = [];
  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, len: number, v: number) => {
    for (const p of [a, b, c, a, c, d]) pos.push(p.x, p.y, p.z);
    uv.push(0, 0, len, 0, len - inset, v, 0, 0, len - inset, v, inset, v);
  };
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    quad(eave[i], eave[j], top[j], top[i], eave[i].distanceTo(eave[j]), slope);
  }
  for (const p of [top[0], top[1], top[2], top[0], top[2], top[3]]) pos.push(p.x, p.y, p.z);
  for (const p of [top[0], top[1], top[2], top[0], top[2], top[3]]) uv.push(p.x, p.z);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** The school seen from the courtyard: brick, stone plinth and quoins, tiled hip roof, porch. The door hole is the camera's way in. */
export function Building() {
  const roof = useMemo(() => hipRoofGeometry(), []);
  const brick = surf("brick");
  return (
    <group>
      {/* facade pieces around the door hole (x ±1.4, y 0..3.2) */}
      <RBox size={[HALF_W - 1.4, HEIGHT, 0.4]} radius={0.02} m={brick} position={[-(HALF_W + 1.4) / 2, HEIGHT / 2, -0.2]} />
      <RBox size={[HALF_W - 1.4, HEIGHT, 0.4]} radius={0.02} m={brick} position={[(HALF_W + 1.4) / 2, HEIGHT / 2, -0.2]} />
      <RBox size={[2.8, HEIGHT - 3.2, 0.4]} radius={0.02} m={brick} position={[0, (HEIGHT + 3.2) / 2, -0.2]} />
      {/* back facade around the garden door, which the camera leaves through */}
      {[-1, 1].map((s) => (
        <RBox key={s} size={[HALF_W - BACK_DOOR.half, HEIGHT, 0.4]} radius={0.02} m={brick} position={[(s * (HALF_W + BACK_DOOR.half)) / 2, HEIGHT / 2, -DEPTH + 0.2]} />
      ))}
      <RBox size={[BACK_DOOR.half * 2, HEIGHT - BACK_DOOR.height, 0.4]} radius={0.02} m={brick} position={[0, (HEIGHT + BACK_DOOR.height) / 2, -DEPTH + 0.2]} />
      {/* shell: sides (single-sided, so invisible from inside) */}
      {[-1, 1].map((s) => (
        <RBox key={s} size={[0.4, HEIGHT, DEPTH]} radius={0.02} m={brick} position={[s * HALF_W, HEIGHT / 2, -DEPTH / 2]} />
      ))}
      {/* roof, fascia, gutter and downpipes */}
      <mesh geometry={roof} material={surf("roof")} position={[0, EAVE_Y, 0]} />
      <RBox size={[ROOF.half * 2, 0.26, 0.2]} radius={0.04} color={C.white} position={[0, EAVE_Y - 0.1, ROOF.z0 - 0.12]} />
      <RBox size={[HALF_W * 2 + 0.5, 0.3, 0.5]} radius={0.06} color={STONE} position={[0, HEIGHT - 0.1, 0.1]} />
      <Cyl r={0.09} h={ROOF.half * 2} m={metal("#6d7680", 0.4)} position={[0, EAVE_Y - 0.02, ROOF.z0 + 0.06]} rotation-z={Math.PI / 2} seg={8} />
      {[-1, 1].map((s) => (
        <Cyl key={s} r={0.07} h={HEIGHT} m={metal("#6d7680", 0.4)} position={[s * (HALF_W - 0.75), HEIGHT / 2, 0.42]} seg={8} />
      ))}
      {/* stone plinth, string course between the floors, corner quoins */}
      {[-1, 1].map((s) => (
        <RBox key={s} size={[HALF_W - 1.4, 0.7, 0.6]} radius={0.05} m={surf("paving", "#cfc6b6")} position={[(s * (HALF_W + 2)) / 2, 0.35, 0.05]} />
      ))}
      <RBox size={[HALF_W * 2 + 0.3, 0.2, 0.5]} radius={0.04} color={STONE} position={[0, 3.62, 0.02]} />
      {[-1, 1].map((s) => (
        <RBox key={s} size={[0.9, HEIGHT, 0.7]} radius={0.05} color={STONE} position={[s * HALF_W, HEIGHT / 2, 0.05]} cast />
      ))}
      <Windows />
      <Porch />
      <FrontDoors />
      <Clock r={0.85} position={[0, 5.5, 0.05]} />
      <Cupola />
    </group>
  );
}

/** Sash windows: stone surround, sill and lintel, glazing bars, glass that mirrors the sky; flower boxes downstairs. */
function Windows() {
  const stone = mat(STONE);
  const paint = mat(C.white, { rough: 0.5 });
  return (
    <group position={[0, 0, 0.02]}>
      <Instances material={stone} receiveShadow limit={12}>
        <boxGeometry args={[WIN.w + 0.36, WIN.h + 0.36, 0.14]} />
        {WINDOWS.map(([x, y]) => (
          <Instance key={`${x}:${y}`} position={[x, y, 0]} />
        ))}
      </Instances>
      <Instances material={glass()} limit={12}>
        <boxGeometry args={[WIN.w, WIN.h, 0.06]} />
        {WINDOWS.map(([x, y]) => (
          <Instance key={`${x}:${y}`} position={[x, y, 0.06]} />
        ))}
      </Instances>
      {/* frame + glazing bars: one upright and two rails per window */}
      <Instances material={paint} limit={60}>
        <boxGeometry args={[1, 1, 0.07]} />
        {WINDOWS.flatMap(([x, y]) => [
          <Instance key={`${x}:${y}:v`} position={[x, y, 0.1]} scale={[0.06, WIN.h, 1]} />,
          <Instance key={`${x}:${y}:h`} position={[x, y + 0.02, 0.1]} scale={[WIN.w, 0.08, 1]} />,
          <Instance key={`${x}:${y}:t`} position={[x, y + WIN.h * 0.3, 0.1]} scale={[WIN.w, 0.045, 1]} />,
          <Instance key={`${x}:${y}:l`} position={[x - WIN.w / 2 + 0.035, y, 0.1]} scale={[0.07, WIN.h, 1]} />,
          <Instance key={`${x}:${y}:r`} position={[x + WIN.w / 2 - 0.035, y, 0.1]} scale={[0.07, WIN.h, 1]} />,
        ])}
      </Instances>
      {/* sills and lintels */}
      <Instances material={stone} castShadow receiveShadow limit={24}>
        <boxGeometry args={[1, 1, 1]} />
        {WINDOWS.flatMap(([x, y]) => [
          <Instance key={`${x}:${y}:s`} position={[x, y - WIN.h / 2 - 0.22, 0.14]} scale={[WIN.w + 0.6, 0.12, 0.4]} />,
          <Instance key={`${x}:${y}:l`} position={[x, y + WIN.h / 2 + 0.24, 0.1]} scale={[WIN.w + 0.5, 0.2, 0.3]} />,
        ])}
      </Instances>
      <Instances material={mat(C.woodDark)} castShadow limit={8}>
        <boxGeometry args={[WIN.w + 0.2, 0.3, 0.36]} />
        {WIN_X.map((x) => (
          <Instance key={x} position={[x, 0.98, 0.5]} />
        ))}
      </Instances>
      <Instances material={mat("#ffffff")} limit={64}>
        <sphereGeometry args={[0.12, 8, 6]} />
        {WIN_X.flatMap((x) =>
          [-0.65, -0.33, 0, 0.33, 0.65].map((dx, i) => (
            <Instance key={`${x}:${dx}`} position={[x + dx, 1.2 + (i % 2) * 0.05, 0.5]} color={["#e86a9a", C.green, C.yellow, C.green, "#e9703a"][i]} />
          )),
        )}
      </Instances>
    </group>
  );
}

/** Entrance porch: two columns, a flat canopy and a small pediment, lanterns by the door, two shallow steps. */
function Porch() {
  return (
    <group>
      <RBox size={[5.4, 0.07, 2.6]} radius={0.02} m={surf("paving")} position={[0, 0.035, 1.3]} />
      <RBox size={[4.6, 0.12, 1.9]} radius={0.02} m={surf("paving")} position={[0, 0.06, 0.95]} />
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 1.95, 0, 1.55]}>
          <RBox size={[0.5, 0.4, 0.5]} radius={0.03} color={STONE} position={[0, 0.27, 0]} />
          <Cyl r={0.17} rTop={0.14} h={3.3} color={C.white} position={[0, 2.1, 0]} seg={16} cast />
          <RBox size={[0.46, 0.14, 0.46]} radius={0.03} color={STONE} position={[0, 3.8, 0]} />
        </group>
      ))}
      <RBox size={[4.9, 0.3, 2.3]} radius={0.05} color={C.white} position={[0, 4.02, 0.85]} cast />
      <mesh material={mat(C.white)} position={[0, 4.62, 0.85]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.42, 1, 0.42]} castShadow>
        <cylinderGeometry args={[1.95, 1.95, 2.3, 3]} />
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 2.3, 2.5, 0.12]}>
          <RBox size={[0.08, 0.3, 0.14]} radius={0.02} m={metal("#2d3238", 0.5)} position={[0, 0.1, 0.02]} />
          <mesh material={glow("#ffe9b0")} position={[0, 0, 0.16]}>
            <sphereGeometry args={[0.12, 12, 10]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Panelled double doors that swing open (with a bounce) once the camera is close. */
function FrontDoors() {
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);
  const open = useRef(spring(0));
  useFrame((state, dt) => {
    const near = state.camera.position.z < 12.5 ? 1 : 0;
    // Heavy doors: soft spring, so they start slowly, overshoot a little and settle.
    const a = stepSpring(open.current, near * 1.9, dt, 30, 5.4);
    // Swing outward, toward the visitor, so the way in stays clear.
    if (left.current) left.current.rotation.y = -a;
    if (right.current) right.current.rotation.y = a;
  });
  const paint = mat("#27506e", { rough: 0.45 });
  const panel = mat("#1f4159", { rough: 0.5 });
  return (
    <group>
      {[-1, 1].map((s) => (
        <RBox key={s} size={[0.3, 3.45, 0.5]} radius={0.04} color={STONE} position={[s * 1.55, 1.72, 0.05]} />
      ))}
      <RBox size={[3.45, 0.36, 0.5]} radius={0.04} color={STONE} position={[0, 3.4, 0.05]} />
      {([-1, 1] as const).map((s) => (
        <group key={s} ref={s < 0 ? left : right} position={[s * 1.38, 0.1, 0]}>
          <group position={[-s * 0.69, 0, 0]}>
            <RBox size={[1.34, 3.06, 0.1]} radius={0.02} m={paint} position={[0, 1.55, 0]} cast />
            <RBox size={[1.0, 0.75, 0.04]} radius={0.015} m={panel} position={[0, 0.62, 0.05]} />
            <RBox size={[1.0, 1.35, 0.03]} radius={0.015} m={glass()} position={[0, 1.95, 0.045]} />
            <RBox size={[0.05, 1.35, 0.05]} radius={0.01} m={paint} position={[0, 1.95, 0.06]} />
            <RBox size={[1.0, 0.05, 0.05]} radius={0.01} m={paint} position={[0, 1.95, 0.06]} />
            <RBox size={[1.3, 0.2, 0.02]} radius={0.005} m={metal(C.brass, 0.35)} position={[0, 0.14, 0.055]} />
            <Cyl r={0.022} h={0.5} m={metal(C.brass, 0.3)} position={[-s * 0.52, 1.2, 0.11]} seg={8} />
          </group>
        </group>
      ))}
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

/** Bell tower. Click the bell: it swings, pops and sends out rings. (No shadows: they would fall through the roof into the rooms.) */
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
    <group position={[0, ROOF_TOP + 1.05, ROOF.z0 - ROOF.inset - 1.7]} onClick={ring} onPointerOver={hover} onPointerOut={cursor(false)}>
      <RBox size={[2.5, 1.2, 2.5]} radius={0.05} m={surf("brick")} position={[0, -0.55, 0]} />
      <RBox size={[2.8, 0.3, 2.8]} radius={0.1} color={C.white} position={[0, 0.15, 0]} />
      {[
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1],
      ].map(([x, z]) => (
        <RBox key={`${x}${z}`} size={[0.36, 2, 0.36]} radius={0.12} color={C.wall} position={[x * 1.1, 1.3, z * 1.1]} />
      ))}
      <RBox size={[2.9, 0.3, 2.9]} radius={0.1} color={C.trim} position={[0, 2.4, 0]} />
      <mesh material={surf("roof")} position={[0, 3.25, 0]} rotation-y={Math.PI / 4}>
        <coneGeometry args={[2.1, 1.5, 4]} />
      </mesh>
      <Ball r={0.18} m={metal(C.brass, 0.3)} position={[0, 4.1, 0]} />
      <group ref={bell} position={[0, 2.2, 0]}>
        <mesh geometry={bellGeo} material={metal(C.brass, 0.3)} position={[0, -0.55, 0]} />
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
