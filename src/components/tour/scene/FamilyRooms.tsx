"use client";

import { Instance, Instances } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { InRoom, ROLE } from "./Interior";
import { Ball, C, Cyl, Label, RBox, spring, stepSpring, toon } from "./kit";
import { Mascot } from "./Mascot";
import { stopFor } from "./StaffRooms";

export function FamilyRooms() {
  return (
    <>
      <Library />
      <ParentLounge />
    </>
  );
}

/* ---------- student: shelves of books, reading desk, tablet ---------- */

const BOOK_COLOURS = [C.red, C.blue, C.yellow, C.green, C.purple, C.orange, "#ff6fae", "#4a4e69"];

/** Deterministic little hash so the shelves look hand-filled but render the same every time. */
const rand = (n: number) => {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
};

function Shelf({ z, seed }: { z: number; seed: number }) {
  const books = useMemo(() => {
    const out: { y: number; z: number; h: number; w: number; c: string; tilt: number }[] = [];
    [0.15, 0.75, 1.35, 1.95].forEach((y, row) => {
      let cz = -1.05;
      for (let i = 0; cz < 1.0; i++) {
        const r = rand(seed * 100 + row * 20 + i);
        const w = 0.09 + r * 0.07;
        out.push({ y, z: cz + w / 2, h: 0.36 + rand(r * 50) * 0.16, w, c: BOOK_COLOURS[Math.floor(rand(r * 9 + i) * BOOK_COLOURS.length)], tilt: rand(r * 3) > 0.9 ? 0.25 : 0 });
        cz += w + 0.015;
      }
    });
    return out;
  }, [seed]);
  return (
    <group position={[4.2, 0, z]}>
      <RBox size={[0.55, 2.5, 2.4]} radius={0.05} color={C.wood} position={[0.05, 1.25, 0]} cast />
      {[0.12, 0.72, 1.32, 1.92].map((y) => (
        <RBox key={y} size={[0.5, 0.05, 2.25]} radius={0.01} color={C.woodDark} position={[-0.05, y, 0]} />
      ))}
      <Instances material={toon(C.white)} limit={120}>
        <boxGeometry args={[0.3, 1, 1]} />
        {books.map((b, i) => (
          <Instance key={i} position={[-0.12, b.y + b.h / 2, b.z]} scale={[1, b.h, b.w]} rotation-x={b.tilt} color={b.c} />
        ))}
      </Instances>
    </group>
  );
}

function Lamp({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <Cyl r={0.12} h={0.04} color={C.ink} position={[0, 0.02, 0]} />
      <Cyl r={0.025} h={0.45} color={C.ink} position={[0, 0.24, 0]} seg={8} />
      <Cyl r={0.18} rTop={0.08} h={0.18} color={C.yellow} position={[0, 0.5, 0]} cast />
      <mesh position={[0, 0.42, 0]}>
        <sphereGeometry args={[0.06, 10, 8]} />
        <meshBasicMaterial color="#fffbe0" />
      </mesh>
    </group>
  );
}

function Library() {
  const role = ROLE.student;
  return (
    <InRoom roleKey="student">
      <Cyl r={1.6} h={0.03} color="#d6e6ff" position={[1.4, 0.02, 0.3]} seg={32} />
      <Shelf z={-1.6} seed={1} />
      <Shelf z={1.4} seed={2} />
      <group position={[2.4, 0, -1.6]}>
        <RBox size={[1.1, 0.1, 1.8]} radius={0.04} color={C.wood} position={[0, 0.76, 0]} cast />
        {[-0.75, 0.75].map((z) => (
          <RBox key={z} size={[0.9, 0.72, 0.1]} radius={0.03} color={C.woodDark} position={[0, 0.36, z]} />
        ))}
        <Lamp position={[0.25, 0.81, -0.55]} />
        {[C.red, C.blue, C.yellow].map((c, i) => (
          <RBox key={c} size={[0.45, 0.08, 0.32]} radius={0.02} color={c} position={[0.05, 0.85 + i * 0.085, 0.4]} rotation-y={i * 0.2 - 0.2} cast />
        ))}
      </group>
      <Ball r={0.55} color={role.accent} position={[2.4, 0.32, 2.4]} scale={[1.2, 0.6, 1.2]} cast />
      <Mascot
        color={role.accent}
        action="read"
        accessory="cap"
        stop={stopFor("student")}
        seed={4}
        front={
          <group position={[0, 0.58, 0.5]} rotation-x={-0.6}>
            <RBox size={[0.42, 0.3, 0.03]} radius={0.03} color={C.ink} />
            <mesh position={[0, 0, 0.017]}>
              <planeGeometry args={[0.36, 0.24]} />
              <meshBasicMaterial color="#9fe0ff" />
            </mesh>
          </group>
        }
      />
    </InRoom>
  );
}

