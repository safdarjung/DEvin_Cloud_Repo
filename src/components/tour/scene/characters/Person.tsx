"use client";

import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useCallback, useRef, type ReactNode, type RefObject } from "react";
import * as THREE from "three";
import { MASCOT_SPOT, STOPS, dwellAmount, type StopKey, type TourStop, type Vec3 } from "../../path";
import { blobTexture, cursor, damp, decal, shade, spring, stepSpring, useProgress } from "../kit";
import { Head, Skirt, Wear } from "./outfit";
import { Part, capsule, sphere, type Look } from "./parts";
import { JOINTS, RATE, REST, poseAt, type Action, type Pose } from "./rig";

export const stopFor = (key: StopKey) => STOPS.find((s) => s.key === key)!;

/** Faces the dwell camera, which stands just inside the door (room-local x≈-3.1). */
const FACE_CAMERA = -1.65;
const HIP_Y = 0.88;
const WAVE_SECONDS = 2.6;
type GroupRef = RefObject<THREE.Group | null>;

interface PersonProps {
  look: Look;
  action: Action;
  /** Greets (waves) when the camera settles on this stop. */
  stop?: TourStop;
  seed?: number;
  /** Defaults: the room's MASCOT_SPOT, facing the dwell camera. */
  position?: Vec3;
  rotationY?: number;
  /** Seconds to wait after the camera arrives before greeting (staggers a group). */
  delay?: number;
  handR?: ReactNode;
  handL?: ReactNode;
  /** Carried in front of the chest (moves with the spine). */
  front?: ReactNode;
  /** Stands beside the person (turns with them, does not move with the body). */
  stage?: ReactNode;
  /** Background people: move the whole figure every frame; may return the time fed to the action. */
  drive?: (t: number, figure: THREE.Group, camera: THREE.Camera) => number | void;
}

/**
 * One rig for everyone in the school: pelvis, spine, head, two-bone arms with hands, two-bone legs.
 * Breathes, shifts weight, blinks, follows the pointer with head and eyes, does its job on a loop, waves
 * (shoulder → elbow → wrist) when the camera arrives, and hops when clicked. Hair, lanyard and drapes lag behind.
 */
