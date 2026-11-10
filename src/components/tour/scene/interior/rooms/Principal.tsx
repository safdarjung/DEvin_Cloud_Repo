"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { Blob, Clock, Frame, Plant, Rug, SkyWindow } from "../decor";
import { InRoom, ROLE } from "../Rooms";
import { Bag, Certificate, Chair, Computer, Drawers, Mug, OfficeChair, Papers, PinBoard } from "../props";
import { Ball, C, Cyl, Label, RBox, shade, mat } from "../../kit";
import { Person, stopFor } from "../../characters/Person";
import { LOOKS } from "../../characters/parts";

/* Room-local: far wall x=+4.5 (faces -x), side wall z=-3.6 is on the left of the dwell shot. */
const FAR = -Math.PI / 2;

/** Live dashboard: bars re-rank every couple of seconds, the donut turns, a LIVE dot blinks. */
function Dashboard({ accent }: { accent: string }) {
  const bars = useRef<(THREE.Group | null)[]>([]);
  const donut = useRef<THREE.Group>(null);
  const live = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const beat = Math.floor(t / 2.2);
    bars.current.forEach((b, i) => {
      if (!b) return;
      const target = 0.35 + 0.65 * Math.abs(Math.sin(beat * 1.7 + i * 2.1));
      b.scale.y += (target - b.scale.y) * 0.08;
    });
    if (donut.current) donut.current.rotation.z = t * 0.5;
    if (live.current) live.current.visible = Math.sin(t * 5) > -0.2;
  });
  return (
    <group position={[4.4, 1.95, -1.35]} rotation-y={FAR}>
      <RBox size={[2.5, 1.55, 0.12]} radius={0.12} color={C.ink} />
      <RBox size={[2.3, 0.2, 0.02]} radius={0.05} color={accent} position={[0, 0.57, 0.07]} />
      <Label text="SCHOOL TODAY" w={1.1} h={0.15} bg={accent} fg={C.white} px={256} position={[-0.5, 0.57, 0.085]} />
      <mesh ref={live} position={[0.95, 0.57, 0.09]}>
        <circleGeometry args={[0.05, 12]} />
        <meshBasicMaterial color="#ff3b3b" toneMapped={false} />
      </mesh>
      {[C.green, C.blue, C.yellow, accent, C.purple].map((c, i) => (
        <group key={c} ref={(el) => void (bars.current[i] = el)} position={[-0.95 + i * 0.27, -0.6, 0.08]}>
          <RBox size={[0.17, 0.85, 0.04]} radius={0.04} color={c} position={[0, 0.42, 0]} />
        </group>
      ))}
      <group ref={donut} position={[0.68, -0.08, 0.08]}>
        <mesh material={mat(C.green)}>
          <torusGeometry args={[0.32, 0.09, 8, 28, Math.PI * 1.4]} />
        </mesh>
        <mesh material={mat("#4a4e69")} rotation-z={Math.PI * 1.4}>
          <torusGeometry args={[0.32, 0.09, 8, 20, Math.PI * 0.6]} />
        </mesh>
      </group>
      <Cyl r={0.08} h={0.5} color={C.ink} position={[0, -1.0, -0.05]} seg={10} />
    </group>
  );
}

function Trophy({ position, color = C.yellow, scale = 1 }: { position: [number, number, number]; color?: string; scale?: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (ref.current) ref.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.8 + position[2] * 3) * 0.4;
  });
  return (
    <group ref={ref} position={position} scale={scale}>
      <RBox size={[0.3, 0.1, 0.3]} radius={0.03} color={C.woodDark} position={[0, 0.05, 0]} />
      <Cyl r={0.05} h={0.16} color={color} position={[0, 0.18, 0]} seg={10} />
      <Cyl r={0.08} rTop={0.2} h={0.24} color={color} position={[0, 0.38, 0]} cast />
      {[-1, 1].map((s) => (
        <mesh key={s} material={mat(color)} position={[s * 0.2, 0.4, 0]} rotation-y={Math.PI / 2}>
          <torusGeometry args={[0.07, 0.02, 6, 12]} />
        </mesh>
      ))}
      <Ball r={0.04} color={C.white} position={[0.06, 0.45, 0.17]} detail={8} />
    </group>
  );
}

