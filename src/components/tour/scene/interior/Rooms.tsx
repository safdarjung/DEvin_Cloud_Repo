"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { DOOR_H, DOOR_HALF, ROOM_HALF, ROOMS, ROOM_X } from "../../path";
import { TOUR_ROLES, type TourRoleKey } from "../../roles";
import { C, Cyl, RBox, glass, mat, metal, shade, spring, stepSpring, surf } from "../kit";
import { CeilingLight, EdgeShade } from "./decor";

export const WALL_H = 3.6;
export const ROLE = Object.fromEntries(TOUR_ROLES.map((r) => [r.key, r])) as Record<TourRoleKey, (typeof TOUR_ROLES)[number]>;
export const ceilingMaterial = () => mat("#f3eee4", { rough: 1 });

/* Camera depths (world z) between which each part of the school is drawn; see kit `Zone`. */
/** The front yard, street and facade: until the camera is well down the corridor. */
export const FRONT_UNTIL = -9;
/** The corridor: once the camera is close enough for the front doors to open. */
export const CORRIDOR_FROM = 13;
/** The garden and its stage: from the last stretch of corridor, when the garden doors are about to open. */
export const GARDEN_FROM = -33;
/** A room: from a few doors before it until the camera has walked past. */
export const roomZone = (key: TourRoleKey) => ({ max: ROOMS[key].z + 13, min: ROOMS[key].z - 7 });

/** Room-local frame: +x away from the corridor, origin at the room's floor centre. */
export function InRoom({ roleKey, children }: { roleKey: TourRoleKey; children: ReactNode }) {
  const { side, z } = ROOMS[roleKey];
  return (
    <group position={[side * ROOM_X, 0, z]} rotation-y={side === 1 ? 0 : Math.PI}>
      {children}
    </group>
  );
}

/** Plank floor, plaster walls washed with the role colour over a painted dado, rail, skirting, cornice and a ceiling light. */
export function RoomShell({ roleKey }: { roleKey: TourRoleKey }) {
  const accent = ROLE[roleKey].accent;
  const tone = useMemo(() => ({ wall: surf("plaster", shade(accent, 1.86)), dado: mat(shade(accent, 1.6), { rough: 0.6 }), skirting: mat(shade(accent, 0.62), { rough: 0.5 }) }), [accent]);
  const { x: hx, z: hz } = ROOM_HALF;
  const walls: { len: number; pos: [number, number]; rot: number }[] = [
    { len: hz * 2, pos: [hx, 0], rot: -Math.PI / 2 },
    { len: hx * 2, pos: [0.1, -hz], rot: 0 },
    { len: hx * 2, pos: [0.1, hz], rot: Math.PI },
  ];
  return (
    <InRoom roleKey={roleKey}>
      <RBox size={[hx * 2, 0.1, hz * 2]} radius={0.02} m={surf("planks")} position={[0, -0.03, 0]} />
      {walls.map(({ len, pos: [x, z], rot }) => (
        <group key={rot} position={[x, 0, z]} rotation-y={rot}>
          <RBox size={[len + 0.2, WALL_H, 0.2]} radius={0.02} m={tone.wall} position={[0, WALL_H / 2, -0.1]} />
          <RBox size={[len, 1.0, 0.04]} radius={0.01} m={tone.dado} position={[0, 0.55, 0.015]} />
          <RBox size={[len, 0.07, 0.08]} radius={0.02} color={C.white} position={[0, 1.08, 0.03]} />
          <RBox size={[len, 0.16, 0.06]} radius={0.015} m={tone.skirting} position={[0, 0.08, 0.03]} />
          <RBox size={[len, 0.14, 0.14]} radius={0.04} color={C.white} position={[0, WALL_H - 0.07, 0.05]} />
          <EdgeShade len={len} position={[0, 0, 0.05]} />
        </group>
      ))}
      <mesh material={ceilingMaterial()} position={[0, WALL_H, 0]} rotation-x={Math.PI / 2}>
        <planeGeometry args={[hx * 2 + 0.4, hz * 2 + 0.4]} />
      </mesh>
      <CeilingLight position={[1, WALL_H, 0]} round />
      <RoomDoors accent={accent} />
    </InRoom>
  );
}

/** One leaf: painted frame, two sunk panels, a wired-glass vision panel, brass push plate and pull, steel kick plate. */
function DoorLeaf({ accent, hand }: { accent: string; hand: 1 | -1 }) {
  const w = DOOR_HALF - 0.04;
  const h = DOOR_H - 0.05;
  const paint = mat(shade(accent, 0.8), { rough: 0.45 });
  const sunk = mat(shade(accent, 0.66), { rough: 0.5 });
  const brass = metal(C.brass, 0.3);
  return (
    <group position={[0, 0, -hand * (DOOR_HALF / 2)]}>
      <RBox size={[0.07, h, w]} radius={0.015} m={paint} position={[0, h / 2, 0]} cast />
      {[-1, 1].map((f) => (
        <group key={f} position={[f * 0.036, 0, 0]}>
          <RBox size={[0.012, 0.85, w - 0.5]} radius={0.004} m={sunk} position={[0, 0.72, 0]} />
          <RBox size={[0.012, 0.5, w - 0.5]} radius={0.004} m={sunk} position={[0, 2.48, 0]} />
          <RBox size={[0.014, 0.9, w - 0.62]} radius={0.004} m={glass()} position={[0, 1.7, 0]} />
          <RBox size={[0.02, 0.9, 0.04]} radius={0.004} m={paint} position={[0, 1.7, 0]} />
          <RBox size={[0.012, 0.24, w - 0.08]} radius={0.004} m={metal(C.steel, 0.4)} position={[0, 0.14, 0]} />
          <RBox size={[0.012, 0.32, 0.12]} radius={0.004} m={brass} position={[0, 1.18, -hand * (w / 2 - 0.16)]} />
          <Cyl r={0.016} h={0.3} m={brass} position={[f * 0.05, 1.18, -hand * (w / 2 - 0.16)]} seg={8} />
        </group>
      ))}
    </group>
  );
}

/** Double doors on the corridor side. They swing into the room as the camera comes near: heavy, one a beat behind the other. */
function RoomDoors({ accent }: { accent: string }) {
  const a = useRef<THREE.Group>(null);
  const b = useRef<THREE.Group>(null);
  const live = useRef({ a: spring(0), b: spring(0) });
  const centre = useRef(new THREE.Vector3());
  useFrame((state, dt) => {
    a.current?.parent?.localToWorld(centre.current.set(-ROOM_HALF.x, 1.4, 0));
    const near = state.camera.position.distanceTo(centre.current) < 9 ? 1 : 0;
    // Right round until they lie against the wall, so the leaves never stand in the lens.
    if (a.current) a.current.rotation.y = -stepSpring(live.current.a, near * 2.95, dt, 46, 7.5);
    if (b.current) b.current.rotation.y = stepSpring(live.current.b, near * 2.9, dt, 34, 6.4);
  });
  return (
    <group>
      {([1, -1] as const).map((s) => (
        <group key={s} ref={s > 0 ? a : b} position={[-ROOM_HALF.x + 0.1, 0, s * DOOR_HALF]}>
          <DoorLeaf accent={accent} hand={s} />
        </group>
      ))}
    </group>
  );
}
