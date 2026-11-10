"use client";

import { Instance, Instances } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { Blob, Plant, Rug, SkyWindow } from "../decor";
import { InRoom, ROLE } from "../Rooms";
import { Bag, Bottle, Chair } from "../props";
import { Ball, C, Cyl, Label, RBox, shade, mat } from "../../kit";
import { Person, stopFor } from "../../characters/Person";
import { LOOKS } from "../../characters/parts";

const FAR = -Math.PI / 2;
const BOOK_COLOURS = [C.red, C.blue, C.yellow, C.green, C.purple, C.orange, "#ff6fae", "#4a4e69"];
/** Deterministic little hash so the shelves look hand-filled but render the same every time. */
const rand = (n: number) => {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
};

function Shelf({ z, seed, width = 2.4 }: { z: number; seed: number; width?: number }) {
  const books = useMemo(() => {
    const out: { y: number; z: number; h: number; w: number; c: string; tilt: number }[] = [];
    [0.15, 0.75, 1.35, 1.95].forEach((y, row) => {
      let cz = -width / 2 + 0.15;
      for (let i = 0; cz < width / 2 - 0.2; i++) {
        const r = rand(seed * 100 + row * 20 + i);
        const w = 0.09 + r * 0.07;
        out.push({ y, z: cz + w / 2, h: 0.36 + rand(r * 50) * 0.16, w, c: BOOK_COLOURS[Math.floor(rand(r * 9 + i) * BOOK_COLOURS.length)], tilt: rand(r * 3) > 0.9 ? 0.25 : 0 });
        cz += w + 0.015;
      }
    });
    return out;
  }, [seed, width]);
  return (
    <group position={[4.2, 0, z]}>
      <RBox size={[0.55, 2.5, width]} radius={0.05} color={C.wood} position={[0.05, 1.25, 0]} cast />
      {[0.12, 0.72, 1.32, 1.92].map((y) => (
        <RBox key={y} size={[0.5, 0.05, width - 0.15]} radius={0.01} color={C.woodDark} position={[-0.05, y, 0]} />
      ))}
      <Instances material={mat(C.white)} limit={120}>
        <boxGeometry args={[0.3, 1, 1]} />
        {books.map((b, i) => (
          <Instance key={i} position={[-0.12, b.y + b.h / 2, b.z]} scale={[1, b.h, b.w]} rotation-x={b.tilt} color={b.c} />
        ))}
      </Instances>
      <Blob w={1} d={width + 0.4} position={[-0.2, 0, 0]} />
    </group>
  );
}

/** Open book on the desk; a page lifts and turns over every few seconds. */
function FlippingBook({ position }: { position: [number, number, number] }) {
  const page = useRef<THREE.Group>(null);
  useFrame((state) => {
    const k = (state.clock.elapsedTime * 0.4) % 1;
    const turn = k < 0.6 ? 0 : Math.min(1, (k - 0.6) / 0.3);
    if (page.current) page.current.rotation.z = -turn * Math.PI + Math.sin(turn * Math.PI) * 0.2;
  });
  return (
    <group position={position} rotation-y={-0.5}>
      <RBox size={[0.62, 0.04, 0.42]} radius={0.015} color={C.red} />
      <RBox size={[0.28, 0.035, 0.38]} radius={0.01} color={C.cream} position={[-0.15, 0.035, 0]} rotation-z={0.06} />
      <RBox size={[0.28, 0.035, 0.38]} radius={0.01} color={C.cream} position={[0.15, 0.035, 0]} rotation-z={-0.06} />
      <group ref={page} position={[0, 0.055, 0]}>
        <RBox size={[0.27, 0.008, 0.36]} radius={0.004} color={C.white} position={[0.14, 0, 0]} />
      </group>
    </group>
  );
}

