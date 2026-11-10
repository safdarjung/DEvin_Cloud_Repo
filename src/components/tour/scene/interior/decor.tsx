"use client";

import { Instance, Instances } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { Ball, C, Cyl, RBox, blobTexture, canvasTexture, decal, edgeTexture, glow, mat, metal, shade, spring, stepSpring } from "../kit";

type V3 = [number, number, number];
const FLOOR_Y = 0.05;

/* ---------- soft shading (fake contact shadows / ambient occlusion) ---------- */

/** Soft round contact shadow on the floor. */
export function Blob({ w, d = w, position }: { w: number; d?: number; position: V3 }) {
  return (
    <mesh material={decal("blob", blobTexture())} position={[position[0], FLOOR_Y, position[2]]} rotation-x={-Math.PI / 2} renderOrder={1}>
      <planeGeometry args={[w, d]} />
    </mesh>
  );
}

/** Darkening strip on the floor along a wall. Local +z points into the room. */
export function EdgeShade({ len, depth = 0.9, position, rotationY = 0 }: { len: number; depth?: number; position: V3; rotationY?: number }) {
  return (
    <group position={[position[0], FLOOR_Y - 0.004, position[2]]} rotation-y={rotationY}>
      <mesh material={decal("edge", edgeTexture())} rotation-x={-Math.PI / 2} position={[0, 0, depth / 2]} renderOrder={1}>
        <planeGeometry args={[len, depth]} />
      </mesh>
    </group>
  );
}

/* ---------- light: ceiling fittings with a painted halo, daylight falling through a window ---------- */

const additive = new Map<string, THREE.MeshBasicMaterial>();
/** Additive, unlit, never written to depth: the stand-in for bloom and light shafts. */
function light(key: string, map: THREE.Texture, opacity: number): THREE.MeshBasicMaterial {
  const id = `${key}:${opacity}`;
  let m = additive.get(id);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ map, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
    additive.set(id, m);
  }
  return m;
}

const haloTexture = () =>
  canvasTexture("halo", 128, 128, (g) => {
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, "rgba(255,236,196,1)");
    r.addColorStop(0.35, "rgba(255,230,180,0.42)");
    r.addColorStop(1, "rgba(255,226,170,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
  });

/** Window panes of light on the floor. */
const patchTexture = () =>
  canvasTexture("patch", 128, 128, (g) => {
    g.fillStyle = "rgba(255,240,205,0.9)";
    for (const [x, y] of [
      [10, 10],
      [68, 10],
      [10, 68],
      [68, 68],
    ])
      g.fillRect(x, y, 50, 50);
  });

