"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { MASCOT_SPOT, dwellAmount, type TourStop } from "../path";
import { Ball, C, Cyl, RBox, spring, stepSpring, toon, useProgress } from "./kit";

export type MascotAction = "point" | "stamp" | "write" | "read" | "phone";
type Accessory = "tie" | "glasses" | "cap" | "bow";
type V3 = [number, number, number];
interface Pose {
  r: V3; // right-arm pivot rotation (mascot's right = -x)
  l: V3;
  lean: number; // body tilt forward (x)
  turn: number; // body yaw
  sway: number; // body roll (z)
}

/** Faces the dwell camera, which stands just inside the door (room-local x≈-2.6). */
const FACE_CAMERA = -1.64;
const easeOut = (k: number) => 1 - (1 - k) ** 3;

/** One looped "job" per role. Arms hang along -y: rot.z<0 lifts the right arm out, rot.x<0 swings forward. */
const ACTIONS: Record<MascotAction, (t: number) => Pose> = {
  point: (t) => ({ r: [-0.35, 0, -1.45 + Math.sin(t * 2.4) * 0.14], l: [0, 0, 0.55], lean: Math.max(0, Math.sin(t * 2.4)) * 0.07, turn: -0.25, sway: 0 }),
  stamp: (t) => {
    const ph = (t * 1.1) % 1;
    const lift = ph < 0.62 ? easeOut(ph / 0.62) : Math.max(0, 1 - ((ph - 0.62) / 0.1) ** 2);
    return { r: [-1.2 - lift * 1.35, 0, -0.12], l: [-0.85, 0, 0.18], lean: 0.1 - lift * 0.08, turn: 0, sway: 0 };
  },
  write: (t) => ({ r: [-1.25 + Math.cos(t * 7) * 0.15, 0, -0.85 + Math.sin(t * 7) * 0.2], l: [-0.6, 0, 0.3], lean: 0, turn: -0.45, sway: Math.sin(t * 3.5) * 0.04 }),
  read: (t) => ({ r: [-1.05, 0, -0.18], l: [-1.05, 0, 0.18], lean: 0.12 + Math.sin(t * 1.4) * 0.05, turn: 0, sway: Math.sin(t * 0.9) * 0.05 }),
  phone: (t) => ({ r: [-0.3 + Math.sin(t * 3) * 0.2, 0, -0.45 + Math.sin(t * 3) * 0.25], l: [-0.5, 0, 2.35], lean: 0, turn: 0.15, sway: 0.08 + Math.sin(t * 1.3) * 0.03 }),
};
const wave = (t: number): Pose => ({ r: [0, 0, -2.55 + Math.sin(t * 14) * 0.38], l: [0, 0, 0.3], lean: 0, turn: 0, sway: Math.sin(t * 14) * 0.035 });

function shade(color: string, k: number): string {
  const c = new THREE.Color(color);
  return `#${(k < 1 ? c.multiplyScalar(k) : c.lerp(new THREE.Color("#ffffff"), k - 1)).getHexString()}`;
}

interface MascotProps {
  color: string;
  action: MascotAction;
  stop: TourStop;
  accessory?: Accessory;
  handR?: ReactNode;
  handL?: ReactNode;
  front?: ReactNode;
  seed?: number;
}

/**
 * Shared capsule mascot, standing at MASCOT_SPOT in its room: big eyes that blink and follow the camera, breathing squash-and-stretch,
 * a looped job, and a hop + wave when the camera arrives in its room.
 */
