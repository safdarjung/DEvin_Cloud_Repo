"use client";

import { Instance, Instances, RoundedBoxGeometry } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { BACK_DOOR, CORRIDOR_END_Z, CORRIDOR_HALF, DOOR_H, DOOR_HALF, ROOM_ORDER, ROOMS } from "../../path";
import { Ball, C, Cyl, Label, RBox, Zone, glass, mat, metal, shade, spring, stepSpring, surf } from "../kit";
import { Bunting, CeilingLight, EdgeShade, Plant } from "./decor";
import { CORRIDOR_FROM, ROLE, RoomShell, WALL_H, ceilingMaterial, roomZone } from "./Rooms";

const START_Z = -0.4;
const LENGTH = START_Z - CORRIDOR_END_Z;
const doorsOn = (side: number) => ROOM_ORDER.filter((k) => ROOMS[k].side === side).map((k) => ROOMS[k].z);
/** Powder-coated steel lockers: the school colours, knocked back so the rooms stay the brightest thing. */
const LOCKER_COLOURS = ["#5f8fb8", "#c98a4e", "#8f7fb5", "#6f9f6a", "#b86a62"];
/** Spots on the corridor walls kept free of lockers: notice board, plants, water cooler. */
const FEATURES: { side: 1 | -1; z: number; half: number }[] = [
  { side: -1, z: -15, half: 1.9 },
  { side: 1, z: -23, half: 0.7 },
  { side: -1, z: -30.5, half: 0.6 },
  { side: 1, z: -40, half: 0.7 },
  { side: -1, z: -42.6, half: 0.9 },
];
/** Posters above the lockers: side, z, text, colour. */
const POSTERS: [1 | -1, number, string, string][] = [
  [1, -4, "BE KIND", "#c9564b"],
  [-1, -11, "READ!", "#3c7fb5"],
  [1, -20, "SCIENCE FAIR", "#4f9a55"],
  [-1, -27.5, "SPORTS DAY", "#d98a34"],
  [1, -36.5, "ART CLUB", "#8f6cc0"],
];
const LIGHTS_Z = Array.from({ length: 11 }, (_, i) => -2.5 - i * 4);

export function Interior() {
  return (
    <Zone max={CORRIDOR_FROM}>
      <Corridor />
      <BackDoor />
      {ROOM_ORDER.map((k) => (
        <Zone key={k} {...roomZone(k)}>
          <RoomShell roleKey={k} />
        </Zone>
      ))}
    </Zone>
  );
}

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