export function PrincipalOffice() {
  const role = ROLE.principal;
  return (
    <InRoom roleKey="principal">
      <Rug r={1.8} accent={role.accent} position={[1.5, 0.02, 0.4]} />
      <Dashboard accent={role.accent} />
      <Clock position={[4.42, 2.85, 0.25]} rotationY={FAR} rim={role.accent} />
      <Frame w={0.9} h={0.7} position={[4.43, 2.55, 1.2]} rotationY={FAR} inner="#fff7e0" wood={C.yellow}>
        <Ball r={0.13} color={role.accent} position={[0, 0.06, 0]} scale={[1, 1, 0.2]} />
        <RBox size={[0.5, 0.05, 0.02]} radius={0.01} color={C.ink} position={[0, -0.2, 0]} />
      </Frame>
      <SkyWindow position={[4.42, 1.95, 2.35]} rotationY={FAR} w={1.3} h={1.25} curtain={shade(role.accent, 1.2)} />
      <group position={[4.05, 0, 2.35]}>
        <RBox size={[0.7, 0.85, 1.5]} radius={0.06} color={C.wood} position={[0, 0.43, 0]} cast />
        <RBox size={[0.04, 0.6, 0.6]} radius={0.02} color={C.woodDark} position={[-0.36, 0.43, -0.36]} />
        <RBox size={[0.04, 0.6, 0.6]} radius={0.02} color={C.woodDark} position={[-0.36, 0.43, 0.36]} />
        <Trophy position={[0, 0.86, -0.45]} />
        <Trophy position={[0, 0.86, 0.05]} color="#d9dde3" scale={0.85} />
        <Trophy position={[0, 0.86, 0.5]} color="#e2a46b" scale={0.75} />
        <Blob w={1.2} d={1.9} position={[0, 0, 0]} />
      </group>
      <group position={[2.6, 0, -0.95]}>
        <RBox size={[1.1, 0.12, 2.2]} radius={0.05} color={C.wood} position={[0, 0.78, 0]} cast />
        <RBox size={[0.06, 0.55, 1.9]} radius={0.02} color={C.woodDark} position={[-0.5, 0.45, 0]} />
        {[-1, 1].map((s) => (
          <RBox key={s} size={[0.9, 0.72, 0.12]} radius={0.04} color={C.woodDark} position={[0, 0.36, s * 0.95]} cast />
        ))}
        <group position={[-0.56, 0.62, 0.35]} rotation-y={-Math.PI / 2}>
          <RBox size={[0.7, 0.2, 0.05]} radius={0.03} color={C.ink} />
          <Label text="PRINCIPAL" w={0.62} h={0.13} bg={C.ink} fg={C.yellow} px={256} position={[0, 0, 0.03]} />
        </group>
        <RBox size={[0.5, 0.05, 0.35]} radius={0.02} color={C.white} position={[-0.15, 0.87, -0.5]} rotation-y={0.2} />
        <Cyl r={0.07} h={0.18} color={C.blue} position={[0.1, 0.93, 0.35]} />
        {[C.red, C.green, C.yellow].map((c, i) => (
          <Cyl key={c} r={0.012} h={0.2} color={c} position={[0.08 + i * 0.03, 1.05, 0.33 + i * 0.02]} rotation-z={(i - 1) * 0.2} seg={6} />
        ))}
        <OfficeChair position={[0.85, 0, 0.1]} rotationY={-Math.PI / 2 + 0.25} colour="#3a3f4d" />
        <Drawers position={[-0.535, 0.4, -0.55]} rotationY={-Math.PI / 2} w={0.7} h={0.6} />
        <Computer position={[0.05, 0.84, -0.75]} rotationY={Math.PI / 2 - 0.35} accent={role.accent} />
        <Mug position={[-0.25, 0.84, 0.75]} colour={role.accent} rotationY={1} />
        <Papers position={[-0.1, 0.84, 0.15]} rotationY={0.3} />
        <Blob w={1.7} d={2.8} position={[0.2, 0, 0]} />
      </group>
      <Chair position={[1.55, 0, -1.75]} rotationY={Math.PI / 2 + 0.2} colour="#6b7280" />
      <Chair position={[1.5, 0, -0.75]} rotationY={Math.PI / 2 - 0.15} colour="#6b7280" />
      <Certificate position={[4.43, 2.0, 0.28]} rotationY={FAR} accent={role.accent} w={0.42} />
      <Certificate position={[4.43, 1.52, 0.28]} rotationY={FAR} accent={C.blue} w={0.42} />
      <Certificate position={[4.43, 1.6, 1.15]} rotationY={FAR} accent={C.green} w={0.5} />
      <PinBoard position={[1.6, 2.0, -3.57]} w={1.8} h={1.0} seed={3} />
      <Bag position={[3.55, 0, 0.55]} rotationY={-1.2} colour="#5b4636" />
      <Plant position={[2.4, 0, 2.95]} scale={1.15} pot={shade(role.accent, 0.9)} />
      <Person
        look={LOOKS.principal(role.accent)}
        action="point"
        stop={stopFor("principal")}
        seed={1}
        handL={
          <group position={[0, -0.02, 0.05]} rotation-x={0.25}>
            <RBox size={[0.24, 0.31, 0.02]} radius={0.01} color="#3d4a66" />
            <RBox size={[0.2, 0.26, 0.012]} radius={0.005} color={C.cream} position={[0, 0, 0.014]} />
          </group>
        }
      />
    </InRoom>
  );
}
