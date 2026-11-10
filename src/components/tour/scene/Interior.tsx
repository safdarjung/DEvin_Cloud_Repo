"use client";

import { Instance, Instances, RoundedBoxGeometry } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { BACK_DOOR, CORRIDOR_END_Z, CORRIDOR_HALF, DOOR_H, DOOR_HALF, ROOM_HALF, ROOM_ORDER, ROOMS, ROOM_X } from "../path";
import { TOUR_ROLES, type TourRoleKey } from "../roles";
import { Bunting, EdgeShade, Plant } from "./decor";
import { Ball, C, Label, RBox, shade, spring, stepSpring, toon } from "./kit";

export const WALL_H = 3.6;
const START_Z = -0.4;
const LENGTH = START_Z - CORRIDOR_END_Z;
export const ROLE = Object.fromEntries(TOUR_ROLES.map((r) => [r.key, r])) as Record<TourRoleKey, (typeof TOUR_ROLES)[number]>;
const doorsOn = (side: number) => ROOM_ORDER.filter((k) => ROOMS[k].side === side).map((k) => ROOMS[k].z);
const LOCKER_COLOURS = [C.blue, C.orange, C.purple, C.green, C.red].map((c) => shade(c, 1.12));
/** Spots on the corridor walls kept free of lockers: notice board and plants. */
const FEATURES: { side: 1 | -1; z: number; half: number }[] = [
  { side: -1, z: -15, half: 1.9 },
  { side: 1, z: -23, half: 0.7 },
  { side: -1, z: -30.5, half: 0.6 },
  { side: 1, z: -40, half: 0.7 },
  { side: -1, z: -42.6, half: 0.9 },
];
/** Posters above the lockers: side, z, text, colour. */
const POSTERS: [1 | -1, number, string, string][] = [
  [1, -4, "BE KIND", C.red],
  [-1, -11, "READ!", C.blue],
  [1, -20, "SCIENCE FAIR", C.green],
  [-1, -27.5, "SPORTS DAY", C.orange],
  [1, -36.5, "ART CLUB", C.purple],
];

const flat = (color: string) => new THREE.MeshBasicMaterial({ color });

export function Interior() {
  const ceiling = useMemo(() => flat("#fff8ec"), []);
  return (
    <group>
      <Corridor ceiling={ceiling} />
      <BackDoor />
      {ROOM_ORDER.map((k) => (
        <RoomShell key={k} roleKey={k} ceiling={ceiling} />
      ))}
    </group>
  );
}

/* ---------- corridor ---------- */

