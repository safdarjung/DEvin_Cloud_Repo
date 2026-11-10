"use client";

import { Swing, Runner } from "../characters/Crowd";
import { Blob } from "../interior/decor";
import { C, Cyl, Label, RBox, glow, mat, metal, useLite } from "../kit";

/* Things a real school yard has: lamp posts, a notice board, bicycles, a bench, a playground. */

type V3 = [number, number, number];
const IRON = "#2a3136";

function LampPost({ position }: { position: V3 }) {
  const iron = metal(IRON, 0.5);
  return (
    <group position={position}>
      <Cyl r={0.12} rTop={0.07} h={0.5} m={iron} position={[0, 0.25, 0]} seg={10} />
      <Cyl r={0.045} h={3.1} m={iron} position={[0, 1.95, 0]} seg={8} cast />
      <RBox size={[0.34, 0.05, 0.34]} radius={0.015} m={iron} position={[0, 3.5, 0]} />
      <mesh material={glow("#fff2cc")} position={[0, 3.72, 0]}>
        <cylinderGeometry args={[0.15, 0.11, 0.38, 6]} />
      </mesh>
      <Cyl r={0.2} rTop={0.03} h={0.2} m={iron} position={[0, 4.0, 0]} seg={6} cast />
    </group>
  );
}

const NOTES = [
  { x: -0.55, y: 0.18, c: "#fff6d8", r: 0.05 },
  { x: 0.02, y: 0.22, c: "#dff0ff", r: -0.04 },
  { x: 0.58, y: 0.16, c: "#ffe1e8", r: 0.07 },
  { x: -0.35, y: -0.3, c: "#e6f6dc", r: -0.06 },
  { x: 0.35, y: -0.28, c: "#fffdf5", r: 0.03 },
];

