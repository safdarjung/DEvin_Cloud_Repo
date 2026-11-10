"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { STOPS, cameraAt } from "../path";
import { clamp01, damp, useProgress } from "./kit";

const UP = new THREE.Vector3(0, 1, 0);
/** No input for this long: render idle loops at half rate. */
const IDLE_MS = 4000;

/**
 * Camera follows the scroll path (smoothed), plus pointer parallax: big at the gate (the toy),
 * subtle inside. The sun rides along so one small shadow map always covers what is on screen.
 */
export function CameraRig() {
  const progress = useProgress();
  const sun = useRef<THREE.DirectionalLight>(null);
  const live = useRef({ p: progress.current, px: 0, py: 0, fwd: new THREE.Vector3(), right: new THREE.Vector3() });

  useFrame((state, dt) => {
    const s = live.current;
    s.p = damp(s.p, progress.current, 4.5, dt);
    const { position, lookAt } = cameraAt(s.p);
    s.px = damp(s.px, state.pointer.x, 3, dt);
    s.py = damp(s.py, state.pointer.y, 3, dt);
    const toy = 1 - clamp01(s.p / STOPS[0].dwell[1]);
    const amt = 0.18 + toy * 1.1;
    s.fwd.subVectors(lookAt, position).normalize();
    s.right.crossVectors(s.fwd, UP).normalize();
    position.addScaledVector(s.right, s.px * amt).addScaledVector(UP, s.py * amt * 0.45);
    lookAt.addScaledVector(s.right, s.px * amt * 0.3);
    state.camera.position.copy(position);
    state.camera.lookAt(lookAt);

    const l = sun.current;
    if (!l) return;
    s.fwd.y = 0;
    const focus = position.addScaledVector(s.fwd.normalize(), 8);
    l.position.set(focus.x + 7, 14, focus.z + 6);
    l.target.position.set(focus.x, 0, focus.z);
    l.target.updateMatrixWorld();
  });

  return (
    <directionalLight
      ref={sun}
      intensity={1.3}
      castShadow
      shadow-mapSize={[1024, 1024]}
      shadow-camera-left={-14}
      shadow-camera-right={14}
      shadow-camera-top={14}
      shadow-camera-bottom={-14}
      shadow-camera-near={1}
      shadow-camera-far={45}
      shadow-bias={-0.0004}
      shadow-normalBias={0.03}
    />
  );
}

/**
 * frameloop="demand": render only when asked. Ask every frame while the canvas is on screen,
 * every other frame once the visitor has been idle (loops keep moving, battery is spared).
 */
export function Ticker() {
  const invalidate = useThree((s) => s.invalidate);
  const canvas = useThree((s) => s.gl.domElement);

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
