"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { FINALE_Z, MASCOT_SPOT, STOPS, cameraAt, dwellAmount, pathParamAt, roomToWorld, stopIndexAt, type StopKey } from "../path";
import { clamp01, damp, useProgress } from "./kit";

const UP = new THREE.Vector3(0, 1, 0);
/** No input for this long: render idle loops at half rate. */
const IDLE_MS = 4000;
/** Camera drift while standing still, metres. */
const HANDHELD = 0.012;
/** Footsteps over the whole path (bob phase per unit of arc-length fraction). */
const STRIDE = 260;

/** Portrait screens dock the card at the bottom, so frame each subject centred and high. */
function portraitFocus(key: StopKey, out: THREE.Vector3): THREE.Vector3 {
  if (key === "gate") return out.set(0, 2.4, 4);
  if (key === "finale") return out.set(0, 0.7, FINALE_Z);
  const [x, , z] = roomToWorld(key, MASCOT_SPOT);
  return out.set(x, 0.75, z);
}

/**
 * Camera follows the scroll path (smoothed), with a footstep bob and a bank into turns while it moves,
 * and pointer parallax: big at the gate (the toy), subtle inside.
 */
export function CameraRig() {
  const progress = useProgress();
  const live = useRef({ p: progress.current, u: 0, walk: 0, roll: 0, yaw: 0, px: 0, py: 0, fwd: new THREE.Vector3(), right: new THREE.Vector3(), focus: new THREE.Vector3() });

  useFrame((state, dt) => {
    const s = live.current;
    const cam = state.camera as THREE.PerspectiveCamera;
    const portrait = state.size.width / state.size.height < 0.9;
    const fov = portrait ? 64 : 50;
    if (cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }

    s.p = damp(s.p, progress.current, 4.5, dt);
    const { position, lookAt } = cameraAt(s.p);
    const u = pathParamAt(s.p);
    const speed = Math.abs(u - s.u) / Math.max(dt, 1e-3);
    s.u = u;
    s.walk = damp(s.walk, clamp01(speed * 14), 5, dt);

    const stop = STOPS[stopIndexAt(s.p)];
    if (portrait) {
      const here = dwellAmount(s.p, stop);
      lookAt.lerp(portraitFocus(stop.key, s.focus), here * 0.9);
      lookAt.y -= 0.35;
      // Outdoors there is room to step back so the whole gate / all five mascots fit a narrow screen.
      if (stop.key === "finale" || stop.key === "gate") position.add(s.fwd.subVectors(position, lookAt).setY(0).normalize().multiplyScalar(here * 4.5));
    }

    s.px = damp(s.px, state.pointer.x, 3, dt);
    s.py = damp(s.py, state.pointer.y, 3, dt);
    const toy = 1 - clamp01(s.p / STOPS[0].dwell[1]);
    const amt = (0.15 + toy * 1.1) * (portrait ? 0.4 : 1);
    s.fwd.subVectors(lookAt, position).normalize();
    s.right.crossVectors(s.fwd, UP).normalize();
    position.addScaledVector(s.right, s.px * amt).addScaledVector(UP, s.py * amt * 0.45 + Math.sin(u * STRIDE) * 0.035 * s.walk);
    lookAt.addScaledVector(s.right, s.px * amt * 0.3);
    // Handheld: the operator is never perfectly still, even during a dwell.
    const t = state.clock.elapsedTime;
    position.addScaledVector(s.right, Math.sin(t * 0.7) * HANDHELD + Math.sin(t * 1.9 + 1) * HANDHELD * 0.4).addScaledVector(UP, Math.sin(t * 0.9 + 2) * HANDHELD * 0.8);
    cam.position.copy(position);
    cam.lookAt(lookAt);

    // Bank gently into turns, like a handheld walk-through.
    const yaw = Math.atan2(s.fwd.x, s.fwd.z);
    let dYaw = yaw - s.yaw;
    if (dYaw > Math.PI) dYaw -= Math.PI * 2;
    if (dYaw < -Math.PI) dYaw += Math.PI * 2;
    s.yaw = yaw;
    s.roll = damp(s.roll, THREE.MathUtils.clamp((-dYaw / Math.max(dt, 1e-3)) * 0.04, -0.07, 0.07) + Math.sin(u * STRIDE * 0.5) * 0.008 * s.walk, 4, dt);
    cam.rotateZ(s.roll + Math.sin(t * 0.6 + 0.5) * 0.003);
  });

  return null;
}

/**
 * frameloop="demand": render only when asked. Ask every frame while the canvas is on screen,
 * every other frame once the visitor has been idle (loops keep moving, battery is spared).
 * Also tells the page when the first frames are on screen (hides the loader).
 */
export function Ticker({ onReady }: { onReady?: () => void }) {
  const invalidate = useThree((s) => s.invalidate);
  const canvas = useThree((s) => s.gl.domElement);
  const frames = useRef(0);

  useFrame(({ gl }) => {
    frames.current++;
    if (frames.current === 3) onReady?.();
    // Dev-only budget check: last frame's draw calls and triangles (shadow pass included), read as window.__tourInfo.
    if (process.env.NODE_ENV !== "production") (window as Window & { __tourInfo?: object }).__tourInfo = { calls: gl.info.render.calls, triangles: gl.info.render.triangles, textures: gl.info.memory.textures, geometries: gl.info.memory.geometries };
  });

  useEffect(() => {
    let visible = true;
    let frame = 0;
    let n = 0;
    let last = performance.now();
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
    });
    io.observe(canvas);
    const wake = () => {
      last = performance.now();
    };
    window.addEventListener("scroll", wake, { passive: true });
    window.addEventListener("pointermove", wake, { passive: true });
    const loop = () => {
      frame = requestAnimationFrame(loop);
      if (!visible) return;
      n++;
      if (performance.now() - last > IDLE_MS && n % 2) return;
      invalidate();
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      io.disconnect();
      window.removeEventListener("scroll", wake);
      window.removeEventListener("pointermove", wake);
    };
  }, [canvas, invalidate]);

  return null;
}
