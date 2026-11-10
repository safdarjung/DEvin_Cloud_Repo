"use client";

import { Instance, Instances, RoundedBoxGeometry } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { CORRIDOR_END_Z, CORRIDOR_HALF, DOOR_HALF, ROOM_HALF, ROOM_ORDER, ROOMS, ROOM_X } from "../path";
import { TOUR_ROLES, type TourRoleKey } from "../roles";
import { Ball, C, Cyl, Label, RBox, spring, stepSpring, toon } from "./kit";

export const WALL_H = 3.6;
const DOOR_H = 2.9;
const START_Z = -0.4;
const LENGTH = START_Z - CORRIDOR_END_Z;
export const ROLE = Object.fromEntries(TOUR_ROLES.map((r) => [r.key, r])) as Record<TourRoleKey, (typeof TOUR_ROLES)[number]>;
const doorsOn = (side: number) => ROOM_ORDER.filter((k) => ROOMS[k].side === side).map((k) => ROOMS[k].z);
const LOCKER_COLOURS = [C.blue, C.orange, C.purple, C.green, C.red];
/** Spots on the corridor walls kept free of lockers: notice board and plants. */
const FEATURES: { side: 1 | -1; z: number; half: number }[] = [
  { side: -1, z: -15, half: 1.9 },
  { side: 1, z: -23, half: 0.7 },
  { side: -1, z: -30.5, half: 0.6 },
  { side: 1, z: -40, half: 0.7 },
];

const flat = (color: string) => new THREE.MeshBasicMaterial({ color });

export function Interior() {
  const ceiling = useMemo(() => flat("#fff8ec"), []);
  return (
    <group>
      <Corridor ceiling={ceiling} />
      {ROOM_ORDER.map((k) => (
        <RoomShell key={k} roleKey={k} ceiling={ceiling} />
      ))}
    </group>
  );
}

/* ---------- corridor ---------- */

function wallSegments(side: number): [number, number][] {
  const cuts = doorsOn(side).flatMap((z) => [z + DOOR_HALF, z - DOOR_HALF]);
  const edges = [START_Z, ...cuts, CORRIDOR_END_Z];
  const segs: [number, number][] = [];
  for (let i = 0; i < edges.length; i += 2) segs.push([edges[i], edges[i + 1]]);
  return segs;
}

function lockerSpots(side: 1 | -1): number[] {
  const out: number[] = [];
  for (let z = -1; z > CORRIDOR_END_Z + 0.6; z -= 0.56) {
    const nearDoor = doorsOn(side).some((d) => Math.abs(z - d) < DOOR_HALF + 0.7);
    const nearFeature = FEATURES.some((f) => f.side === side && Math.abs(z - f.z) < f.half + 0.3);
    if (!nearDoor && !nearFeature) out.push(z);
  }
  return out;
}

