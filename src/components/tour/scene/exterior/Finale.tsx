"use client";

import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { CORRIDOR_END_Z, FINALE_Z, STOPS } from "../../path";
import { TOUR_ROLES } from "../../roles";
import { Blob, Bunting } from "../interior/decor";
import { Tree } from "./Trees";
import { Ball, C, Cyl, RBox, mat, shade, useLite } from "../kit";
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

const CONFETTI = 110;
const FALL_FROM = 5.6;

/** Paper confetti in the five role colours, fluttering down over the stage for the closing shot. High tier only. */
function Confetti() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const pieces = useMemo(
    () =>
      Array.from({ length: CONFETTI }, (_, i) => {
        const h = (k: number) => {
          const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
          return x - Math.floor(x);
        };
        return { x: -5.2 + h(1) * 10.4, z: FINALE_Z - 2.2 + h(2) * 3.6, y: h(3) * FALL_FROM, fall: 0.35 + h(4) * 0.45, spin: 1.2 + h(5) * 3, phase: h(6) * Math.PI * 2 };
      }),
    [],
  );
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useLayoutEffect(() => {
    const colour = new THREE.Color();
    pieces.forEach((_, i) => ref.current?.setColorAt(i, colour.set(i % 6 === 5 ? C.yellow : TOUR_ROLES[i % TOUR_ROLES.length].accent)));
    if (ref.current?.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, [pieces]);
  useFrame((state) => {
    const mesh = ref.current;
    if (!mesh) return;
    const t = state.clock.elapsedTime;
    pieces.forEach((p, i) => {
      dummy.position.set(p.x + Math.sin(t * 0.8 + p.phase) * 0.35, FALL_FROM - ((p.y + t * p.fall) % FALL_FROM), p.z);
      dummy.rotation.set(t * p.spin + p.phase, t * p.spin * 0.6, p.phase);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, mat("#ffffff", { ink: false }), CONFETTI]} frustumCulled={false}>
      <boxGeometry args={[0.12, 0.075, 0.006]} />
    </instancedMesh>
  );
}

/** Closing shot in the back garden: all five people on a little stage, waving, at golden hour. */
export function Finale() {
  const lite = useLite();
  return (
    <group>
      {!lite && <Confetti />}
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
