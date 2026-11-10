"use client";

import { Instance, Instances, RoundedBoxGeometry } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { STOPS, type StopKey } from "../path";
import { InRoom, ROLE } from "./Interior";
import { Ball, C, Cyl, Label, RBox, toon } from "./kit";
import { Mascot } from "./Mascot";

export const stopFor = (key: StopKey) => STOPS.find((s) => s.key === key)!;

/* Room-local frame: x=-4.5 is the corridor wall, x=+4.5 the far wall; the camera looks toward +x/-z. */

export function StaffRooms() {
  return (
    <>
      <PrincipalOffice />
      <FrontOffice />
      <Classroom />
    </>
  );
}

/* ---------- principal: desk, live dashboard, trophy ---------- */

const BARS = [0.55, 0.85, 0.65, 1];

function Dashboard({ accent }: { accent: string }) {
  const bars = useRef<(THREE.Group | null)[]>([]);
  const donut = useRef<THREE.Group>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    bars.current.forEach((b, i) => b && (b.scale.y = BARS[i] * (0.8 + 0.2 * Math.sin(t * 1.6 + i * 1.3))));
    if (donut.current) donut.current.rotation.z = t * 0.6;
  });
  return (
    <group position={[4.36, 1.95, -1.4]} rotation-y={-Math.PI / 2}>
      <RBox size={[2.6, 1.6, 0.12]} radius={0.1} color={C.ink} />
      <RBox size={[2.4, 0.18, 0.02]} radius={0.04} color={accent} position={[0, 0.6, 0.07]} />
      {BARS.map((_, i) => (
        <group key={i} ref={(el) => {
            bars.current[i] = el;
          }} position={[-0.95 + i * 0.32, -0.62, 0.08]}>
          <RBox size={[0.2, 0.9, 0.04]} radius={0.04} color={[C.green, C.blue, C.yellow, accent][i]} position={[0, 0.45, 0]} />
        </group>
      ))}
      <group ref={donut} position={[0.7, -0.08, 0.08]}>
        <mesh material={toon(C.green)}>
          <torusGeometry args={[0.36, 0.1, 8, 28, Math.PI * 1.4]} />
        </mesh>
        <mesh material={toon("#4a4e69")} rotation-z={Math.PI * 1.4}>
          <torusGeometry args={[0.36, 0.1, 8, 20, Math.PI * 0.6]} />
        </mesh>
      </group>
    </group>
  );
}

function Trophy({ position }: { position: [number, number, number] }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (ref.current) ref.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.8) * 0.4;
  });
  return (
    <group ref={ref} position={position}>
      <RBox size={[0.3, 0.1, 0.3]} radius={0.03} color={C.woodDark} position={[0, 0.05, 0]} />
      <Cyl r={0.05} h={0.16} color={C.yellow} position={[0, 0.18, 0]} seg={10} />
      <Cyl r={0.08} rTop={0.2} h={0.24} color={C.yellow} position={[0, 0.38, 0]} cast />
      {[-1, 1].map((s) => (
        <mesh key={s} material={toon(C.yellow)} position={[s * 0.2, 0.4, 0]} rotation-y={Math.PI / 2}>
          <torusGeometry args={[0.07, 0.02, 6, 12]} />
        </mesh>
      ))}
      <Ball r={0.05} color={C.white} position={[0, 0.45, 0.17]} detail={8} />
    </group>
  );
}

function PrincipalOffice() {
  const role = ROLE.principal;
  return (
    <InRoom roleKey="principal">
      <Cyl r={1.7} h={0.03} color="#ffd6c2" position={[1.4, 0.02, 0.2]} seg={32} />
      <Dashboard accent={role.accent} />
      <group position={[2.6, 0, -0.9]}>
        <RBox size={[1.1, 0.12, 2.2]} radius={0.05} color={C.wood} position={[0, 0.78, 0]} cast />
        {[-1, 1].map((s) => (
          <RBox key={s} size={[0.9, 0.72, 0.12]} radius={0.04} color={C.woodDark} position={[0, 0.36, s * 0.95]} cast />
        ))}
        <RBox size={[0.5, 0.06, 0.35]} radius={0.02} color={C.white} position={[-0.15, 0.87, -0.4]} rotation-y={0.2} />
        <Trophy position={[-0.1, 0.84, 0.75]} />
        <group position={[0.75, 0, 0]}>
          <RBox size={[0.6, 0.12, 0.6]} radius={0.06} color={C.ink} position={[0, 0.5, 0]} />
          <RBox size={[0.12, 0.8, 0.6]} radius={0.06} color={C.ink} position={[0.25, 0.95, 0]} />
          <Cyl r={0.05} h={0.45} color="#9aa0a6" position={[0, 0.22, 0]} seg={8} />
        </group>
      </group>
      <group position={[3.9, 0, 2.6]}>
        <Cyl r={0.26} rTop={0.32} h={0.6} color={C.trim} position={[0, 0.3, 0]} cast />
        <Ball r={0.45} color={C.green} position={[0, 1, 0]} cast />
      </group>
      <Mascot color={role.accent} action="point" accessory="tie" stop={stopFor("principal")} seed={1} />
    </InRoom>
  );
}