export function Mascot({ color, action, stop, accessory, handR, handL, front, seed = 0 }: MascotProps) {
  const progress = useProgress();
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const eyes = useRef<THREE.Group>(null);
  const pupils = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const live = useRef({ squash: spring(1), hopT: -1, arrived: false, waveUntil: 0, lastStamp: 0, look: new THREE.Vector3() });
  const tones = useMemo(() => ({ dark: shade(color, 0.72), belly: shade(color, 1.6) }), [color]);
  const capsule = useMemo(() => new THREE.CapsuleGeometry(0.42, 0.5, 8, 18), []);
  const arm = useMemo(() => new THREE.CapsuleGeometry(0.085, 0.3, 4, 10), []);

  useFrame((state, dt) => {
    const s = live.current;
    const t = state.clock.elapsedTime + seed * 1.7;
    const here = dwellAmount(progress.current, stop);
    if (here > 0.9 && !s.arrived) {
      s.arrived = true;
      s.hopT = 0;
      s.squash.v -= 2.5; // crouch before the jump
      s.waveUntil = t + 2;
    } else if (here < 0.2) s.arrived = false;

    let hopY = 0;
    if (s.hopT >= 0) {
      s.hopT += Math.min(dt, 1 / 30);
      const k = (s.hopT - 0.08) / 0.42;
      if (k > 0 && k < 1) hopY = Math.sin(Math.PI * k) * 0.34;
      else if (k >= 1) {
        s.hopT = -1;
        s.squash.v -= 4; // land: squash, then springs back with a wobble
      }
    }
    if (action === "stamp") {
      const n = Math.floor(t * 1.1 + 0.28);
      if (n !== s.lastStamp) {
        s.lastStamp = n;
        s.squash.v -= 1.4;
      }
    }
    const sq = stepSpring(s.squash, 1, dt, 260, 9) + Math.sin(t * 3.2) * 0.022;
    const pose = t < s.waveUntil ? wave(t) : ACTIONS[action](t);

    if (root.current) root.current.position.y = MASCOT_SPOT[1] + hopY;
    if (body.current) {
      body.current.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
      body.current.rotation.set(pose.lean, pose.turn, pose.sway);
    }
    armR.current?.rotation.set(...pose.r);
    armL.current?.rotation.set(...pose.l);
    if (eyes.current) {
      const blink = (t % (2.8 + (seed % 3) * 0.9)) < 0.13 ? 0.08 : 1;
      eyes.current.scale.y = blink;
    }
    if (pupils.current && eyes.current) {
      eyes.current.worldToLocal(s.look.copy(state.camera.position)).normalize();
      pupils.current.position.set(s.look.x * 0.05, s.look.y * 0.04 + (action === "read" && t >= s.waveUntil ? -0.04 : 0), 0);
    }
  });

  return (
    <group ref={root} position={[MASCOT_SPOT[0], MASCOT_SPOT[1], MASCOT_SPOT[2]]} rotation-y={FACE_CAMERA}>
      <Ball r={0.13} color={tones.dark} position={[-0.17, 0.06, 0.08]} scale={[1, 0.55, 1.35]} cast />
      <Ball r={0.13} color={tones.dark} position={[0.17, 0.06, 0.08]} scale={[1, 0.55, 1.35]} cast />
      <group ref={body} position={[0, 0.1, 0]}>
        <mesh geometry={capsule} material={toon(color)} position={[0, 0.67, 0]} castShadow />
        <Ball r={0.3} color={tones.belly} position={[0, 0.56, 0.24]} scale={[1, 1.1, 0.5]} />
        <Cyl r={0.07} rTop={0} h={0.22} color={tones.dark} position={[-0.06, 1.42, 0]} rotation-z={0.35} seg={8} />
        <Cyl r={0.06} rTop={0} h={0.18} color={tones.dark} position={[0.07, 1.41, 0.02]} rotation-z={-0.4} seg={8} />
        <group ref={eyes} position={[0, 0.94, 0.3]}>
          <Ball r={0.15} color={C.white} position={[-0.14, 0, 0]} scale={[1, 1.12, 0.7]} />
          <Ball r={0.15} color={C.white} position={[0.14, 0, 0]} scale={[1, 1.12, 0.7]} />
          <group ref={pupils}>
            {[-0.14, 0.14].map((x) => (
              <group key={x} position={[x, 0, 0.09]}>
                <Ball r={0.075} color={C.ink} detail={14} />
                <Ball r={0.025} color={C.white} position={[0.03, 0.035, 0.06]} detail={8} />
              </group>
            ))}
          </group>
        </group>
        <mesh material={toon(C.ink)} position={[0, 0.76, 0.395]} rotation-z={Math.PI}>
          <torusGeometry args={[0.07, 0.022, 6, 14, Math.PI]} />
        </mesh>
        <Ball r={0.06} color="#ff9ebb" position={[-0.27, 0.8, 0.31]} scale={[1, 0.6, 0.4]} detail={10} />
        <Ball r={0.06} color="#ff9ebb" position={[0.27, 0.8, 0.31]} scale={[1, 0.6, 0.4]} detail={10} />
        <group ref={armR} position={[-0.4, 0.72, 0.04]}>
          <mesh geometry={arm} material={toon(color)} position={[0, -0.22, 0]} castShadow />
          <group position={[0, -0.44, 0]}>{handR}</group>
        </group>
        <group ref={armL} position={[0.4, 0.72, 0.04]}>
          <mesh geometry={arm} material={toon(color)} position={[0, -0.22, 0]} castShadow />
          <group position={[0, -0.44, 0]}>{handL}</group>
        </group>
        {front}
        {accessory && <Gear kind={accessory} />}
      </group>
    </group>
  );
}

function Gear({ kind }: { kind: Accessory }) {
  if (kind === "tie")
    return (
      <group position={[0, 0.5, 0.4]} rotation-x={-0.25}>
        <Ball r={0.05} color={C.red} position={[0, 0.12, 0]} scale={[1.2, 0.8, 0.6]} detail={10} />
        <RBox size={[0.12, 0.26, 0.04]} radius={0.02} color={C.red} rotation-z={Math.PI / 4} scale={[0.7, 1, 1]} />
      </group>
    );
  if (kind === "glasses")
    return (
      <group position={[0, 0.94, 0.42]}>
        {[-0.14, 0.14].map((x) => (
          <mesh key={x} material={toon(C.ink)} position={[x, 0, 0]}>
            <torusGeometry args={[0.165, 0.022, 6, 22]} />
          </mesh>
        ))}
        <RBox size={[0.1, 0.03, 0.03]} radius={0.01} color={C.ink} />
      </group>
    );
  if (kind === "cap")
    return (
      <group position={[0, 1.37, 0]} rotation-z={0.08}>
        <Cyl r={0.26} h={0.14} color={C.ink} />
        <RBox size={[0.66, 0.05, 0.66]} radius={0.02} color={C.ink} position={[0, 0.09, 0]} rotation-y={Math.PI / 4} />
        <Cyl r={0.012} h={0.26} color={C.yellow} position={[0.3, -0.03, 0.1]} seg={6} />
        <Ball r={0.04} color={C.yellow} position={[0.3, -0.17, 0.1]} detail={8} />
      </group>
    );
  return (
    <group position={[0.2, 1.33, 0.05]} rotation-z={-0.3}>
      <Cyl r={0.1} rTop={0} h={0.16} color={C.yellow} rotation-z={Math.PI / 2} position={[-0.08, 0, 0]} seg={10} />
      <Cyl r={0.1} rTop={0} h={0.16} color={C.yellow} rotation-z={-Math.PI / 2} position={[0.08, 0, 0]} seg={10} />
      <Ball r={0.045} color={C.orange} detail={10} />
    </group>
  );
}