/** Terrazzo floor, plaster walls over a glazed-tile dado, lockers, door frames with name plates, strip lights. */
function Corridor() {
  const lockers = useMemo(() => ([-1, 1] as const).flatMap((s) => lockerSpots(s).map((z, i) => ({ s, z, c: LOCKER_COLOURS[(i + (s > 0 ? 2 : 0)) % LOCKER_COLOURS.length] }))), []);
  const plaster = surf("plaster", C.wall);
  const dado = mat("#8fbdb2", { rough: 0.28 });
  const frame = mat(C.woodDark);
  return (
    <group>
      <RBox size={[CORRIDOR_HALF * 2, 0.1, LENGTH]} radius={0.02} m={surf("tiles")} position={[0, -0.03, START_Z - LENGTH / 2]} />
      {([-1, 1] as const).map((s) => (
        <EdgeShade key={s} len={LENGTH} depth={0.7} position={[s * (CORRIDOR_HALF - 0.5), 0, START_Z - LENGTH / 2]} rotationY={s > 0 ? -Math.PI / 2 : Math.PI / 2} />
      ))}
      <mesh material={ceilingMaterial()} position={[0, WALL_H, START_Z - LENGTH / 2]} rotation-x={Math.PI / 2}>
        <planeGeometry args={[CORRIDOR_HALF * 2 + 0.4, LENGTH]} />
      </mesh>
      {LIGHTS_Z.map((z) => (
        <CeilingLight key={z} position={[0, WALL_H, z]} />
      ))}
      {([-1, 1] as const).map((s) => (
        <group key={s}>
          {wallSegments(s).map(([a, b]) => (
            <group key={a}>
              <RBox size={[0.2, WALL_H, a - b]} radius={0.02} m={plaster} position={[s * (CORRIDOR_HALF + 0.1), WALL_H / 2, (a + b) / 2]} />
              <RBox size={[0.05, 1.15, a - b]} radius={0.01} m={dado} position={[s * (CORRIDOR_HALF - 0.02), 0.6, (a + b) / 2]} />
              <RBox size={[0.07, 0.06, a - b]} radius={0.02} color={C.white} position={[s * (CORRIDOR_HALF - 0.03), 1.2, (a + b) / 2]} />
              <RBox size={[0.07, 0.14, a - b]} radius={0.02} m={mat("#4f8f84", { rough: 0.4 })} position={[s * (CORRIDOR_HALF - 0.03), 0.07, (a + b) / 2]} />
              <RBox size={[0.1, 0.12, a - b]} radius={0.03} color={C.white} position={[s * (CORRIDOR_HALF - 0.04), WALL_H - 0.06, (a + b) / 2]} />
            </group>
          ))}
          {doorsOn(s).map((z) => (
            <group key={z}>
              <RBox size={[0.2, WALL_H - DOOR_H, DOOR_HALF * 2]} radius={0.02} m={plaster} position={[s * (CORRIDOR_HALF + 0.1), (WALL_H + DOOR_H) / 2, z]} />
              {[-1, 1].map((e) => (
                <RBox key={e} size={[0.34, DOOR_H, 0.14]} radius={0.03} m={frame} position={[s * (CORRIDOR_HALF + 0.08), DOOR_H / 2, z + e * (DOOR_HALF + 0.09)]} />
              ))}
              <RBox size={[0.34, 0.14, DOOR_HALF * 2 + 0.32]} radius={0.03} m={frame} position={[s * (CORRIDOR_HALF + 0.08), DOOR_H + 0.05, z]} />
            </group>
          ))}
        </group>
      ))}
      {ROOM_ORDER.map((k) => {
        const { side, z } = ROOMS[k];
        return (
          <group key={k} position={[side * (CORRIDOR_HALF - 0.03), DOOR_H + 0.4, z]} rotation-y={-side * (Math.PI / 2)}>
            <RBox size={[3.2, 0.5, 0.03]} radius={0.01} m={metal(C.brass, 0.4)} position={[0, 0, -0.012]} />
            <Label text={ROLE[k].room} w={3.1} h={0.42} bg={shade(ROLE[k].accent, 0.85)} fg={C.white} position={[0, 0, 0.006]} />
          </group>
        );
      })}
      <Instances material={mat("#ffffff", { rough: 0.42, metal: 0.25 })} receiveShadow limit={200}>
        <RoundedBoxGeometry args={[0.44, 1.95, 0.5]} radius={0.03} smoothness={2} />
        {lockers.map(({ s, z, c }) => (
          <Instance key={`${s}:${z}`} position={[s * (CORRIDOR_HALF - 0.27), 0.98, z]} rotation-y={Math.PI / 2} color={c} />
        ))}
      </Instances>
      <Instances material={metal(C.steel, 0.3)} limit={200}>
        <boxGeometry args={[0.05, 0.2, 0.05]} />
        {lockers.map(({ s, z }) => (
          <Instance key={`${s}:${z}`} position={[s * (CORRIDOR_HALF - 0.53), 1.05, z - 0.13]} />
        ))}
      </Instances>
      <Instances material={mat("#3d4650", { rough: 0.6 })} limit={600}>
        <boxGeometry args={[0.04, 0.02, 0.3]} />
        {lockers.flatMap(({ s, z }) => [1.6, 1.66, 1.72, 1.78].map((y) => <Instance key={`${s}:${z}:${y}`} position={[s * (CORRIDOR_HALF - 0.515), y, z]} />))}
      </Instances>
      {POSTERS.map(([s, z, text, c]) => (
        <group key={z} position={[s * (CORRIDOR_HALF - 0.04), 2.62, z]} rotation={[0, -s * (Math.PI / 2), s * 0.03]}>
          <RBox size={[1.5, 0.62, 0.03]} radius={0.02} color={C.white} />
          <Label text={text} w={1.36} h={0.48} bg={c} fg={C.white} position={[0, 0, 0.02]} />
        </group>
      ))}
      <NoticeBoard />
      <WaterCooler position={[-CORRIDOR_HALF + 0.3, 0, -30.5]} />
      {FEATURES.filter((f) => f.z !== -15 && f.z !== -30.5).map((f) => (
        <Plant key={f.z} position={[f.side * (CORRIDOR_HALF - 0.45), 0, f.z]} leaf={f.z < -35 ? C.grassDark : C.green} />
      ))}
      <group position={[0, 3.05, -2.2]}>
        <RBox size={[2.6, 0.5, 0.05]} radius={0.04} m={mat("#1f4d3a", { rough: 0.5 })} />
        <Label text="WELCOME" w={2.4} h={0.4} bg="#1f4d3a" fg="#f3d98f" position={[0, 0, 0.03]} />
      </group>
      <Bunting a={[-CORRIDOR_HALF, 3.45, -1.2]} b={[CORRIDOR_HALF, 3.45, -1.2]} n={9} sag={0.25} />
    </group>
  );
}

function WaterCooler({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <RBox size={[0.4, 1.05, 0.4]} radius={0.04} color={C.white} position={[0, 0.53, 0]} cast />
      <Cyl r={0.15} h={0.42} m={mat("#9fd0ea", { rough: 0.1, metal: 0.3 })} position={[0, 1.28, 0]} />
      <Cyl r={0.06} h={0.06} m={mat("#9fd0ea", { rough: 0.1, metal: 0.3 })} position={[0, 1.52, 0]} seg={10} />
      {[C.blue, C.red].map((c, i) => (
        <RBox key={c} size={[0.05, 0.05, 0.05]} radius={0.015} color={c} position={[0.21, 0.82, -0.07 + i * 0.14]} />
      ))}
      <RBox size={[0.08, 0.02, 0.26]} radius={0.01} m={metal(C.steel, 0.4)} position={[0.23, 0.66, 0]} />
    </group>
  );
}

