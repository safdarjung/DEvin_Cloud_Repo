"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { PaperPlane } from "../Critters";
import { Blob, Bunting, Clock, SkyWindow } from "../decor";
import { InRoom, ROLE } from "../Interior";
import { Ball, C, Cyl, Label, RBox, shade } from "../kit";
import { Mascot, stopFor } from "../Mascot";

const FAR = -Math.PI / 2;

const KIDS = [
  { p: [2.05, 0, 2.05], c: C.yellow, seed: 0 },
  { p: [3.45, 0, 1.55], c: "#ff6fae", seed: 2.1 },
] as const;

/** Small classmate at a desk, facing the teacher; bobs as if paying (some) attention. */
function Kid({ position, color, seed }: { position: readonly number[]; color: string; seed: number }) {
  const ref = useRef<THREE.Group>(null);
  const hand = useRef<THREE.Group>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime * 2.2 + seed;
    if (ref.current) {
      ref.current.position.y = 0.55 + Math.abs(Math.sin(t)) * 0.06;
      ref.current.scale.y = 1 + Math.sin(t * 2) * 0.03;
    }
    // Every so often one hand goes up: "I know!"
    if (hand.current) hand.current.rotation.z = Math.sin(t * 0.35) > 0.75 ? -2.6 : -0.4;
  });
  const [x, , z] = position;
  return (
    <group position={[x, 0, z]} rotation-y={Math.atan2(0.8 - x, 0.6 - z)}>
      <RBox size={[0.85, 0.07, 0.55]} radius={0.03} color={C.wood} position={[0, 0.72, 0.45]} cast />
      {[-0.33, 0.33].map((dx) => (
        <RBox key={dx} size={[0.06, 0.7, 0.45]} radius={0.02} color={C.woodDark} position={[dx, 0.35, 0.45]} />
      ))}
      <RBox size={[0.36, 0.02, 0.26]} radius={0.01} color={C.white} position={[0.1, 0.77, 0.42]} rotation-y={0.2} />
      <RBox size={[0.55, 0.06, 0.5]} radius={0.03} color={C.blue} position={[0, 0.42, -0.05]} />
      <group ref={ref}>
        <Ball r={0.3} color={color} position={[0, 0.3, 0]} scale={[1, 1.1, 1]} cast />
        {[-0.1, 0.1].map((ex) => (
          <group key={ex} position={[ex, 0.42, 0.24]}>
            <Ball r={0.08} color={C.white} detail={10} />
            <Ball r={0.04} color={C.ink} position={[0, 0, 0.06]} detail={8} />
          </group>
        ))}
        <group ref={hand} position={[-0.27, 0.32, 0.05]}>
          <Ball r={0.07} color={color} position={[0, -0.18, 0]} scale={[1, 2.2, 1]} />
        </group>
      </group>
      <Blob w={1.1} d={1.2} position={[0, 0, 0.2]} />
    </group>
  );
}

/** Globe on the teacher's desk, turning on its tilted axis. */
function Globe({ position }: { position: [number, number, number] }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.8;
  });
  return (
    <group position={position}>
      <Cyl r={0.12} h={0.04} color={C.woodDark} />
      <Cyl r={0.02} h={0.22} color={C.yellow} position={[0, 0.12, 0]} seg={6} />
      <group position={[0, 0.42, 0]} rotation-z={0.4}>
        <mesh rotation-x={Math.PI / 2}>
          <torusGeometry args={[0.24, 0.012, 6, 28, Math.PI]} />
          <meshBasicMaterial color={C.yellow} />
        </mesh>
        <group ref={ref}>
          <Ball r={0.21} color={C.blue} cast />
          <Ball r={0.1} color={C.green} position={[0.12, 0.08, 0.12]} scale={[1, 0.8, 0.5]} />
          <Ball r={0.09} color={C.green} position={[-0.14, -0.04, 0.1]} scale={[0.8, 1.1, 0.5]} />
          <Ball r={0.08} color={C.green} position={[0.02, 0.1, -0.17]} scale={[1.2, 0.7, 0.5]} />
        </group>
      </group>
    </group>
  );
}

export function Classroom() {
  const role = ROLE.teacher;
  return (
    <InRoom roleKey="teacher">
      <Cyl r={1.8} h={0.03} color={shade(role.accent, 1.75)} position={[1.6, 0.02, 0.6]} seg={40} />
      <group position={[4.4, 1.95, -0.9]} rotation-y={FAR}>
        <RBox size={[3.6, 1.7, 0.1]} radius={0.06} color={C.wood} />
        <Label text={"A  B  C\n2 + 3 = 5"} w={3.3} h={1.42} bg="#2f6d55" fg="#f4fff8" position={[0, 0, 0.06]} />
        <RBox size={[3.2, 0.06, 0.16]} radius={0.02} color={C.woodDark} position={[0, -0.86, 0.08]} />
        {[C.white, C.yellow, "#ff9ebb"].map((c, i) => (
          <Cyl key={c} r={0.025} h={0.14} color={c} position={[0.6 + i * 0.18, -0.81, 0.1]} rotation-z={Math.PI / 2} seg={6} />
        ))}
      </group>
      <SkyWindow position={[4.42, 1.85, 2.2]} rotationY={FAR} w={1.1} h={1.2} curtain={shade(role.accent, 1.3)} />
      <Clock position={[4.42, 3.05, 2.2]} rotationY={FAR} rim={role.accent} r={0.26} />
      <Bunting a={[4.38, 3.4, -3.4]} b={[4.38, 3.4, 1.2]} n={14} sag={0.22} />
      <group position={[2.75, 0, -1.75]}>
        <RBox size={[1, 0.1, 1.6]} radius={0.04} color={C.wood} position={[0, 0.8, 0]} cast />
        <RBox size={[0.9, 0.75, 0.1]} radius={0.03} color={C.woodDark} position={[0, 0.38, -0.7]} />
        <RBox size={[0.9, 0.75, 0.1]} radius={0.03} color={C.woodDark} position={[0, 0.38, 0.7]} />
        <Ball r={0.13} color={C.red} position={[-0.15, 0.97, 0.45]} cast />
        <RBox size={[0.04, 0.1, 0.07]} radius={0.015} color={C.green} position={[-0.13, 1.12, 0.47]} rotation-z={0.4} />
        {[C.blue, C.orange, C.purple].map((c, i) => (
          <RBox key={c} size={[0.4, 0.07, 0.3]} radius={0.02} color={c} position={[0.15, 0.89 + i * 0.075, 0.1]} rotation-y={i * 0.25} />
        ))}
        <Globe position={[0.05, 0.85, -0.45]} />
        <Blob w={1.6} d={2.3} position={[0, 0, 0]} />
      </group>
      {KIDS.map((k) => (
        <Kid key={k.seed} position={k.p} color={k.c} seed={k.seed} />
      ))}
      <PaperPlane centre={[2.2, 2.55, 0.4]} radius={[1.6, 1.1]} speed={0.55} />
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