export function Person({ look, action, stop, seed = 0, position = MASCOT_SPOT, rotationY = FACE_CAMERA, delay = 0, handR, handL, front, stage, drive }: PersonProps) {
  const progress = useProgress();
  const figure = useRef<THREE.Group>(null);
  const hips = useRef<THREE.Group>(null);
  const spine = useRef<THREE.Group>(null);
  const chest = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const eyes = useRef<THREE.Group>(null);
  const pupils = useRef<THREE.Group>(null);
  const blob = useRef<THREE.Mesh>(null);
  const rS = useRef<THREE.Group>(null);
  const rE = useRef<THREE.Group>(null);
  const rW = useRef<THREE.Group>(null);
  const lS = useRef<THREE.Group>(null);
  const lE = useRef<THREE.Group>(null);
  const lW = useRef<THREE.Group>(null);
  const rH = useRef<THREE.Group>(null);
  const rK = useRef<THREE.Group>(null);
  const lH = useRef<THREE.Group>(null);
  const lK = useRef<THREE.Group>(null);
  const tails = useRef<THREE.Group[]>([]);
  const tail = useCallback((el: THREE.Group | null) => {
    if (el && !tails.current.includes(el)) tails.current.push(el);
  }, []);
  const live = useRef({
    j: { ...REST } as Pose,
    target: { ...REST } as Pose,
    wave: spring(0),
    lag: spring(0),
    bounce: spring(0),
    arrived: false,
    waveFrom: -99,
    hopAt: -99,
    clicked: false,
    yaw: 0,
    pitch: 0,
    look: new THREE.Vector3(),
    ray: new THREE.Vector3(),
  });

  useFrame((state, dt) => {
    const s = live.current;
    const t = state.clock.elapsedTime;
    const driven = figure.current && drive ? drive(t, figure.current, state.camera) : undefined;
    const ts = typeof driven === "number" ? driven : t + seed * 1.7;

    if (s.clicked) {
      s.clicked = false;
      s.hopAt = t;
      s.waveFrom = t + 0.35;
    }
    if (stop) {
      const here = dwellAmount(progress.current, stop);
      if (here > 0.9 && !s.arrived) {
        s.arrived = true;
        s.waveFrom = t + delay;
        s.bounce.v += 0.5; // a little lift onto the toes: "oh, hello!"
      } else if (here < 0.2) s.arrived = false;
    }
    const waving = t >= s.waveFrom && t < s.waveFrom + WAVE_SECONDS ? 1 : 0;
    const waveMix = stepSpring(s.wave, waving, dt, 70, 11);
    poseAt(action, ts, waveMix, s.target);

    const j = s.j;
    for (const k of JOINTS) j[k] = drive ? s.target[k] : damp(j[k], s.target[k], RATE[k], dt);

    // Click: crouch, hop, land.
    const hopK = (t - s.hopAt) / 0.5;
    const hop = hopK > 0 && hopK < 1 ? Math.sin(Math.PI * hopK) * 0.22 - Math.sin(Math.PI * Math.min(1, hopK * 4)) * 0.03 : 0;
    const bounce = stepSpring(s.bounce, 0, dt, 180, 9);
    const breath = Math.sin(ts * 1.9);

    if (hips.current) {
      hips.current.position.set(j.hipX, HIP_Y + j.hipY + hop + bounce * 0.05, 0);
      hips.current.rotation.z = j.hipRoll;
    }
    if (blob.current) blob.current.scale.setScalar(1 - hop * 1.4);
    spine.current?.rotation.set(j.lean, j.turn, j.sway - j.hipRoll);
    chest.current?.scale.set(1 + breath * 0.012, 1 + breath * 0.016, 1 + breath * 0.03);
    rS.current?.rotation.set(j.rSx, 0, j.rSz - breath * 0.008);
    rE.current?.rotation.set(j.rEx, 0, j.rEz);
    rW.current?.rotation.set(j.rWx, 0, j.rWz);
    lS.current?.rotation.set(j.lSx, 0, j.lSz + breath * 0.008);
    lE.current?.rotation.set(j.lEx, 0, j.lEz);
    lW.current?.rotation.set(j.lWx, 0, j.lWz);
    if (rH.current) rH.current.rotation.x = j.rHip;
    if (rK.current) rK.current.rotation.x = j.rKnee;
    if (lH.current) lH.current.rotation.x = j.lHip;
    if (lK.current) lK.current.rotation.x = j.lKnee;

    // Head and eyes follow the pointer (a point on the pointer ray, about as far away as the camera).
    if (head.current && spine.current) {
      head.current.getWorldPosition(s.look);
      const dist = s.look.distanceTo(state.camera.position);
      s.ray.set(state.pointer.x, state.pointer.y, 0.5).unproject(state.camera).sub(state.camera.position).normalize();
      s.look.copy(state.camera.position).addScaledVector(s.ray, dist * 0.85);
      spine.current.worldToLocal(s.look);
      s.look.y -= 0.68;
      const yaw = THREE.MathUtils.clamp(Math.atan2(s.look.x, s.look.z), -0.75, 0.75);
      const pitch = THREE.MathUtils.clamp(-Math.atan2(s.look.y, Math.hypot(s.look.x, s.look.z)), -0.3, 0.35);
      s.yaw = damp(s.yaw, s.look.z > -0.2 ? yaw : 0, 5, dt);
      s.pitch = damp(s.pitch, pitch, 5, dt);
      head.current.rotation.set(j.headPitch + s.pitch * j.gaze, j.headYaw + s.yaw * j.gaze * 0.8, j.headRoll);
      // Eyes lead: they cover the rest of the angle the head has not turned yet.
      pupils.current?.position.set(THREE.MathUtils.clamp((yaw - s.yaw * 0.8) * 0.03 * j.gaze, -0.011, 0.011), THREE.MathUtils.clamp((s.pitch * 0.8 - pitch) * 0.03, -0.008, 0.008), 0);
    }
    if (eyes.current) {
      const blink = (ts + seed) % (3.1 + (seed % 3) * 0.8);
      eyes.current.scale.y = blink < 0.12 || (blink > 0.3 && blink < 0.38 && seed % 2 > 0.5) ? 0.1 : 1;
    }

    // Secondary motion: loose things lag behind the body and swing back.
    const lag = stepSpring(s.lag, -(j.sway * 2 + j.turn * 0.8 + j.hipX * 5 + hop * 2), dt, 38, 3.2);
    for (const el of tails.current) el.rotation.set(-j.lean * 0.9 - hop * 1.5 + Math.abs(lag) * 0.1, 0, lag * 0.5);
  });

  const hello = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    live.current.clicked = true; // picked up on the next frame, on the canvas clock
  };

  const { skin, top, sleeves, thigh, shin, shoe, skirt } = look;
  const forearm = sleeves === "long" ? top : skin;
  const interactive = !drive;

  return (
    <group ref={figure} position={[position[0], position[1], position[2]]} rotation-y={rotationY}>
      <mesh ref={blob} material={decal("blob", blobTexture())} position={[0, 0.05, 0.02]} rotation-x={-Math.PI / 2} renderOrder={1}>
        <planeGeometry args={[1.1 * look.scale, 0.9 * look.scale]} />
      </mesh>
      {stage}
      <group scale={look.scale} onClick={interactive ? hello : undefined} onPointerOver={interactive ? cursor(true) : undefined} onPointerOut={interactive ? cursor(false) : undefined}>
        <group ref={hips} position={[0, HIP_Y, 0]}>
          <Part g={capsule(0.105, 0.09)} c={skirt?.color ?? thigh} position={[0, 0.02, 0]} rotation-z={Math.PI / 2} scale={[1, 1, 0.9]} />
          {skirt && <Skirt skirt={skirt} />}
          <Leg hip={rH} knee={rK} x={-0.085} thigh={thigh} shin={shin} shoe={shoe} />
          <Leg hip={lH} knee={lK} x={0.085} thigh={thigh} shin={shin} shoe={shoe} />
          <group ref={spine} position={[0, 0.04, 0]}>
            <group ref={chest}>
              <Part g={capsule(0.15, 0.2)} c={top} position={[0, 0.26, 0]} scale={[1.16, 1, 0.8]} />
            </group>
            <Wear look={look} tail={tail} />
            <Part g={capsule(0.045, 0.05)} c={skin} rough={0.6} position={[0, 0.535, 0]} />
            <Arm shoulder={rS} elbow={rE} wrist={rW} side={-1} sleeve={top} forearm={forearm} skin={skin}>
              {handR}
            </Arm>
            <Arm shoulder={lS} elbow={lE} wrist={lW} side={1} sleeve={top} forearm={forearm} skin={skin}>
              {handL}
            </Arm>
            {front}
            <group ref={head} position={[0, 0.54, 0]}>
              <group position={[0, 0.15, 0.01]}>
                <Head look={look} eyes={eyes} pupils={pupils} tail={tail} />
              </group>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}