const shaftTexture = () =>
  canvasTexture("shaft", 4, 64, (g) => {
    const r = g.createLinearGradient(0, 0, 0, 64);
    r.addColorStop(0, "rgba(255,240,205,0.9)");
    r.addColorStop(1, "rgba(255,240,205,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, 4, 64);
  });

/** Flush ceiling fitting (strip or round) with a soft halo on the ceiling and a pool of light on the floor. */
export function CeilingLight({ position, round = false }: { position: V3; round?: boolean }) {
  return (
    <group position={position}>
      {round ? (
        <>
          <Cyl r={0.5} h={0.05} m={metal(C.steel, 0.4)} position={[0, -0.025, 0]} seg={24} />
          <mesh material={glow("#fff3d6")} position={[0, -0.06, 0]}>
            <cylinderGeometry args={[0.42, 0.42, 0.05, 24]} />
          </mesh>
        </>
      ) : (
        <>
          <RBox size={[0.5, 0.05, 1.5]} radius={0.02} m={metal(C.steel, 0.4)} position={[0, -0.025, 0]} />
          <mesh material={glow("#fff3d6")} position={[0, -0.055, 0]}>
            <boxGeometry args={[0.38, 0.03, 1.38]} />
          </mesh>
        </>
      )}
      <mesh material={light("halo", haloTexture(), 0.55)} position={[0, -0.012, 0]} rotation-x={Math.PI / 2}>
        <planeGeometry args={[2.6, round ? 2.6 : 3.4]} />
      </mesh>
      <mesh material={light("halo", haloTexture(), 0.1)} position={[0, -position[1] + FLOOR_Y + 0.004, 0]} rotation-x={-Math.PI / 2} renderOrder={2}>
        <planeGeometry args={[3.6, round ? 3.6 : 4.4]} />
      </mesh>
    </group>
  );
}

/** A circular rug: woven texture, darker border. */
export function Rug({ r, accent, position }: { r: number; accent: string; position: V3 }) {
  return (
    <group position={[position[0], 0.02, position[2]]}>
      <Cyl r={r} h={0.02} m={mat(shade(accent, 0.8), { surface: "fabric" })} seg={56} />
      <Cyl r={r - 0.14} h={0.024} m={mat(shade(accent, 1.62), { surface: "fabric" })} seg={56} />
      <Cyl r={r - 0.5} h={0.027} m={mat(shade(accent, 1.45), { surface: "fabric" })} seg={56} />
    </group>
  );
}

/* ---------- wall clock: second hand ticks with a springy overshoot ---------- */

export function Clock({ r = 0.32, position, rotationY = 0, rim = C.trim }: { r?: number; position: V3; rotationY?: number; rim?: string }) {
  const hour = useRef<THREE.Group>(null);
  const minute = useRef<THREE.Group>(null);
  const second = useRef<THREE.Group>(null);
  const tick = useRef<ReturnType<typeof spring> | null>(null);
  useFrame((_, dt) => {
    const now = Date.now() / 1000;
    const target = -(Math.floor(now) / 60) * Math.PI * 2;
    tick.current ??= spring(target);
    const a = stepSpring(tick.current, target, dt, 400, 14);
    const d = new Date();
    const m = d.getMinutes() + d.getSeconds() / 60;
    if (second.current) second.current.rotation.z = a;
    if (minute.current) minute.current.rotation.z = -(m / 60) * Math.PI * 2;
    if (hour.current) hour.current.rotation.z = -(((d.getHours() % 12) + m / 60) / 12) * Math.PI * 2;
  });
  return (
    <group position={position} rotation-y={rotationY}>
      <Cyl r={r} h={0.08} color="#fbfaf4" rotation-x={Math.PI / 2} seg={28} />
      <mesh material={mat(shade(rim, 0.8), { rough: 0.35, metal: 0.4 })}>
        <torusGeometry args={[r, r * 0.11, 8, 28]} />
      </mesh>
      <group ref={hour} position={[0, 0, 0.05]}>
        <RBox size={[r * 0.11, r * 0.55, 0.02]} radius={0.01} color={C.ink} position={[0, r * 0.24, 0]} />
      </group>
      <group ref={minute} position={[0, 0, 0.065]}>
        <RBox size={[r * 0.08, r * 0.8, 0.02]} radius={0.01} color={C.ink} position={[0, r * 0.36, 0]} />
      </group>
      <group ref={second} position={[0, 0, 0.08]}>
        <RBox size={[r * 0.035, r * 0.85, 0.01]} radius={0.004} color={C.red} position={[0, r * 0.32, 0]} />
      </group>
      <Ball r={r * 0.09} color={C.yellow} position={[0, 0, 0.09]} detail={8} />
    </group>
  );
}

/* ---------- window onto a painted sky, with swaying curtains ---------- */

const skyTexture = () =>
  canvasTexture("sky-window", 256, 256, (g) => {
    const sky = g.createLinearGradient(0, 0, 0, 256);
    sky.addColorStop(0, "#6fb6ee");
    sky.addColorStop(0.75, "#dcefff");
    sky.addColorStop(0.76, "#7fb866");
    sky.addColorStop(1, "#5c9a4a");
    g.fillStyle = sky;
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = "rgba(255,255,255,0.95)";
    for (const [x, y, s] of [
      [60, 80, 1],
      [140, 130, 0.7],
    ]) {
      g.beginPath();
      g.arc(x, y, 18 * s, 0, Math.PI * 2);
      g.arc(x + 20 * s, y - 8 * s, 22 * s, 0, Math.PI * 2);
      g.arc(x + 42 * s, y, 16 * s, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = "#4a8a3c";
    g.beginPath();
    g.ellipse(70, 200, 60, 16, 0, 0, Math.PI * 2);
    g.ellipse(200, 205, 70, 18, 0, 0, Math.PI * 2);
    g.fill();
  });

export function SkyWindow({ w = 1.4, h = 1.4, position, rotationY = 0, curtain }: { w?: number; h?: number; position: V3; rotationY?: number; curtain?: string }) {
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (left.current) left.current.rotation.z = Math.sin(t * 0.9) * 0.025;
    if (right.current) right.current.rotation.z = -Math.sin(t * 0.9 + 1) * 0.025;
  });
  return (
    <group position={position} rotation-y={rotationY}>
      <RBox size={[w + 0.22, h + 0.22, 0.1]} radius={0.06} color={C.white} />
      <mesh position={[0, 0, 0.055]}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial map={skyTexture()} toneMapped={false} />
      </mesh>
      <RBox size={[0.06, h, 0.05]} radius={0.02} color={C.white} position={[0, 0, 0.08]} />
      <RBox size={[w, 0.06, 0.05]} radius={0.02} color={C.white} position={[0, 0, 0.08]} />
      <RBox size={[w + 0.45, 0.08, 0.22]} radius={0.03} color={C.white} position={[0, -h / 2 - 0.12, 0.1]} />
      {/* daylight: a shaft from the glass and four bright panes on the floor */}
      <mesh material={light("shaft", shaftTexture(), 0.16)} position={[0, -h / 2 - (position[1] - h / 2) / 2, 1.15]} rotation-x={Math.atan2(2.1, position[1] - h / 2)}>
        <planeGeometry args={[w * 1.15, Math.hypot(2.1, position[1] - h / 2)]} />
      </mesh>
      <mesh material={light("patch", patchTexture(), 0.22)} position={[0, -position[1] + FLOOR_Y + 0.006, 2.3]} rotation-x={-Math.PI / 2} renderOrder={2}>
        <planeGeometry args={[w * 1.25, 1.7]} />
      </mesh>
      {curtain && (
        <>
          <RBox size={[w + 0.9, 0.06, 0.06]} radius={0.03} color={C.woodDark} position={[0, h / 2 + 0.2, 0.18]} />
          <group ref={left} position={[-w / 2 - 0.12, h / 2 + 0.18, 0.16]}>
            <RBox size={[0.42, h + 0.35, 0.08]} radius={0.04} m={mat(curtain, { surface: "fabric" })} position={[0, -(h + 0.35) / 2, 0]} cast />
          </group>
          <group ref={right} position={[w / 2 + 0.12, h / 2 + 0.18, 0.16]}>
            <RBox size={[0.42, h + 0.35, 0.08]} radius={0.04} m={mat(curtain, { surface: "fabric" })} position={[0, -(h + 0.35) / 2, 0]} cast />
          </group>
        </>
      )}
    </group>
  );
}

/* ---------- frames, plants, bunting ---------- */

export function Frame({ w, h, inner = C.cream, wood = C.woodDark, position, rotationY = 0, tilt = 0, children }: { w: number; h: number; inner?: string; wood?: string; position: V3; rotationY?: number; tilt?: number; children?: ReactNode }) {
  return (
    <group position={position} rotation={[0, rotationY, tilt]}>
      <RBox size={[w, h, 0.07]} radius={0.04} color={wood} />
      <RBox size={[w - 0.12, h - 0.12, 0.07]} radius={0.03} color={inner} position={[0, 0, 0.02]} />
      <group position={[0, 0, 0.065]}>{children}</group>
    </group>
  );
}

export function Plant({ position, scale = 1, pot = C.trim, leaf = C.green }: { position: V3; scale?: number; pot?: string; leaf?: string }) {
  const leaves = useRef<THREE.Group>(null);
  const seed = position[0] * 3.1 + position[2];
  useFrame((state) => {
    if (leaves.current) leaves.current.rotation.z = Math.sin(state.clock.elapsedTime * 1.1 + seed) * 0.05;
  });
  return (
    <group position={position} scale={scale}>
      <Cyl r={0.24} rTop={0.3} h={0.55} color={pot} position={[0, 0.28, 0]} cast />
      <Cyl r={0.29} h={0.06} color={shade(pot, 0.8)} position={[0, 0.56, 0]} />
      <group ref={leaves} position={[0, 0.58, 0]}>
        <Ball r={0.38} color={leaf} position={[0, 0.35, 0]} cast />
        <Ball r={0.26} color={shade(leaf, 0.8)} position={[0.22, 0.6, 0.05]} cast />
        <Ball r={0.24} color={shade(leaf, 1.25)} position={[-0.2, 0.56, -0.08]} />
      </group>
      <Blob w={0.9} position={[0, 0, 0]} />
    </group>
  );
}

const FLAG_COLOURS = [C.red, C.yellow, C.blue, C.green, C.purple, C.orange];

/** A sagging string of pennants from a to b; it sways gently. */
export function Bunting({ a, b, n = 12, sag = 0.35, colours = FLAG_COLOURS }: { a: V3; b: V3; n?: number; sag?: number; colours?: readonly string[] }) {
  const ref = useRef<THREE.Group>(null);
  const flags = useMemo(() => {
    const A = new THREE.Vector3(...a);
    const B = new THREE.Vector3(...b);
    const dir = B.clone().sub(A);
    const yaw = Math.atan2(-dir.z, dir.x);
    return Array.from({ length: n }, (_, i) => {
      const k = (i + 0.5) / n;
      const p = A.clone().lerp(B, k);
      p.y -= Math.sin(Math.PI * k) * sag;
      return { p: p.toArray() as V3, yaw, c: colours[i % colours.length] };
    });
  }, [a, b, n, sag, colours]);
  useFrame((state) => {
    if (ref.current) ref.current.rotation.x = Math.sin(state.clock.elapsedTime * 1.4) * 0.04;
  });
  return (
    <group ref={ref}>
      <Instances material={mat(C.white)} limit={64}>
        <coneGeometry args={[0.16, 0.3, 3]} />
        {flags.map((f, i) => (
          <Instance key={i} position={[f.p[0], f.p[1] - 0.15, f.p[2]]} rotation={[0, f.yaw, Math.PI]} scale={[1, 1, 0.25]} color={f.c} />
        ))}
      </Instances>
    </group>
  );
}
