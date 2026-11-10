"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { Blob, Clock, Frame, Plant, SkyWindow } from "../decor";
import { InRoom, ROLE } from "../Interior";
import { Ball, C, Cyl, Label, RBox, canvasTexture, shade, spring, stepSpring, toon } from "../kit";
import { Mascot, stopFor } from "../Mascot";

const FAR = -Math.PI / 2;

/** Puffs of steam rising off the mug, each one growing then shrinking away. */
function Steam({ position }: { position: [number, number, number] }) {
  const puffs = useRef<(THREE.Mesh | null)[]>([]);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    puffs.current.forEach((m, i) => {
      if (!m) return;
      const k = (t * 0.5 + i / 3) % 1;
      m.position.set(Math.sin(k * 6 + i) * 0.04, k * 0.45, 0);
      m.scale.setScalar(Math.sin(k * Math.PI) * 0.07 + 0.001);
    });
  });
  return (
    <group position={position}>
      {[0, 1, 2].map((i) => (
        <mesh
          key={i}
          ref={(el) => {
            puffs.current[i] = el;
          }}
          material={toon(C.white)}
        >
          <sphereGeometry args={[1, 10, 8]} />
        </mesh>
      ))}
    </group>
  );
}

/** Pops out of the phone: the parent just got the report card. */
function Notification({ accent }: { accent: string }) {
  const ref = useRef<THREE.Group>(null);
  const pop = useRef(spring(0));
  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const k = (t % 4.5) / 4.5;
    const s = stepSpring(pop.current, k > 0.12 && k < 0.85 ? 1 : 0, dt, 220, 10);
    if (ref.current) {
      ref.current.scale.setScalar(Math.max(0.001, s) * 0.62);
      ref.current.position.y = 1.76 + Math.sin(t * 2) * 0.03;
    }
  });
  return (
    <group ref={ref} position={[0.13, 1.76, 1.35]} rotation-y={-1.9}>
      <RBox size={[1.2, 0.4, 0.08]} radius={0.14} color={C.white} cast />
      <Label text="Report card ready" w={0.98} h={0.22} bg={C.white} fg={C.ink} position={[0.08, 0, 0.05]} />
      <Ball r={0.07} color={accent} position={[-0.48, 0, 0.06]} detail={10} />
      <mesh material={toon(C.white)} position={[-0.32, -0.24, 0]} rotation-z={Math.PI}>
        <coneGeometry args={[0.09, 0.14, 3]} />
      </mesh>
    </group>
  );
}

const calendar = (accent: string) =>
  canvasTexture(`calendar:${accent}`, 256, 256, (g) => {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = accent;
    g.fillRect(0, 0, 256, 60);
    g.fillStyle = "#ffffff";
    g.font = "800 34px ui-rounded, system-ui, sans-serif";
    g.textAlign = "center";
    g.fillText("NOVEMBER", 128, 43);
    g.fillStyle = "#2b2d42";
    g.font = "600 20px system-ui, sans-serif";
    for (let d = 1; d <= 30; d++) {
      const i = d + 5;
      g.fillText(String(d), 22 + (i % 7) * 35, 92 + Math.floor(i / 7) * 34);
    }
    g.strokeStyle = "#ff4b4b";
    g.lineWidth = 4;
    g.beginPath();
    g.arc(22 + ((14 + 5) % 7) * 35, 85 + Math.floor((14 + 5) / 7) * 34, 16, 0, Math.PI * 2);
    g.stroke();
  });