function Corridor({ ceiling }: { ceiling: THREE.Material }) {
  const tiles = useMemo(() => {
    const out: [number, number][] = [];
    for (let z = START_Z - 0.55; z > CORRIDOR_END_Z; z -= 1.1) for (const x of [-1.65, -0.55, 0.55, 1.65]) if ((Math.round(x * 10) + Math.round(z / 1.1)) % 2 === 0) out.push([x, z]);
    return out;
  }, []);
  const lockers = useMemo(() => ([-1, 1] as const).flatMap((s) => lockerSpots(s).map((z, i) => ({ s, z, c: LOCKER_COLOURS[(i + (s > 0 ? 2 : 0)) % LOCKER_COLOURS.length] }))), []);

  return (
    <group>
      <RBox size={[CORRIDOR_HALF * 2, 0.1, LENGTH]} radius={0.03} color="#ffe9b8" position={[0, -0.03, START_Z - LENGTH / 2]} />
      <Instances material={toon("#ffd98a")} receiveShadow limit={200}>
        <boxGeometry args={[1.06, 0.02, 1.06]} />
        {tiles.map(([x, z]) => (
          <Instance key={`${x}:${z}`} position={[x, 0.03, z]} />
        ))}
      </Instances>
      <mesh material={ceiling} position={[0, WALL_H, START_Z - LENGTH / 2]} rotation-x={Math.PI / 2}>
        <planeGeometry args={[CORRIDOR_HALF * 2 + 0.4, LENGTH]} />
      </mesh>
      <Instances material={flat("#fffbe0")} limit={20}>
        <cylinderGeometry args={[0.45, 0.45, 0.06, 20]} />
        {Array.from({ length: 11 }, (_, i) => (
          <Instance key={i} position={[0, WALL_H - 0.04, -2.5 - i * 4]} />
        ))}
      </Instances>
      {([-1, 1] as const).map((s) => (
        <group key={s}>
          {wallSegments(s).map(([a, b]) => (
            <group key={a}>
              <RBox size={[0.2, WALL_H, a - b]} radius={0.02} color={C.wall} position={[s * (CORRIDOR_HALF + 0.1), WALL_H / 2, (a + b) / 2]} />
              <RBox size={[0.06, 1.1, a - b]} radius={0.02} color="#9be7d8" position={[s * (CORRIDOR_HALF - 0.02), 0.55, (a + b) / 2]} />
            </group>
          ))}
          {doorsOn(s).map((z) => (
            <RBox key={z} size={[0.2, WALL_H - DOOR_H, DOOR_HALF * 2]} radius={0.02} color={C.wall} position={[s * (CORRIDOR_HALF + 0.1), (WALL_H + DOOR_H) / 2, z]} />
          ))}
        </group>
      ))}
      {ROOM_ORDER.map((k) => {
        const { side, z } = ROOMS[k];
        return (
          <group key={k} position={[side * (CORRIDOR_HALF - 0.03), DOOR_H + 0.33, z]} rotation-y={-side * (Math.PI / 2)}>
            <Label text={ROLE[k].room} w={3.1} h={0.5} bg={ROLE[k].accent} fg={C.white} />
          </group>
        );
      })}
      <Instances material={toon(C.white)} castShadow receiveShadow limit={200}>
        <RoundedBoxGeometry args={[0.44, 1.95, 0.5]} radius={0.06} smoothness={2} />
        {lockers.map(({ s, z, c }) => (
          <Instance key={`${s}:${z}`} position={[s * (CORRIDOR_HALF - 0.27), 0.98, z]} rotation-y={Math.PI / 2} color={c} />
        ))}
      </Instances>
      <Instances material={toon(C.white)} limit={200}>
        <boxGeometry args={[0.05, 0.22, 0.06]} />
        {lockers.map(({ s, z }) => (
          <Instance key={`${s}:${z}`} position={[s * (CORRIDOR_HALF - 0.53), 1.05, z - 0.13]} />
        ))}
      </Instances>
      <NoticeBoard />
      {FEATURES.slice(1).map((f) => (
        <Plant key={f.z} position={[f.side * (CORRIDOR_HALF - 0.45), 0, f.z]} />
      ))}
      <group position={[0, 0, CORRIDOR_END_Z]}>
        <RBox size={[CORRIDOR_HALF * 2 + 0.4, WALL_H, 0.2]} radius={0.02} color={C.wall} position={[0, WALL_H / 2, -0.1]} />
        <RBox size={[2.6, 1.8, 0.1]} radius={0.08} color={C.white} position={[0, 1.9, 0.02]} />
        <RBox size={[2.3, 1.5, 0.1]} radius={0.06} color={C.window} position={[0, 1.9, 0.05]} />
      </group>
    </group>
  );
}

const PAPERS = [
  { y: 0.35, z: -0.9, c: C.yellow, r: 0.08 },
  { y: 0.3, z: 0.1, c: "#ff9ebb", r: -0.06 },
  { y: -0.25, z: -0.5, c: C.blue, r: 0.05 },
  { y: -0.3, z: 0.75, c: C.white, r: -0.1 },
  { y: 0.32, z: 1.05, c: "#b6f09c", r: 0.12 },
];

function NoticeBoard() {
  return (
    <group position={[-CORRIDOR_HALF + 0.05, 1.75, -15]} rotation-y={Math.PI / 2}>
      <RBox size={[3.4, 1.7, 0.1]} radius={0.06} color={C.woodDark} />
      <RBox size={[3.15, 1.45, 0.1]} radius={0.04} color="#e7b77a" position={[0, 0, 0.03]} />
      <group position={[0, 0.98, 0.04]}>
        <Label text="NOTICE BOARD" w={2} h={0.32} bg={C.trim} fg={C.white} />
      </group>
      {PAPERS.map((p) => (
        <group key={p.z} position={[-p.z, p.y, 0.1]} rotation-z={p.r}>
          <RBox size={[0.62, 0.5, 0.02]} radius={0.01} color={p.c} />
          <Ball r={0.04} color={C.red} position={[0, 0.2, 0.03]} detail={8} />
        </group>
      ))}
    </group>
  );
}

