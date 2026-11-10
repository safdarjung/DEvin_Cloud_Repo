"use client";

import { Instance, Instances, RoundedBoxGeometry } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { Blob, Clock, Plant } from "../decor";
import { InRoom, ROLE } from "../Interior";
import { Ball, C, Cyl, Label, RBox, shade, spring, stepSpring, toon, useLabel } from "../kit";
import { Mascot, stopFor } from "../Mascot";

const FAR = -Math.PI / 2;
const FOLDERS = [C.blue, C.red, C.yellow, C.green, C.purple, C.orange];

/** "Fees collected" chart: three bars fill up, hold, and start again. */
function FeeChart({ accent }: { accent: string }) {
  const bars = useRef<(THREE.Group | null)[]>([]);
  useFrame((state) => {
    const k = (state.clock.elapsedTime * 0.25) % 1;
    bars.current.forEach((b, i) => {
      if (b) b.scale.x = Math.max(0.02, Math.min(1, (k * 1.6 - i * 0.12) * [0.95, 0.75, 0.6][i]));
    });
  });
  return (
    <group position={[4.42, 2.5, -1.45]} rotation-y={FAR}>
      <RBox size={[1.9, 1.15, 0.06]} radius={0.08} color={C.white} />
      <Label text="FEES COLLECTED" w={1.6} h={0.22} bg={C.white} fg={C.ink} px={384} position={[0, 0.38, 0.04]} />
      {[C.green, accent, C.orange].map((c, i) => (
        <group key={c} position={[-0.75, 0.08 - i * 0.26, 0.04]}>
          <RBox size={[1.5, 0.15, 0.02]} radius={0.06} color="#eef0f4" position={[0.75, 0, 0]} />
          <group
            ref={(el) => {
              bars.current[i] = el;
            }}
          >
            <RBox size={[1.5, 0.15, 0.03]} radius={0.06} color={c} position={[0.75, 0, 0.01]} />
          </group>
        </group>
      ))}
    </group>
  );
}

/** Token display: the number flips to the next visitor every few seconds. */
function NowServing({ accent }: { accent: string }) {
  const digits = useRef<THREE.Group>(null);
  const flip = useRef(spring(1));
  const shown = useRef(-1);
  const textures = [useLabel("21", C.ink, C.yellow, 128, 96), useLabel("22", C.ink, C.yellow, 128, 96), useLabel("23", C.ink, C.yellow, 128, 96)];
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((state, dt) => {
    const n = Math.floor(state.clock.elapsedTime / 3) % textures.length;
    if (n !== shown.current) {
      shown.current = n;
      if (mat.current) mat.current.map = textures[n];
      flip.current.x = 0.1;
    }
    const s = stepSpring(flip.current, 1, dt, 260, 10);
    if (digits.current) digits.current.scale.y = s;
  });
  return (
    <group position={[4.42, 2.75, 0.55]} rotation-y={FAR}>
      <RBox size={[1.05, 0.62, 0.08]} radius={0.08} color={accent} />
      <Label text="NOW SERVING" w={0.9} h={0.14} bg={accent} fg={C.white} px={256} position={[0, 0.2, 0.05]} />
      <group ref={digits} position={[0, -0.07, 0.05]}>
        <mesh>
          <planeGeometry args={[0.55, 0.32]} />
          <meshBasicMaterial ref={mat} map={textures[0]} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

function ReceiptPrinter() {
  const paper = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (!paper.current) return;
    const k = (state.clock.elapsedTime * 0.45) % 1;
    paper.current.scale.y = 0.15 + Math.min(1, k * 1.6) * 0.85;
  });
  return (
    <group position={[0.1, 0.56, 1.2]} rotation-y={-0.2} scale={0.8}>
      <RBox size={[0.4, 0.22, 0.35]} radius={0.06} color={C.white} position={[0, 0.11, 0]} cast />
      <RBox size={[0.3, 0.04, 0.2]} radius={0.015} color={C.ink} position={[0, 0.23, 0]} />
      <group ref={paper} position={[-0.21, 0.2, 0]}>
        <RBox size={[0.02, 0.4, 0.22]} radius={0.005} color="#fffdf5" position={[0, 0.2, 0]} />
      </group>
    </group>
  );
}

export function FrontOffice() {
  const role = ROLE.admin;
  return (
    <InRoom roleKey="admin">
      <Cyl r={1.7} h={0.03} color={shade(role.accent, 1.7)} position={[1.5, 0.02, 0.5]} seg={40} />
      <FeeChart accent={role.accent} />
      <NowServing accent={role.accent} />
      <Clock position={[4.42, 2.85, 2.3]} rotationY={FAR} rim={role.accent} />
      <group position={[4.4, 0, -1.45]}>
        <RBox size={[0.32, 0.08, 1.9]} radius={0.03} color={C.wood} position={[-0.12, 1.2, 0]} />
        {FOLDERS.map((c, i) => (
          <RBox key={c} size={[0.26, 0.44, 0.13]} radius={0.03} color={c} position={[-0.14, 1.46, -0.75 + i * 0.29]} rotation-x={i === 5 ? 0.28 : 0} />
        ))}
      </group>
      <group position={[4.05, 0, 2.2]}>
        <RBox size={[0.7, 1.7, 1]} radius={0.06} color="#8fa8c8" position={[0, 0.85, 0]} cast />
        {[0.4, 0.95, 1.5].map((y) => (
          <group key={y}>
            <RBox size={[0.04, 0.42, 0.85]} radius={0.02} color="#a9c0dd" position={[-0.36, y, 0]} />
            <RBox size={[0.06, 0.06, 0.3]} radius={0.02} color={C.white} position={[-0.4, y + 0.08, 0]} />
          </group>
        ))}
        <Plant position={[0, 1.7, 0]} scale={0.6} pot={C.white} />
        <Blob w={1.1} d={1.4} position={[0, 0, 0]} />
      </group>
      <group position={[0.08, 0, 0.6]}>
        <RBox size={[0.55, 0.52, 1.9]} radius={0.08} color={C.white} position={[0, 0.26, 0]} cast />
        <RBox size={[0.7, 0.06, 2.05]} radius={0.03} color={role.accent} position={[0, 0.55, 0]} />
        <Blob w={1.1} d={2.6} position={[0, 0, 0]} />
      </group>
      <RBox size={[0.36, 0.01, 0.3]} radius={0.005} color="#fffdf5" position={[0.15, 0.585, 0.2]} />
      <Ball r={0.06} color={C.red} position={[0.15, 0.59, 0.2]} scale={[1, 0.08, 1]} detail={12} />
      <ReceiptPrinter />
      <group position={[0.05, 0.58, -0.2]}>
        <Cyl r={0.09} h={0.03} color={C.ink} />
        <Ball r={0.07} color={C.yellow} position={[0, 0.03, 0]} scale={[1, 0.8, 1]} detail={12} />
      </group>
      <Instances material={toon(C.white)} castShadow limit={12}>
        <RoundedBoxGeometry args={[0.32, 0.06, 0.24]} radius={0.02} smoothness={2} />
        {FOLDERS.map((c, i) => (
          <Instance key={c} position={[0.05, 0.61 + i * 0.065, -0.05]} rotation-y={(i % 3) * 0.12 - 0.1} color={c} />
        ))}
      </Instances>
      <Plant position={[2.3, 0, 3]} scale={1.1} pot={shade(role.accent, 0.9)} leaf={C.grassDark} />
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