/** Pendant lamp hanging from the ceiling, swinging very slightly. */
function Pendant({ position, colour }: { position: [number, number, number]; colour: string }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (ref.current) ref.current.rotation.z = Math.sin(state.clock.elapsedTime * 1.2 + position[2]) * 0.05;
  });
  return (
    <group ref={ref} position={position}>
      <Cyl r={0.012} h={0.7} color={C.ink} position={[0, -0.35, 0]} seg={6} />
      <Cyl r={0.06} rTop={0.3} h={0.25} color={colour} position={[0, -0.8, 0]} rotation-x={Math.PI} />
      <mesh position={[0, -0.92, 0]}>
        <sphereGeometry args={[0.08, 12, 8]} />
        <meshBasicMaterial color="#fff6c8" toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Tablet the student is holding: a quiz progress bar that fills, then three ticks. */
function Tablet() {
  const bar = useRef<THREE.Group>(null);
  useFrame((state) => {
    const k = (state.clock.elapsedTime * 0.3) % 1;
    if (bar.current) bar.current.scale.x = Math.max(0.05, Math.min(1, k * 1.4));
  });
  return (
    <group position={[0.02, 0.3, 0.37]} rotation-x={-1.0} scale={0.72}>
      <RBox size={[0.42, 0.3, 0.03]} radius={0.03} color={C.ink} />
      <mesh position={[0, 0, 0.017]}>
        <planeGeometry args={[0.36, 0.24]} />
        <meshBasicMaterial color="#dff6ff" toneMapped={false} />
      </mesh>
      <group ref={bar} position={[-0.15, -0.06, 0.02]}>
        <mesh position={[0.15, 0, 0]}>
          <planeGeometry args={[0.3, 0.04]} />
          <meshBasicMaterial color={C.green} toneMapped={false} />
        </mesh>
      </group>
      {[-0.08, 0, 0.08].map((x) => (
        <mesh key={x} position={[x, 0.05, 0.02]}>
          <circleGeometry args={[0.025, 10]} />
          <meshBasicMaterial color={C.yellow} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

export function Library() {
  const role = ROLE.student;
  return (
    <InRoom roleKey="student">
      <Rug r={1.7} accent={role.accent} position={[1.5, 0.02, 0.5]} />
      <Shelf z={-1.55} seed={1} />
      <Shelf z={2.3} seed={2} width={2.2} />
      <SkyWindow position={[4.42, 1.95, 0.4]} rotationY={FAR} w={1.05} h={1.25} curtain={shade(role.accent, 1.35)} />
      <group position={[4.42, 3.12, 0.4]} rotation-y={FAR}>
        <Label text="LIBRARY" w={1.3} h={0.32} bg={role.accent} fg={C.white} />
      </group>
      <group position={[3.6, 0, 2.95]} rotation-x={-0.18}>
        {[-0.22, 0.22].map((dz) => (
          <RBox key={dz} size={[0.08, 2.6, 0.08]} radius={0.03} color={C.woodDark} position={[0, 1.3, dz]} />
        ))}
        {[0.4, 0.85, 1.3, 1.75, 2.2].map((y) => (
          <RBox key={y} size={[0.06, 0.06, 0.5]} radius={0.02} color={C.wood} position={[0, y, 0]} />
        ))}
      </group>
      <Pendant position={[2.3, 3.6, -1.3]} colour={C.yellow} />
      <Pendant position={[2.6, 3.6, 1.5]} colour={shade(role.accent, 1.2)} />
      <group position={[2.5, 0, -1.7]}>
        <RBox size={[1.1, 0.1, 1.8]} radius={0.04} color={C.wood} position={[0, 0.76, 0]} cast />
        {[-0.75, 0.75].map((z) => (
          <RBox key={z} size={[0.9, 0.72, 0.1]} radius={0.03} color={C.woodDark} position={[0, 0.36, z]} />
        ))}
        <group position={[0.3, 0.81, -0.6]}>
          <Cyl r={0.12} h={0.04} color={C.ink} position={[0, 0.02, 0]} />
          <Cyl r={0.025} h={0.45} color={C.ink} position={[0, 0.24, 0]} seg={8} />
          <Cyl r={0.18} rTop={0.08} h={0.18} color={C.yellow} position={[0, 0.5, 0]} cast />
        </group>
        <FlippingBook position={[-0.1, 0.83, 0.05]} />
        {[C.red, C.blue, C.yellow].map((c, i) => (
          <RBox key={c} size={[0.45, 0.08, 0.32]} radius={0.02} color={c} position={[0.1, 0.85 + i * 0.085, 0.55]} rotation-y={i * 0.2 - 0.2} cast />
        ))}
        <Blob w={1.6} d={2.4} position={[0, 0, 0]} />
      </group>
      <group position={[2.45, 0, 2.45]}>
        <Ball r={0.6} color={shade(role.accent, 1.1)} position={[0, 0.33, 0]} scale={[1.2, 0.6, 1.2]} cast />
        <Ball r={0.25} color={C.yellow} position={[0.15, 0.62, 0.2]} scale={[1, 0.45, 1]} />
        <Blob w={1.8} position={[0, 0, 0]} />
      </group>
      {[C.green, C.orange, C.purple].map((c, i) => (
        <RBox key={c} size={[0.42, 0.09, 0.3]} radius={0.02} color={c} position={[3.2, 0.05 + i * 0.09, -0.15]} rotation-y={i * 0.3} />
      ))}
      <Chair position={[1.7, 0, -1.9]} rotationY={Math.PI / 2 + 0.3} colour={C.wood} />
      <Bag position={[1.65, 0, 1.55]} rotationY={0.5} colour={C.orange} />
      <Bottle position={[2.2, 0.81, -2.35]} colour={C.green} />
      <Plant position={[3.9, 0, -3.1]} scale={1.1} pot={C.white} />
      <Person look={LOOKS.student(role.accent)} action="read" stop={stopFor("student")} seed={4} front={<Tablet />} />
    </InRoom>
  );
}