const PAPERS = [
  { y: 0.35, z: -0.9, c: "#fff3c4", r: 0.08 },
  { y: 0.3, z: 0.1, c: "#ffd9e2", r: -0.06 },
  { y: -0.25, z: -0.5, c: "#d6ecff", r: 0.05 },
  { y: -0.3, z: 0.75, c: "#fffdf5", r: -0.1 },
  { y: 0.32, z: 1.05, c: "#def2d0", r: 0.12 },
  { y: -0.28, z: -1.25, c: "#fffdf5", r: -0.04 },
];

function NoticeBoard() {
  return (
    <group position={[-CORRIDOR_HALF + 0.05, 1.75, -15]} rotation-y={Math.PI / 2}>
      <RBox size={[3.4, 1.7, 0.08]} radius={0.03} color={C.woodDark} />
      <RBox size={[3.15, 1.45, 0.08]} radius={0.02} m={mat("#c79b6a", { surface: "fabric" })} position={[0, 0, 0.02]} />
      <group position={[0, 0.98, 0.04]}>
        <Label text="NOTICE BOARD" w={2} h={0.32} bg={C.trim} fg={C.white} />
      </group>
      {PAPERS.map((p) => (
        <group key={p.z} position={[-p.z, p.y, 0.07]} rotation-z={p.r}>
          <RBox size={[0.62, 0.5, 0.01]} radius={0.005} color={p.c} />
          {[0.12, 0.04, -0.04, -0.12].map((y) => (
            <RBox key={y} size={[0.46, 0.02, 0.004]} radius={0.002} color="#8f98a3" position={[0, y, 0.007]} />
          ))}
          <Ball r={0.03} color={C.red} position={[0, 0.2, 0.02]} detail={8} />
        </group>
      ))}
    </group>
  );
}

/** Garden doors at the end of the corridor: glazed, with a push bar; they swing out as the camera comes. */
function BackDoor() {
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);
  const live = useRef({ l: spring(0), r: spring(0) });
  const { half, height } = BACK_DOOR;
  useFrame((state, dt) => {
    const near = state.camera.position.z < CORRIDOR_END_Z + 7 ? 1 : 0;
    if (left.current) left.current.rotation.y = stepSpring(live.current.l, near * 1.5, dt, 40, 5.2);
    if (right.current) right.current.rotation.y = -stepSpring(live.current.r, near * 1.45, dt, 30, 4.6);
  });
  const sidesW = CORRIDOR_HALF + 0.2 - half;
  const plaster = surf("plaster", C.wall);
  const paint = mat("#2f6a4f", { rough: 0.45 });
  return (
    <group position={[0, 0, CORRIDOR_END_Z]}>
      {[-1, 1].map((s) => (
        <RBox key={s} size={[sidesW, WALL_H, 0.2]} radius={0.02} m={plaster} position={[s * (half + sidesW / 2), WALL_H / 2, -0.1]} />
      ))}
      <RBox size={[half * 2, WALL_H - height, 0.2]} radius={0.02} m={plaster} position={[0, (WALL_H + height) / 2, -0.1]} />
      {[-1, 1].map((s) => (
        <RBox key={s} size={[0.2, height + 0.1, 0.32]} radius={0.03} color={C.woodDark} position={[s * (half + 0.05), height / 2, -0.05]} />
      ))}
      <RBox size={[half * 2 + 0.3, 0.22, 0.32]} radius={0.03} color={C.woodDark} position={[0, height + 0.05, -0.05]} />
      {([-1, 1] as const).map((s) => (
        <group key={s} ref={s < 0 ? left : right} position={[s * half, 0, -0.12]}>
          <group position={[-s * (half / 2), 0, 0]}>
            <RBox size={[half - 0.03, height - 0.06, 0.08]} radius={0.02} m={paint} position={[0, height / 2, 0]} />
            <RBox size={[half - 0.36, height * 0.5, 0.1]} radius={0.02} m={glass()} position={[0, height * 0.62, 0]} />
            <RBox size={[0.05, height * 0.5, 0.11]} radius={0.01} m={paint} position={[0, height * 0.62, 0]} />
            <RBox size={[half - 0.36, 0.05, 0.11]} radius={0.01} m={paint} position={[0, height * 0.62, 0]} />
            <RBox size={[half - 0.3, 0.07, 0.05]} radius={0.02} m={metal(C.steel, 0.3)} position={[0, 1.1, 0.07]} />
          </group>
        </group>
      ))}
    </group>
  );
}