/* ---------- administrator: counter, stamp, fee receipts, files ---------- */

const FOLDERS = [C.blue, C.red, C.yellow, C.green, C.purple, C.orange];

function ReceiptPrinter() {
  const paper = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (!paper.current) return;
    const k = (state.clock.elapsedTime * 0.45) % 1;
    paper.current.scale.y = 0.15 + Math.min(1, k * 1.6) * 0.85;
  });
  return (
    <group position={[0.05, 0.66, 1.65]} rotation-y={-0.2}>
      <RBox size={[0.4, 0.22, 0.35]} radius={0.06} color={C.white} position={[0, 0.11, 0]} cast />
      <RBox size={[0.3, 0.04, 0.2]} radius={0.015} color={C.ink} position={[0, 0.23, 0]} />
      <group ref={paper} position={[-0.21, 0.2, 0]}>
        <RBox size={[0.02, 0.4, 0.22]} radius={0.005} color="#fffdf5" position={[0, 0.2, 0]} />
      </group>
    </group>
  );
}

function FrontOffice() {
  const role = ROLE.admin;
  return (
    <InRoom roleKey="admin">
      <Cyl r={1.6} h={0.03} color="#e3dcff" position={[1.3, 0.02, 0.4]} seg={32} />
      <group position={[0.02, 0, 0.6]}>
        <RBox size={[0.65, 0.62, 3]} radius={0.08} color={C.white} position={[0, 0.31, 0]} cast />
        <RBox size={[0.8, 0.07, 3.15]} radius={0.03} color={role.accent} position={[0, 0.65, 0]} />
      </group>
      <RBox size={[0.36, 0.01, 0.3]} radius={0.005} color="#fffdf5" position={[0.15, 0.69, 0.2]} />
      <Ball r={0.06} color={C.red} position={[0.15, 0.695, 0.2]} scale={[1, 0.08, 1]} detail={12} />
      <ReceiptPrinter />
      <Instances material={toon(C.white)} castShadow limit={12}>
        <RoundedBoxGeometry args={[0.32, 0.06, 0.24]} radius={0.02} smoothness={2} />
        {FOLDERS.map((c, i) => (
          <Instance key={c} position={[0.05, 0.71 + i * 0.065, -0.55]} rotation-y={(i % 3) * 0.12 - 0.1} color={c} />
        ))}
      </Instances>
      <group position={[4.1, 0, 1.6]}>
        <RBox size={[0.7, 1.7, 1]} radius={0.06} color="#8fa8c8" position={[0, 0.85, 0]} cast />
        {[0.4, 0.95, 1.5].map((y) => (
          <group key={y}>
            <RBox size={[0.04, 0.42, 0.85]} radius={0.02} color="#a9c0dd" position={[-0.36, y, 0]} />
            <RBox size={[0.06, 0.06, 0.3]} radius={0.02} color={C.white} position={[-0.4, y + 0.08, 0]} />
          </group>
        ))}
      </group>
      <group position={[4.4, 0, -1]}>
        <RBox size={[0.3, 0.08, 2]} radius={0.03} color={C.wood} position={[-0.1, 1.75, 0]} />
        {FOLDERS.map((c, i) => (
          <RBox key={c} size={[0.26, 0.42, 0.12]} radius={0.03} color={c} position={[-0.12, 2, -0.75 + i * 0.28]} rotation-x={i === 5 ? 0.25 : 0} />
        ))}
      </group>
      <group position={[4.38, 2.75, 0.6]} rotation-y={-Math.PI / 2}>
        <Label text="FEE COUNTER" w={1.8} h={0.36} bg={role.accent} fg={C.white} />
      </group>
      <Mascot
        color={role.accent}
        action="stamp"
        accessory="glasses"
        stop={stopFor("admin")}
        seed={2}
        handR={
          <group position={[0, -0.04, 0]}>
            <Cyl r={0.04} h={0.16} color={C.woodDark} position={[0, -0.04, 0]} seg={8} />
            <RBox size={[0.17, 0.07, 0.13]} radius={0.025} color={C.red} position={[0, -0.15, 0]} />
          </group>
        }
      />
    </InRoom>
  );
}