/* ---------- parent: sofa, phone with a popping notification, report card ---------- */

function Notification({ accent }: { accent: string }) {
  const ref = useRef<THREE.Group>(null);
  const pop = useRef(spring(0));
  useFrame((state, dt) => {
    const k = (state.clock.elapsedTime % 4.5) / 4.5;
    const show = k > 0.15 && k < 0.8;
    const s = stepSpring(pop.current, show ? 1 : 0, dt, 220, 10);
    if (ref.current) {
      ref.current.scale.setScalar(Math.max(0.001, s));
      ref.current.position.y = 2.15 + Math.sin(state.clock.elapsedTime * 2) * 0.04;
    }
  });
  return (
    <group ref={ref} position={[0.7, 2.15, 1.45]} rotation-y={-1.3}>
      <RBox size={[1.3, 0.42, 0.08]} radius={0.12} color={C.white} cast />
      <Label text="Report card ready" w={1.15} h={0.26} bg={C.white} fg={C.ink} position={[0.05, 0, 0.05]} />
      <Ball r={0.07} color={accent} position={[-0.56, 0.12, 0.06]} detail={10} />
      <mesh material={toon(C.white)} position={[-0.25, -0.26, 0]} rotation-z={Math.PI}>
        <coneGeometry args={[0.1, 0.16, 3]} />
      </mesh>
    </group>
  );
}

function ParentLounge() {
  const role = ROLE.parent;
  return (
    <InRoom roleKey="parent">
      <Cyl r={1.7} h={0.03} color="#ffe0ef" position={[1.6, 0.02, 0.2]} seg={32} />
      <group position={[3.6, 0, 0.6]}>
        <RBox size={[1.1, 0.45, 2.8]} radius={0.18} color={role.accent} position={[0, 0.3, 0]} cast />
        <RBox size={[0.4, 1, 2.8]} radius={0.18} color={role.accent} position={[0.45, 0.75, 0]} cast />
        {[-1, 1].map((s) => (
          <RBox key={s} size={[1.1, 0.7, 0.32]} radius={0.15} color={role.accent} position={[0, 0.45, s * 1.42]} cast />
        ))}
        <RBox size={[0.25, 0.5, 0.55]} radius={0.12} color={C.yellow} position={[0.15, 0.8, -0.7]} rotation-x={0.15} />
        <RBox size={[0.25, 0.5, 0.55]} radius={0.12} color={C.blue} position={[0.15, 0.8, 0.7]} rotation-x={-0.15} />
      </group>
      <group position={[4.38, 2.35, 0.6]} rotation-y={-Math.PI / 2}>
        <RBox size={[1.5, 1, 0.08]} radius={0.06} color={C.woodDark} />
        <RBox size={[1.3, 0.8, 0.08]} radius={0.04} color={C.window} position={[0, 0, 0.03]} />
        <Ball r={0.2} color={C.grass} position={[-0.2, -0.32, 0.07]} scale={[2.6, 1, 0.2]} />
        <Ball r={0.12} color={C.yellow} position={[0.35, 0.2, 0.07]} scale={[1, 1, 0.2]} />
      </group>
      <group position={[2, 0, -1.4]}>
        <RBox size={[1.2, 0.1, 0.8]} radius={0.05} color={C.wood} position={[0, 0.45, 0]} cast />
        <Cyl r={0.08} h={0.42} color={C.woodDark} position={[0, 0.21, 0]} seg={10} />
        <group position={[-0.1, 0.51, 0]} rotation={[-Math.PI / 2, 0, 0.3]}>
          <Label text={"REPORT CARD\nA+"} w={0.5} h={0.36} bg="#fffdf5" fg={role.accent} px={256} />
        </group>
        <Cyl r={0.08} h={0.16} color={C.white} position={[0.38, 0.58, 0.2]} />
      </group>
      <group position={[3.9, 0, -2.6]}>
        <Cyl r={0.15} h={0.05} color={C.ink} position={[0, 0.025, 0]} />
        <Cyl r={0.03} h={1.6} color={C.ink} position={[0, 0.8, 0]} seg={8} />
        <Cyl r={0.3} rTop={0.18} h={0.35} color={C.yellow} position={[0, 1.7, 0]} cast />
      </group>
      <Notification accent={role.accent} />
      <Mascot
        color={role.accent}
        action="phone"
        accessory="bow"
        stop={stopFor("parent")}
        seed={5}
        handL={
          <group position={[0, -0.05, 0.02]}>
            <RBox size={[0.07, 0.26, 0.14]} radius={0.025} color={C.ink} />
            <RBox size={[0.075, 0.2, 0.11]} radius={0.02} color="#9fe0ff" position={[0.005, 0, 0]} />
          </group>
        }
      />
    </InRoom>
  );
}
