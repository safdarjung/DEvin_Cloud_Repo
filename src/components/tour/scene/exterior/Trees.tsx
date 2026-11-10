"use client";

import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { FINALE_Z } from "../../path";
import { C, mat, shade, spring, stepSpring, useLite } from "../kit";

/* ---------- trees: trunk + branches, two leaf layers that sway out of step; hover wiggles, click boings ---------- */

const CROWN_Y = 1.9;
const rand = (n: number) => {
  const x = Math.sin(n * 127.1 + 11.7) * 43758.5453;
  return x - Math.floor(x);
};

/** A lumpy leaf mass: a sphere pushed in and out by a few sine waves, smooth-shaded. */
function leafBlob(seed: number, r: number, at: THREE.Vector3): THREE.BufferGeometry {
  const ico = new THREE.IcosahedronGeometry(1, 3);
  ico.deleteAttribute("uv"); // UV seams would stop the vertices welding, and welded vertices are what shade smoothly
  ico.deleteAttribute("normal");
  const g = mergeVertices(ico);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 1 + 0.14 * Math.sin(x * 3.2 + seed) * Math.sin(y * 3.6 + seed * 1.7) + 0.08 * Math.sin(z * 4.5 + seed * 0.6);
    p.setXYZ(i, x * k * r + at.x, y * k * r * 0.85 + at.y, z * k * r + at.z);
  }
  g.computeVertexNormals();
  return g;
}

interface TreeGeometry {
  wood: THREE.BufferGeometry;
  inner: THREE.BufferGeometry;
  outer: THREE.BufferGeometry;
}
const variants = new Map<number, TreeGeometry>();

/** Three tree shapes, built once and shared. Leaf layers are authored around the crown pivot. */
function treeGeometry(variant: number): TreeGeometry {
  let out = variants.get(variant);
  if (out) return out;
  const trunk = new THREE.CylinderGeometry(0.13, 0.24, CROWN_Y + 0.5, 8).translate(0, (CROWN_Y + 0.5) / 2, 0);
  const wood = [trunk];
  const inner: THREE.BufferGeometry[] = [];
  const outer: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const yaw = (i / 3) * Math.PI * 2 + variant;
    const branch = new THREE.CylinderGeometry(0.05, 0.1, 1.2, 6).translate(0, 0.6, 0).rotateZ(0.75).rotateY(yaw).translate(0, CROWN_Y - 0.25, 0);
    wood.push(branch);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + variant * 1.3;
    const ringR = i < 5 ? 0.85 : 0.35;
    const at = new THREE.Vector3(Math.cos(a) * ringR, i < 5 ? 0.7 + rand(i + variant * 10) * 0.35 : 1.35 + rand(i * 3 + variant) * 0.3, Math.sin(a) * ringR);
    (i % 2 ? outer : inner).push(leafBlob(i * 2.3 + variant * 7, 0.7 + rand(i * 5 + variant) * 0.3, at));
  }
  inner.push(leafBlob(variant + 40, 1.0, new THREE.Vector3(0, 1.0, 0)));
  out = { wood: mergeGeometries(wood), inner: mergeGeometries(inner), outer: mergeGeometries(outer) };
  variants.set(variant, out);
  return out;
}