export function ParentLounge() {
  const role = ROLE.parent;
  return (
    <InRoom roleKey="parent">
      <Cyl r={1.8} h={0.03} color={shade(role.accent, 1.75)} position={[1.6, 0.02, 0.4]} seg={40} />
      <SkyWindow position={[4.42, 1.9, -1.9]} rotationY={FAR} w={1.3} h={1.3} curtain={shade(role.accent, 1.25)} />
      <Clock position={[4.42, 2.95, 2.75]} rotationY={FAR} rim={role.accent} r={0.26} />
      <group position={[4.42, 2.05, 2.75]} rotation-y={FAR}>
        <RBox size={[0.62, 0.62, 0.03]} radius={0.03} color={C.white} />
        <mesh position={[0, 0, 0.02]}>
          <planeGeometry args={[0.56, 0.56]} />
          <meshBasicMaterial map={calendar(role.accent)} toneMapped={false} />
        </mesh>
      </group>
      <Frame w={0.75} h={0.6} position={[4.43, 2.45, -0.15]} rotationY={FAR} tilt={0.04} inner={C.window}>
        {[C.orange, C.blue, C.green].map((c, i) => (
          <Ball key={c} r={0.08 + (i === 1 ? 0.03 : 0)} color={c} position={[-0.17 + i * 0.17, -0.1 + (i === 1 ? 0.04 : 0), 0]} scale={[1, 1.3, 0.3]} />
        ))}
      </Frame>
      <Frame w={0.55} h={0.7} position={[4.43, 2.5, 0.65]} rotationY={FAR} tilt={-0.05} inner="#fff1c9" wood={C.yellow}>
        <Ball r={0.12} color={C.yellow} position={[0, 0.1, 0]} scale={[1, 1, 0.3]} />
        <RBox size={[0.36, 0.05, 0.02]} radius={0.01} color={C.green} position={[0, -0.18, 0]} />
      </Frame>
      <Frame w={0.8} h={0.55} position={[4.43, 2.42, 1.5]} rotationY={FAR} tilt={0.03} inner={C.white} wood={role.accent}>
        <Label text={"STAR\nSTUDENT"} w={0.6} h={0.36} bg={C.white} fg={role.accent} px={256} />
      </Frame>
      <group position={[3.6, 0, 0.6]}>
        <RBox size={[1.1, 0.45, 2.8]} radius={0.18} color={role.accent} position={[0, 0.3, 0]} cast />
        <RBox size={[0.4, 1, 2.8]} radius={0.18} color={role.accent} position={[0.45, 0.75, 0]} cast />
        {[-1, 1].map((s) => (
          <RBox key={s} size={[1.1, 0.7, 0.32]} radius={0.15} color={shade(role.accent, 0.85)} position={[0, 0.45, s * 1.42]} cast />
        ))}
        <RBox size={[0.25, 0.5, 0.55]} radius={0.12} color={C.yellow} position={[0.15, 0.8, -0.7]} rotation-x={0.15} />
        <RBox size={[0.25, 0.5, 0.55]} radius={0.12} color={C.blue} position={[0.15, 0.8, 0.7]} rotation-x={-0.15} />
        <Blob w={1.6} d={3.4} position={[0, 0, 0]} />
      </group>
      <group position={[2.1, 0, -1.4]}>
        <RBox size={[1.2, 0.1, 0.8]} radius={0.05} color={C.wood} position={[0, 0.45, 0]} cast />
        <Cyl r={0.08} h={0.42} color={C.woodDark} position={[0, 0.21, 0]} seg={10} />
        <group position={[-0.15, 0.51, 0]} rotation={[-Math.PI / 2, 0, 0.3 - Math.PI / 2]}>
          <Label text={"REPORT CARD\nA+"} w={0.5} h={0.36} bg="#fffdf5" fg={role.accent} px={256} />
        </group>
        <group position={[0.36, 0.5, 0.18]}>
          <Cyl r={0.08} h={0.16} color={C.white} position={[0, 0.08, 0]} />
          <mesh material={toon(C.white)} position={[0.09, 0.08, 0]} rotation-x={Math.PI / 2}>
            <torusGeometry args={[0.045, 0.015, 6, 12]} />
          </mesh>
          <Steam position={[0, 0.2, 0]} />
        </group>
        <Blob w={1.6} d={1.2} position={[0, 0, 0]} />
      </group>
      <group position={[3.95, 0, -3.05]}>
        <Cyl r={0.15} h={0.05} color={C.ink} position={[0, 0.025, 0]} />
        <Cyl r={0.03} h={1.6} color={C.ink} position={[0, 0.8, 0]} seg={8} />
        <Cyl r={0.3} rTop={0.18} h={0.35} color={C.yellow} position={[0, 1.7, 0]} cast />
        <Blob w={0.7} position={[0, 0, 0]} />
      </group>
      <Plant position={[2.5, 0, 2.95]} scale={1.15} pot={shade(role.accent, 0.85)} />
      <Notification accent={role.accent} />
      <Mascot
        color={role.accent}
        action="phone"
        accessory="bow"
        stop={stopFor("parent")}
        seed={5}
        handL={
          <group position={[0, -0.06, 0.04]} rotation-x={-0.4}>
            <RBox size={[0.16, 0.26, 0.04]} radius={0.03} color={C.ink} />
            <RBox size={[0.13, 0.21, 0.01]} radius={0.01} color="#9fe0ff" position={[0, 0, 0.022]} />
          </group>
        }
      />
    </InRoom>
  );
}