function NoticeBoard({ position, rotationY = 0 }: { position: V3; rotationY?: number }) {
  return (
    <group position={position} rotation-y={rotationY}>
      {[-0.95, 0.95].map((x) => (
        <RBox key={x} size={[0.1, 2.3, 0.1]} radius={0.02} color={C.woodDark} position={[x, 1.15, 0]} cast />
      ))}
      <RBox size={[2.1, 1.3, 0.08]} radius={0.02} color={C.woodDark} position={[0, 1.55, 0]} cast />
      <RBox size={[1.9, 1.1, 0.04]} radius={0.01} m={mat("#c79b6a", { surface: "fabric" })} position={[0, 1.55, 0.035]} />
      <RBox size={[2.5, 0.07, 0.5]} radius={0.02} m={mat(C.trim, { surface: "roof" })} position={[0, 2.38, 0.05]} rotation-x={0.22} cast />
      <Label text="NOTICES" w={0.9} h={0.17} bg="#1f4d3a" fg="#f3d98f" px={256} position={[0, 2.0, 0.062]} />
      {NOTES.map((n) => (
        <group key={n.x} position={[n.x, 1.5 + n.y, 0.062]} rotation-z={n.r}>
          <RBox size={[0.42, 0.36, 0.008]} radius={0.004} color={n.c} />
          {[0.08, 0.02, -0.04].map((y) => (
            <RBox key={y} size={[0.3, 0.014, 0.004]} radius={0.002} color="#8f98a3" position={[0, y, 0.006]} />
          ))}
          <mesh material={mat(C.red, { rough: 0.3 })} position={[0, 0.14, 0.012]}>
            <sphereGeometry args={[0.018, 8, 6]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Bike({ position, colour, lean = 0.12 }: { position: V3; colour: string; lean?: number }) {
  const frame = metal(colour, 0.4);
  const tyre = mat("#22252b", { rough: 0.85 });
  return (
    <group position={position} rotation-x={lean}>
      {[-0.5, 0.5].map((x) => (
        <group key={x} position={[x, 0.33, 0]}>
          <mesh material={tyre} castShadow>
            <torusGeometry args={[0.3, 0.028, 6, 22]} />
          </mesh>
          <Cyl r={0.26} h={0.006} m={metal("#b9c0c8", 0.3)} rotation-x={Math.PI / 2} seg={14} />
        </group>
      ))}
      <Cyl r={0.022} h={0.62} m={frame} position={[-0.02, 0.58, 0]} rotation-z={1.1} seg={6} />
      <Cyl r={0.022} h={0.56} m={frame} position={[0.22, 0.56, 0]} rotation-z={-0.5} seg={6} />
      <Cyl r={0.022} h={0.58} m={frame} position={[-0.26, 0.55, 0]} rotation-z={0.42} seg={6} />
      <Cyl r={0.02} h={0.5} m={frame} position={[0.42, 0.6, 0]} rotation-z={0.3} seg={6} />
      <Cyl r={0.016} h={0.46} m={metal(IRON, 0.4)} position={[0.35, 0.88, 0]} rotation-x={Math.PI / 2} seg={6} />
      <RBox size={[0.24, 0.05, 0.1]} radius={0.02} color="#2a2422" position={[-0.14, 0.86, 0]} />
    </group>
  );
}

function BikeStand({ position }: { position: V3 }) {
  return (
    <group position={position}>
      <RBox size={[3.4, 0.05, 1.3]} radius={0.01} m={mat("#cfc6b6", { surface: "paving" })} position={[0, 0.025, 0]} />
      {[-1.2, -0.4, 0.4, 1.2].map((x) => (
        <mesh key={x} material={metal("#c9ced4", 0.35)} position={[x, 0.05, 0.25]} rotation-y={Math.PI / 2} castShadow>
          <torusGeometry args={[0.36, 0.022, 6, 14, Math.PI]} />
        </mesh>
      ))}
      <Bike position={[-0.8, 0.04, -0.05]} colour="#c2473d" />
      <Bike position={[0.05, 0.04, -0.02]} colour="#2f7fc4" lean={-0.1} />
      <Bike position={[0.85, 0.04, -0.06]} colour="#3d9a5c" />
    </group>
  );
}

function Bench({ position, rotationY = 0 }: { position: V3; rotationY?: number }) {
  return (
    <group position={position} rotation-y={rotationY}>
      {[-0.7, 0.7].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <RBox size={[0.06, 0.45, 0.5]} radius={0.015} m={metal(IRON, 0.5)} position={[0, 0.225, 0]} />
          <RBox size={[0.06, 0.5, 0.06]} radius={0.015} m={metal(IRON, 0.5)} position={[0, 0.68, -0.24]} rotation-x={-0.15} />
        </group>
      ))}
      {[-0.15, 0, 0.15].map((z) => (
        <RBox key={z} size={[1.7, 0.04, 0.13]} radius={0.015} color={C.wood} position={[0, 0.47, z]} cast />
      ))}
      {[0.66, 0.82].map((y) => (
        <RBox key={y} size={[1.7, 0.12, 0.035]} radius={0.015} color={C.wood} position={[0, y, -0.25 - (y - 0.66) * 0.15]} rotation-x={-0.15} cast />
      ))}
    </group>
  );
}

function Slide({ position, rotationY = 0 }: { position: V3; rotationY?: number }) {
  const steel = metal("#e0b23a", 0.45);
  return (
    <group position={position} rotation-y={rotationY}>
      {[-0.4, 0.4].flatMap((x) => [-0.4, 0.4].map((z) => <Cyl key={`${x}${z}`} r={0.04} h={1.5 + (z < 0 ? 0.8 : 0)} m={steel} position={[x, (1.5 + (z < 0 ? 0.8 : 0)) / 2, z]} seg={8} cast />))}
      <RBox size={[0.9, 0.06, 0.9]} radius={0.02} color={C.blue} position={[0, 1.5, 0]} cast />
      {[0.3, 0.6, 0.9, 1.2].map((y) => (
        <Cyl key={y} r={0.025} h={0.8} m={steel} position={[0, y, -0.4]} rotation-z={Math.PI / 2} seg={6} />
      ))}
      <group position={[0, 0.78, 1.55]} rotation-x={0.6}>
        <RBox size={[0.7, 0.05, 2.7]} radius={0.02} m={metal("#d7dce2", 0.2)} cast />
        {[-0.36, 0.36].map((x) => (
          <RBox key={x} size={[0.05, 0.18, 2.7]} radius={0.02} color={C.red} position={[x, 0.08, 0]} />
        ))}
      </group>
      <Blob w={1.6} d={3.4} position={[0, 0, 0.9]} />
    </group>
  );
}

export function Yard() {
  const lite = useLite();
  return (
    <group>
      {[3.6, 8.6].flatMap((z) => [-2.55, 2.55].map((x) => <LampPost key={`${x}:${z}`} position={[x, 0, z]} />))}
      <NoticeBoard position={[-4.7, 0, 8.7]} rotationY={0.2} />
      <BikeStand position={[6.4, 0, 8.6]} />
      <Bench position={[3.3, 0, 6.1]} rotationY={-Math.PI / 2} />
      <Slide position={[15.6, 0, 4.6]} rotationY={-0.5} />
      {!lite && (
        <>
          <Swing position={[11.6, 0, 6.6]} rotationY={-0.35} />
          <Runner centre={[-12.2, 0, 5.6]} radius={2.1} />
        </>
      )}
    </group>
  );
}