function Plant({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <Cyl r={0.26} rTop={0.32} h={0.6} color={C.trim} position={[0, 0.3, 0]} cast />
      <Ball r={0.42} color={C.green} position={[0, 0.95, 0]} cast />
      <Ball r={0.3} color={C.grassDark} position={[0.2, 1.25, 0.1]} cast />
      <Ball r={0.26} color="#89e219" position={[-0.18, 1.2, -0.12]} cast />
    </group>
  );
}

/* ---------- rooms ---------- */

function RoomShell({ roleKey, ceiling }: { roleKey: TourRoleKey; ceiling: THREE.Material }) {
  const accent = ROLE[roleKey].accent;
  const tint = useMemo(() => `#${new THREE.Color(accent).lerp(new THREE.Color("#ffffff"), 0.78).getHexString()}`, [accent]);
  const { x: hx, z: hz } = ROOM_HALF;
  return (
    <InRoom roleKey={roleKey}>
      <RBox size={[hx * 2, 0.1, hz * 2]} radius={0.03} color="#f3d9a4" position={[0, -0.03, 0]} />
      <RBox size={[0.2, WALL_H, hz * 2 + 0.4]} radius={0.02} color={tint} position={[hx + 0.1, WALL_H / 2, 0]} />
      {[-1, 1].map((s) => (
        <RBox key={s} size={[hx * 2, WALL_H, 0.2]} radius={0.02} color={tint} position={[0.1, WALL_H / 2, s * (hz + 0.1)]} />
      ))}
      <RBox size={[0.06, 0.9, hz * 2]} radius={0.02} color={accent} position={[hx - 0.02, 0.45, 0]} />
      <mesh material={ceiling} position={[0, WALL_H, 0]} rotation-x={Math.PI / 2}>
        <planeGeometry args={[hx * 2 + 0.4, hz * 2 + 0.4]} />
      </mesh>
      <group position={[hx - 0.05, 2, -1.7]} rotation-y={-Math.PI / 2}>
        <RBox size={[2.4, 1.6, 0.1]} radius={0.08} color={C.white} />
        <RBox size={[2.15, 1.35, 0.1]} radius={0.06} color={C.window} position={[0, 0, 0.03]} />
        <Ball r={0.22} color={C.yellow} position={[0.6, 0.3, 0.08]} scale={[1, 1, 0.2]} />
      </group>
      <RoomDoors accent={accent} />
    </InRoom>
  );
}

/** Room-local frame: +x away from the corridor, origin at the room's floor centre. */
export function InRoom({ roleKey, children }: { roleKey: TourRoleKey; children: ReactNode }) {
  const { side, z } = ROOMS[roleKey];
  return (
    <group position={[side * ROOM_X, 0, z]} rotation-y={side === 1 ? 0 : Math.PI}>
      {children}
    </group>
  );
}

/** Double doors on the corridor side; they swing into the room as the camera comes near. */
function RoomDoors({ accent }: { accent: string }) {
  const a = useRef<THREE.Group>(null);
  const b = useRef<THREE.Group>(null);
  const open = useRef(spring(0));
  const centre = useRef(new THREE.Vector3());
  useFrame((state, dt) => {
    a.current?.parent?.localToWorld(centre.current.set(-ROOM_HALF.x, 1.4, 0));
    const near = state.camera.position.distanceTo(centre.current) < 7.5 ? 1 : 0;
    const angle = stepSpring(open.current, near * 1.45, dt, 80, 6.5);
    if (a.current) a.current.rotation.y = -angle;
    if (b.current) b.current.rotation.y = angle;
  });
  return (
    <group>
      {([1, -1] as const).map((s) => (
        <group key={s} ref={s > 0 ? a : b} position={[-ROOM_HALF.x + 0.12, 0, s * DOOR_HALF]}>
          <RBox size={[0.12, DOOR_H - 0.05, DOOR_HALF - 0.04]} radius={0.04} color={accent} position={[0, (DOOR_H - 0.05) / 2, -s * (DOOR_HALF / 2)]} cast />
          <Ball r={0.22} color={C.window} position={[0.02, 2.05, -s * (DOOR_HALF / 2)]} scale={[0.35, 1, 1]} />
          <Ball r={0.07} color={C.yellow} position={[0.1, 1.35, -s * (DOOR_HALF - 0.25)]} detail={10} />
        </group>
      ))}
    </group>
  );
}