function Leg({ hip, knee, x, thigh, shin, shoe }: { hip: GroupRef; knee: GroupRef; x: number; thigh: string; shin: string; shoe: string }) {
  return (
    <group ref={hip} position={[x, -0.02, 0]}>
      <Part g={capsule(0.068, 0.4)} c={thigh} position={[0, -0.2, 0]} />
      <group ref={knee} position={[0, -0.4, 0]}>
        <Part g={capsule(0.052, 0.38)} c={shin} position={[0, -0.19, 0]} />
        <Part g={capsule(0.05, 0.11)} c={shoe} rough={0.45} position={[0, -0.425, 0.045]} rotation-x={Math.PI / 2} scale={[1, 1, 0.82]} />
      </group>
    </group>
  );
}

/** Shoulder → elbow → wrist, with a mitten hand and thumb. Children ride in the palm. */
function Arm({ shoulder, elbow, wrist, side, sleeve, forearm, skin, children }: { shoulder: GroupRef; elbow: GroupRef; wrist: GroupRef; side: 1 | -1; sleeve: string; forearm: string; skin: string; children?: ReactNode }) {
  return (
    <group ref={shoulder} position={[side * 0.2, 0.435, 0]}>
      <Part g={sphere(0.062, 12)} c={sleeve} />
      <Part g={capsule(0.046, 0.26)} c={sleeve} position={[0, -0.13, 0]} />
      <group ref={elbow} position={[0, -0.27, 0]}>
        <Part g={capsule(0.039, 0.23)} c={forearm} rough={forearm === skin ? 0.6 : 0.8} position={[0, -0.115, 0]} />
        {forearm !== skin && <Part g={capsule(0.042, 0.02)} c={shade(sleeve, 0.85)} position={[0, -0.215, 0]} cast={false} />}
        <group ref={wrist} position={[0, -0.25, 0]}>
          <Part g={sphere(0.046, 12)} c={skin} rough={0.6} position={[0, -0.04, 0]} scale={[0.62, 1.15, 0.95]} />
          <Part g={capsule(0.014, 0.03)} c={skin} rough={0.6} position={[0, -0.03, 0.04]} rotation-x={0.7} cast={false} />
          <group position={[-side * 0.012, -0.055, 0.01]}>{children}</group>
        </group>
      </group>
    </group>
  );
}