export function Tree({ position, scale, tint, seed }: { position: readonly number[]; scale: number; tint: string; seed: number }) {
  const inner = useRef<THREE.Group>(null);
  const outer = useRef<THREE.Group>(null);
  const live = useRef({ tilt: spring(0), squash: spring(1) });
  const geo = useMemo(() => treeGeometry(seed % 3), [seed]);

  useFrame((state, dt) => {
    const s = live.current;
    const t = state.clock.elapsedTime * 1.1 + seed;
    const gust = Math.sin(t * 0.31) * 0.5 + 0.5;
    const tilt = stepSpring(s.tilt, 0, dt, 120, 5);
    const sq = stepSpring(s.squash, 1, dt, 200, 7);
    if (inner.current) {
      inner.current.rotation.z = Math.sin(t) * 0.014 * (0.5 + gust) + tilt * 0.6;
      inner.current.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    }
    if (outer.current) {
      // The outer leaves trail the inner ones: that lag is what reads as wind.
      outer.current.rotation.z = Math.sin(t - 0.7) * 0.03 * (0.5 + gust) + tilt;
      outer.current.rotation.x = Math.cos(t * 0.8 - 0.4) * 0.018;
      outer.current.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    }
  });

  const poke = (strength: number) => (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    e.stopPropagation();
    live.current.tilt.v += (seed % 2 ? 1 : -1) * strength;
    live.current.squash.v -= strength * 0.8;
  };

  return (
    <group position={position as [number, number, number]} scale={scale} rotation-y={seed * 1.9}>
      <mesh geometry={geo.wood} material={mat("#6b4a35", { rough: 0.95 })} castShadow receiveShadow />
      <group position={[0, CROWN_Y, 0]} onPointerOver={poke(1.6)} onClick={poke(4)}>
        <group ref={inner}>
          <mesh geometry={geo.inner} material={mat(shade(tint, 0.72), { rough: 0.95 })} castShadow receiveShadow />
        </group>
        <group ref={outer}>
          <mesh geometry={geo.outer} material={mat(tint, { rough: 0.9 })} castShadow receiveShadow />
        </group>
      </group>
    </group>
  );
}

/* ---------- grass tufts: one instanced mesh, thick near the path, the gate and the garden stage ---------- */

function tuftGeometry(): THREE.BufferGeometry {
  const blades = [-0.5, 0.1, 0.6].map((lean, i) =>
    new THREE.ConeGeometry(0.035, 0.26 + i * 0.05, 3)
      .translate(0, 0.13 + i * 0.025, 0)
      .rotateZ(lean * 0.5)
      .rotateY(i * 2.1),
  );
  return mergeGeometries(blades);
}

/** [x0, x1, z0, z1, share]: where tufts grow. Paths, the road and the stage are carved out below. */
const ZONES: readonly (readonly [number, number, number, number, number])[] = [
  [-14, -2.1, 1.2, 9.6, 0.34],
  [2.1, 14, 1.2, 9.6, 0.34],
  [-9, 9, FINALE_Z - 4, FINALE_Z + 9, 0.32],
];
const GREENS = ["#5d9b3e", "#79b552", "#4c8a37", "#8cc063"];

export function GrassTufts() {
  const lite = useLite();
  const count = lite ? 220 : 800;
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => tuftGeometry(), []);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const colour = new THREE.Color();
    let placed = 0;
    for (let n = 0; placed < count && n < count * 6; n++) {
      const zone = ZONES[rand(n * 3.1) < ZONES[0][4] ? 0 : rand(n * 3.1) < ZONES[0][4] + ZONES[1][4] ? 1 : 2];
      const x = zone[0] + rand(n * 1.7 + 1) * (zone[1] - zone[0]);
      const z = zone[2] + rand(n * 2.3 + 2) * (zone[3] - zone[2]);
      const onGardenPath = z < 0 && Math.abs(x) < 1.6 && z > FINALE_Z + 1.2;
      const onStage = z < 0 && Math.abs(x) < 3.6 && Math.abs(z - FINALE_Z + 0.2) < 1.4;
      if (onGardenPath || onStage) continue;
      const s = 0.55 + rand(n * 5.9) * 0.7;
      m.compose(new THREE.Vector3(x, 0, z), q.setFromAxisAngle(up, rand(n) * Math.PI * 2), new THREE.Vector3(s, s, s));
      mesh.setMatrixAt(placed, m);
      mesh.setColorAt(placed, colour.set(GREENS[n % GREENS.length]));
      placed++;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [count]);

  return <instancedMesh ref={ref} args={[geo, mat("#ffffff", { rough: 0.9 }), count]} receiveShadow frustumCulled={false} />;
}

export const TREE_TINTS = [C.green, C.grassDark, "#7fb043"] as const;