/* ---------- teacher: chalkboard, desks with bobbing kids ---------- */

const KIDS = [
  { p: [-0.9, 0, -2.3], c: C.yellow },
  { p: [0.9, 0, -2.5], c: C.blue },
  { p: [2.5, 0, -2.4], c: "#ff6fae" },
] as const;

function Kid({ position, color, seed }: { position: readonly number[]; color: string; seed: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime * 2.2 + seed;
    ref.current.position.y = 0.55 + Math.abs(Math.sin(t)) * 0.06;
    ref.current.scale.y = 1 + Math.sin(t * 2) * 0.03;
  });
  return (
    <group position={position as [number, number, number]} rotation-y={Math.PI / 2 + 0.3}>
      <RBox size={[0.9, 0.08, 0.6]} radius={0.03} color={C.wood} position={[0, 0.72, 0.45]} cast />
      {[-0.35, 0.35].map((x) => (
        <RBox key={x} size={[0.06, 0.7, 0.5]} radius={0.02} color={C.woodDark} position={[x, 0.35, 0.45]} />
      ))}
      <group ref={ref}>
        <Ball r={0.3} color={color} position={[0, 0.3, 0]} scale={[1, 1.1, 1]} cast />
        <Ball r={0.08} color={C.white} position={[-0.1, 0.42, 0.24]} detail={10} />
        <Ball r={0.08} color={C.white} position={[0.1, 0.42, 0.24]} detail={10} />
        <Ball r={0.04} color={C.ink} position={[-0.1, 0.42, 0.31]} detail={8} />
        <Ball r={0.04} color={C.ink} position={[0.1, 0.42, 0.31]} detail={8} />
      </group>
    </group>
  );
}

function Classroom() {
  const role = ROLE.teacher;
  return (
    <InRoom roleKey="teacher">
      <group position={[4.36, 1.95, -0.9]} rotation-y={-Math.PI / 2}>
        <RBox size={[3.6, 1.7, 0.1]} radius={0.06} color={C.wood} />
        <Label text={"A  B  C\n2 + 3 = 5"} w={3.3} h={1.42} bg="#2f6d55" fg="#f4fff8" position={[0, 0, 0.06]} />
        <RBox size={[3.2, 0.06, 0.16]} radius={0.02} color={C.woodDark} position={[0, -0.86, 0.08]} />
      </group>
      {KIDS.map((k, i) => (
        <Kid key={i} position={k.p} color={k.c} seed={i * 1.9} />
      ))}
      <group position={[2.4, 0, 2.1]}>
        <RBox size={[1, 0.1, 1.6]} radius={0.04} color={C.wood} position={[0, 0.8, 0]} cast />
        <RBox size={[0.9, 0.75, 0.1]} radius={0.03} color={C.woodDark} position={[0, 0.38, -0.7]} />
        <RBox size={[0.9, 0.75, 0.1]} radius={0.03} color={C.woodDark} position={[0, 0.38, 0.7]} />
        <Ball r={0.13} color={C.red} position={[-0.1, 0.97, 0.3]} cast />
        <RBox size={[0.04, 0.1, 0.07]} radius={0.015} color={C.green} position={[-0.08, 1.12, 0.32]} rotation-z={0.4} />
        <Ball r={0.22} color={C.blue} position={[0.15, 1.1, -0.35]} />
      </group>
      <Mascot
        color={role.accent}
        action="write"
        stop={stopFor("teacher")}
        seed={3}
        handR={
          <group>
            <Cyl r={0.02} h={0.9} color={C.wood} position={[0, -0.38, 0]} seg={8} />
            <Ball r={0.04} color={C.red} position={[0, -0.83, 0]} detail={8} />
          </group>
        }
        handL={<RBox size={[0.24, 0.3, 0.06]} radius={0.03} color={C.blue} position={[0, -0.08, 0.06]} />}
      />
    </InRoom>
  );
}