function wallSegments(side: number): [number, number][] {
  const edges = [START_Z, ...doorsOn(side).flatMap((z) => [z + DOOR_HALF, z - DOOR_HALF]), CORRIDOR_END_Z];
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
      {([-1, 1] as const).map((s) => (
        <EdgeShade key={s} len={LENGTH} depth={0.7} position={[s * (CORRIDOR_HALF - 0.5), 0, START_Z - LENGTH / 2]} rotationY={s > 0 ? -Math.PI / 2 : Math.PI / 2} />
      ))}
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
              <RBox size={[0.08, 0.12, a - b]} radius={0.02} color="#5fc9b4" position={[s * (CORRIDOR_HALF - 0.03), 0.06, (a + b) / 2]} />
            </group>
          ))}
          {doorsOn(s).map((z) => (
            <group key={z}>
              <RBox size={[0.2, WALL_H - DOOR_H, DOOR_HALF * 2]} radius={0.02} color={C.wall} position={[s * (CORRIDOR_HALF + 0.1), (WALL_H + DOOR_H) / 2, z]} />
              {[-1, 1].map((e) => (
                <RBox key={e} size={[0.16, DOOR_H, 0.16]} radius={0.05} color={C.white} position={[s * (CORRIDOR_HALF - 0.02), DOOR_H / 2, z + e * DOOR_HALF]} />
              ))}
            </group>
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
      <Instances material={toon(C.white)} receiveShadow limit={200}>
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
      <Instances material={toon("#ffffff")} limit={200}>
        <boxGeometry args={[0.04, 0.03, 0.3]} />
        {lockers.flatMap(({ s, z }) => [1.62, 1.7, 1.78].map((y) => <Instance key={`${s}:${z}:${y}`} position={[s * (CORRIDOR_HALF - 0.52), y, z]} color="#e8e8e8" />))}
      </Instances>
      {POSTERS.map(([s, z, text, c]) => (
        <group key={z} position={[s * (CORRIDOR_HALF - 0.04), 2.55, z]} rotation={[0, -s * (Math.PI / 2), s * 0.04]}>
          <RBox size={[1.5, 0.62, 0.04]} radius={0.04} color={C.white} />
          <Label text={text} w={1.36} h={0.48} bg={c} fg={C.white} position={[0, 0, 0.03]} />
        </group>
      ))}
      <NoticeBoard />
      {FEATURES.slice(1).map((f) => (
        <Plant key={f.z} position={[f.side * (CORRIDOR_HALF - 0.45), 0, f.z]} leaf={f.z < -35 ? C.grassDark : C.green} />
      ))}
      <group position={[0, 3.05, -2.2]}>
        <RBox size={[2.6, 0.5, 0.06]} radius={0.08} color={C.yellow} />
        <Label text="WELCOME!" w={2.4} h={0.4} bg={C.yellow} fg={C.ink} position={[0, 0, 0.04]} />
      </group>
      <Bunting a={[-CORRIDOR_HALF, 3.45, -1.2]} b={[CORRIDOR_HALF, 3.45, -1.2]} n={9} sag={0.25} />
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

/** Garden doors at the end of the corridor; they swing out (with a bounce) as the camera comes. */
function BackDoor() {
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);
  const open = useRef(spring(0));
  const { half, height } = BACK_DOOR;
  useFrame((state, dt) => {
    const near = state.camera.position.z < CORRIDOR_END_Z + 7 ? 1 : 0;
    const a = stepSpring(open.current, near * 1.5, dt, 70, 6);
    if (left.current) left.current.rotation.y = a;
    if (right.current) right.current.rotation.y = -a;
  });
  const sidesW = CORRIDOR_HALF + 0.2 - half;
  return (
    <group position={[0, 0, CORRIDOR_END_Z]}>
      {[-1, 1].map((s) => (
        <RBox key={s} size={[sidesW, WALL_H, 0.2]} radius={0.02} color={C.wall} position={[s * (half + sidesW / 2), WALL_H / 2, -0.1]} />
      ))}
      <RBox size={[half * 2, WALL_H - height, 0.2]} radius={0.02} color={C.wall} position={[0, (WALL_H + height) / 2, -0.1]} />
      {[-1, 1].map((s) => (
        <RBox key={s} size={[0.2, height + 0.1, 0.32]} radius={0.06} color={C.trim} position={[s * (half + 0.05), height / 2, -0.05]} />
      ))}
      <RBox size={[half * 2 + 0.3, 0.24, 0.32]} radius={0.08} color={C.trim} position={[0, height + 0.05, -0.05]} />
      {([-1, 1] as const).map((s) => (
        <group key={s} ref={s < 0 ? left : right} position={[s * half, 0, -0.12]}>
          <RBox size={[half - 0.03, height - 0.06, 0.1]} radius={0.05} color={C.green} position={[-s * (half / 2), height / 2, 0]} />
          <RBox size={[half - 0.4, height * 0.45, 0.12]} radius={0.05} color={C.window} position={[-s * (half / 2), height * 0.64, 0]} />
          <Ball r={0.07} color={C.yellow} position={[-s * (half - 0.2), 1.4, 0.07]} detail={10} />
        </group>
      ))}
    </group>
  );
}

/* ---------- rooms ---------- */

/** Room-local frame: +x away from the corridor, origin at the room's floor centre. */
export function InRoom({ roleKey, children }: { roleKey: TourRoleKey; children: ReactNode }) {
  const { side, z } = ROOMS[roleKey];
  return (
    <group position={[side * ROOM_X, 0, z]} rotation-y={side === 1 ? 0 : Math.PI}>
      {children}
    </group>
  );
}

/** Wall tinted by the role accent, darker wainscot, chair rail, skirting and crown, shaded floor edges. */
function RoomShell({ roleKey, ceiling }: { roleKey: TourRoleKey; ceiling: THREE.Material }) {
  const accent = ROLE[roleKey].accent;
  const tone = useMemo(() => ({ wall: shade(accent, 1.8), dado: shade(accent, 1.55), floor: "#f1d39b" }), [accent]);
  const { x: hx, z: hz } = ROOM_HALF;
  const walls: { size: [number, number]; pos: [number, number]; rot: number }[] = [
    { size: [hz * 2, 0], pos: [hx, 0], rot: -Math.PI / 2 },
    { size: [hx * 2, 0], pos: [0.1, -hz], rot: 0 },
    { size: [hx * 2, 0], pos: [0.1, hz], rot: Math.PI },
  ];
  return (
    <InRoom roleKey={roleKey}>
      <RBox size={[hx * 2, 0.1, hz * 2]} radius={0.03} color={tone.floor} position={[0, -0.03, 0]} />
      {walls.map(({ size: [len], pos: [x, z], rot }) => (
        <group key={rot} position={[x, 0, z]} rotation-y={rot}>
          <RBox size={[len + 0.2, WALL_H, 0.2]} radius={0.02} color={tone.wall} position={[0, WALL_H / 2, -0.1]} />
          <RBox size={[len, 1.05, 0.05]} radius={0.02} color={tone.dado} position={[0, 0.53, 0.02]} />
          <RBox size={[len, 0.08, 0.1]} radius={0.03} color={C.white} position={[0, 1.07, 0.03]} />
          <RBox size={[len, 0.14, 0.08]} radius={0.03} color={shade(accent, 0.75)} position={[0, 0.07, 0.04]} />
          <RBox size={[len, 0.12, 0.12]} radius={0.04} color={C.white} position={[0, WALL_H - 0.06, 0.04]} />
          <EdgeShade len={len} position={[0, 0, 0.05]} />
        </group>
      ))}
      <mesh material={ceiling} position={[0, WALL_H, 0]} rotation-x={Math.PI / 2}>
        <planeGeometry args={[hx * 2 + 0.4, hz * 2 + 0.4]} />
      </mesh>
      <mesh position={[1, WALL_H - 0.03, 0]}>
        <cylinderGeometry args={[0.55, 0.55, 0.05, 24]} />
        <meshBasicMaterial color="#fffbe0" />
      </mesh>
      <RoomDoors accent={accent} />
    </InRoom>
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
    const angle = stepSpring(open.current, near * 1.7, dt, 80, 6.5);
    if (a.current) a.current.rotation.y = -angle;
    if (b.current) b.current.rotation.y = angle;
  });
  return (
    <group>
      {([1, -1] as const).map((s) => (
        <group key={s} ref={s > 0 ? a : b} position={[-ROOM_HALF.x + 0.12, 0, s * DOOR_HALF]}>
          <RBox size={[0.12, DOOR_H - 0.05, DOOR_HALF - 0.04]} radius={0.04} color={accent} position={[0, (DOOR_H - 0.05) / 2, -s * (DOOR_HALF / 2)]} />
          <Ball r={0.22} color={C.window} position={[0.02, 2.05, -s * (DOOR_HALF / 2)]} scale={[0.35, 1, 1]} />
          <Ball r={0.07} color={C.yellow} position={[0.1, 1.35, -s * (DOOR_HALF - 0.25)]} detail={10} />
        </group>
      ))}
    </group>
  );
}
