"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { CORRIDOR_END_Z, FINALE_Z, STOPS } from "../../path";
import { TOUR_ROLES } from "../../roles";
import { Blob, Bunting } from "../interior/decor";
import { Tree } from "./Trees";
import { Ball, C, Cyl, RBox, shade } from "../kit";
import { Person } from "../characters/Person";
import { LOOKS } from "../characters/parts";

const FINALE = STOPS.find((s) => s.key === "finale")!;
const CAMERA_Z = FINALE.pose.position[2];
const XS = [-2.3, -1.15, 0, 1.15, 2.3];

/** One balloon on a string, bobbing and swaying on its own rhythm. */
function Balloon({ position, colour, seed }: { position: [number, number, number]; colour: string; seed: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime + seed;
    if (!ref.current) return;
    ref.current.position.y = position[1] + Math.sin(t * 1.3) * 0.12;
    ref.current.rotation.z = Math.sin(t * 0.9) * 0.08;
  });
  return (
    <group ref={ref} position={position}>
      <Ball r={0.34} color={colour} scale={[1, 1.18, 1]} cast />
      <Ball r={0.07} color={shade(colour, 0.8)} position={[0, -0.42, 0]} detail={8} />
      <Cyl r={0.008} h={1.6} color={C.white} position={[0, -1.25, 0]} seg={4} />
      <Ball r={0.07} color={C.white} position={[0.1, 0.18, 0.28]} scale={[0.7, 1, 0.4]} detail={8} />
    </group>
  );
}

/** Closing shot in the back garden: all five people on a little stage, waving, at golden hour. */
export function Finale() {
  return (
    <group>
      <RBox size={[2.6, 0.06, Math.abs(FINALE_Z - CORRIDOR_END_Z) - 2]} radius={0.03} color={C.path} position={[0, 0.03, (FINALE_Z + CORRIDOR_END_Z) / 2 + 1.5]} />
      <group position={[0, 0, FINALE_Z - 0.2]}>
        <RBox size={[6.6, 0.32, 2.3]} radius={0.14} color={C.white} position={[0, 0.16, 0]} cast />
        {TOUR_ROLES.map((r, i) => (
          <RBox key={r.key} size={[1.28, 0.2, 0.06]} radius={0.06} color={r.accent} position={[XS[i], 0.16, 1.16]} />
        ))}
        <Blob w={9} d={3.4} position={[0, 0, 0]} />
      </group>
      {TOUR_ROLES.map((r, i) => {
        const z = FINALE_Z + (Math.abs(XS[i]) > 2 ? 0.3 : Math.abs(XS[i]) > 1 ? 0 : -0.15);
        return (
          <Person key={r.key} look={LOOKS[r.key](r.accent)} action="wave" stop={FINALE} seed={i * 1.3} delay={i * 0.14} position={[XS[i], 0.32, z]} rotationY={Math.atan2(-XS[i], CAMERA_Z - z)} />
        );
      })}
      {[-1, 1].map((s) => (
        <group key={s}>
          <Cyl r={0.09} h={4.2} color={C.white} position={[s * 4.7, 2.1, FINALE_Z - 1]} cast />
          <Ball r={0.16} color={C.yellow} position={[s * 4.7, 4.25, FINALE_Z - 1]} />
        </group>
      ))}
      <Bunting a={[-4.7, 3.95, FINALE_Z - 1]} b={[4.7, 3.95, FINALE_Z - 1]} n={18} sag={0.7} colours={TOUR_ROLES.map((r) => r.accent)} />
      {TOUR_ROLES.map((r, i) => (
        <Balloon key={r.key} position={[-3.6 + i * 1.8 + (i % 2) * 0.3, 2.6 + (i % 2) * 0.5, FINALE_Z - 1.6 - (i % 2) * 0.4]} colour={r.accent} seed={i * 1.7} />
      ))}
      <Tree position={[-7, 0, FINALE_Z + 1]} scale={1.3} tint={C.green} seed={11} />
      <Tree position={[7.5, 0, FINALE_Z + 0.5]} scale={1.4} tint={C.grassDark} seed={12} />
      <Tree position={[-10, 0, FINALE_Z - 4]} scale={1.6} tint="#89e219" seed={13} />
      <Tree position={[10.5, 0, FINALE_Z - 3]} scale={1.5} tint={C.green} seed={14} />
    </group>
  );
}
