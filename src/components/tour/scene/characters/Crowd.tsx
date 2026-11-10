"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { Ball, C, Cyl, RBox, metal } from "../kit";
import { Person } from "./Person";
import { LOOKS, kidLook } from "./parts";

/* Background life, all on the shared rig: pupils walking the corridor, a child on the swing, one chasing a ball. */

const LANE = 1.28;
const Z0 = -3.6;
const STRAIGHT = 38;
const ARC = Math.PI * LANE;
const LAP = 2 * (STRAIGHT + ARC);
/** Closer than this to the camera a walker is hidden, so the lens never passes through a body. */
const TOO_CLOSE = 2.4;

/** Down the left of the corridor, round at the garden door, back up the right, round at the entrance. */
function onCircuit(d: number, figure: THREE.Group) {
  if (d < STRAIGHT) {
    figure.position.set(-LANE, 0, Z0 - d);
    figure.rotation.y = Math.PI;
  } else if (d < STRAIGHT + ARC) {
    const a = (d - STRAIGHT) / LANE;
    figure.position.set(-LANE * Math.cos(a), 0, Z0 - STRAIGHT - LANE * Math.sin(a));
    figure.rotation.y = Math.PI - a;
  } else if (d < 2 * STRAIGHT + ARC) {
    figure.position.set(LANE, 0, Z0 - STRAIGHT + (d - STRAIGHT - ARC));
    figure.rotation.y = 0;
  } else {
    const a = (d - 2 * STRAIGHT - ARC) / LANE;
    figure.position.set(LANE * Math.cos(a), 0, Z0 + LANE * Math.sin(a));
    figure.rotation.y = -a;
  }
}

const WALKERS = [
  { offset: 9, speed: 1.05, kid: 1 },
  { offset: 24, speed: 0.95, kid: 2 },
  { offset: 52, speed: 1.1, kid: 4 },
  { offset: 66, speed: 1.0, kid: 0 },
] as const;

export function CorridorWalkers() {
  const looks = useMemo(() => WALKERS.map((w) => (w.kid ? kidLook(w.kid) : { ...LOOKS.admin("#4f7fd0"), extras: ["collar"] as const })), []);
  return (
    <>
      {WALKERS.map((w, i) => (
        <Person
          key={w.offset}
          look={looks[i]}
          action="walk"
          seed={i}
          position={[-LANE, 0, Z0]}
          rotationY={Math.PI}
          drive={(t, figure, camera) => {
            onCircuit((t * w.speed + w.offset) % LAP, figure);
            figure.visible = Math.hypot(figure.position.x - camera.position.x, figure.position.z - camera.position.z) > TOO_CLOSE;
            // Cadence follows ground speed and leg length, so feet do not skate.
            return (t * w.speed + w.offset) / (0.82 * looks[i].scale);
          }}
        />
      ))}
    </>
  );
}

/* ---------- playground swing: frame, seat on two ropes, a child pumping their legs ---------- */

const ROPE = 1.55;
const TOP = 2.15;
const swingAngle = (t: number) => Math.sin(t * 1.9) * 0.55;

export function Swing({ position, rotationY = 0 }: { position: [number, number, number]; rotationY?: number }) {
  const seat = useRef<THREE.Group>(null);
  const look = useMemo(() => kidLook(5), []);
  useFrame((state) => {
    if (seat.current) seat.current.rotation.x = -swingAngle(state.clock.elapsedTime);
  });
  const steel = metal("#c2473d", 0.45);
  return (
    <group position={position} rotation-y={rotationY}>
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => <Cyl key={`${sx}${sz}`} r={0.04} h={2.35} m={steel} position={[sx * 0.95, TOP / 2, sz * 0.5]} rotation-x={-sz * 0.44} seg={8} cast />))}
      <Cyl r={0.045} h={2.0} m={steel} position={[0, TOP, 0]} rotation-z={Math.PI / 2} seg={8} cast />
      <group ref={seat} position={[0, TOP, 0]}>
        {[-0.2, 0.2].map((x) => (
          <Cyl key={x} r={0.008} h={ROPE} color="#d8d2c4" position={[x, -ROPE / 2, 0]} seg={4} />
        ))}
        <RBox size={[0.5, 0.035, 0.2]} radius={0.015} color={C.woodDark} position={[0, -ROPE, 0]} cast />
      </group>
      <Person
        look={look}
        action="swing"
        position={[0, TOP - ROPE, 0]}
        rotationY={0}
        drive={(t, figure) => {
          const a = swingAngle(t);
          figure.position.set(0, TOP - Math.cos(a) * ROPE + 0.06, Math.sin(a) * ROPE);
          figure.rotation.x = -a;
          return t * 1.9;
        }}
      />
    </group>
  );
}

/* ---------- a child running after a ball, round and round ---------- */

export function Runner({ centre, radius = 2 }: { centre: [number, number, number]; radius?: number }) {
  const ball = useRef<THREE.Group>(null);
  const look = useMemo(() => kidLook(3), []);
  const speed = 1.7;
  useFrame((state) => {
    const a = (state.clock.elapsedTime * speed) / radius + 0.75;
    if (!ball.current) return;
    ball.current.position.set(centre[0] + Math.cos(a) * radius, 0.14 + Math.abs(Math.sin(state.clock.elapsedTime * 5)) * 0.1, centre[2] + Math.sin(a) * radius);
    ball.current.rotation.z -= 0.12;
  });
  return (
    <>
      <group ref={ball}>
        <Ball r={0.14} color="#f3f1ea" detail={12} cast />
        <Ball r={0.06} color={C.red} position={[0.1, 0.05, 0.05]} detail={8} />
      </group>
      <Person
        look={look}
        action="walk"
        position={centre}
        drive={(t, figure) => {
          const a = (t * speed) / radius;
          figure.position.set(centre[0] + Math.cos(a) * radius, 0, centre[2] + Math.sin(a) * radius);
          figure.rotation.y = -a;
          return (t * speed) / (0.62 * look.scale);
        }}
      />
    </>
  );
}
