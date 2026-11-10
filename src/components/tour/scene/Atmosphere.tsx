"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { STOPS, dwellAmount, stopIndexAt } from "../path";
import { TOUR_ROLES } from "../roles";
import { clamp01, useLite, useProgress } from "./kit";

const DAY = { top: "#36b3ff", horizon: "#c8f0ff", sun: "#ffffff", hemi: "#ffffff", ground: "#d8f0c0", dir: new THREE.Vector3(0.45, 0.8, 0.4).normalize() };
const DUSK = { top: "#5a6ad8", horizon: "#ffc28c", sun: "#ffb072", hemi: "#ffe4cc", ground: "#ecc9ad", dir: new THREE.Vector3(0.2, 0.16, -1).normalize() };
const ACCENT = new Map<string, THREE.Color>(TOUR_ROLES.map((r) => [r.key, new THREE.Color(r.accent)]));
/** Sunset warms in from the parent lounge to the finale. */
const DUSK_FROM = STOPS.find((s) => s.key === "parent")!.dwell[0];
const DUSK_TO = STOPS.find((s) => s.key === "finale")!.dwell[0];

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FRAG = /* glsl */ `
uniform vec3 top;
uniform vec3 horizon;
uniform vec3 ground;
uniform vec3 sunDir;
uniform vec3 sunCol;
varying vec3 vDir;
void main() {
  float h = vDir.y;
  vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.55)) : mix(horizon, ground, min(1.0, -h * 5.0));
  float s = max(dot(normalize(vDir), sunDir), 0.0);
  c += sunCol * (pow(s, 90.0) * 1.2 + pow(s, 8.0) * 0.22);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

const c = (hex: string) => new THREE.Color(hex);
const mixHex = (a: string, b: string, k: number, out: THREE.Color) => out.copy(c(a)).lerp(c(b), k);

/** Sky dome, fog, hemisphere fill and a sun that follows the camera so one small shadow map covers the shot. */
export function Atmosphere() {
  const lite = useLite();
  const progress = useProgress();
  const dome = useRef<THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const uniforms = useMemo(
    () => ({ top: { value: c(DAY.top) }, horizon: { value: c(DAY.horizon) }, ground: { value: c("#9be07a") }, sunDir: { value: DAY.dir.clone() }, sunCol: { value: c("#fff6d0") } }),
    [],
  );
  const tmp = useRef({ fwd: new THREE.Vector3(), focus: new THREE.Vector3(), col: new THREE.Color() });

  useFrame((state) => {
    const p = progress.current;
    const k = clamp01((p - DUSK_FROM) / (DUSK_TO - DUSK_FROM));
    const dusk = k * k * (3 - 2 * k);
    const cam = state.camera.position;
    const u = dome.current?.material.uniforms;
    if (dome.current && u) {
      dome.current.position.copy(cam);
      mixHex(DAY.top, DUSK.top, dusk, u.top.value);
      mixHex(DAY.horizon, DUSK.horizon, dusk, u.horizon.value);
      u.sunDir.value.copy(DAY.dir).lerp(DUSK.dir, dusk).normalize();
      mixHex("#fff6d0", "#ffd08a", dusk, u.sunCol.value);
      if (state.scene.fog instanceof THREE.Fog) state.scene.fog.color.copy(u.horizon.value);
    }

    const t = tmp.current;
    const stop = STOPS[stopIndexAt(p)];
    const accent = ACCENT.get(stop.key);
    if (hemi.current) {
      mixHex(DAY.hemi, DUSK.hemi, dusk, hemi.current.color);
      if (accent) hemi.current.color.lerp(accent, dwellAmount(p, stop) * 0.14);
      mixHex(DAY.ground, DUSK.ground, dusk, hemi.current.groundColor);
    }
    const l = sun.current;
    if (!l) return;
    mixHex(DAY.sun, DUSK.sun, dusk, l.color);
    state.camera.getWorldDirection(t.fwd);
    t.fwd.y = 0;
    t.focus.copy(cam).addScaledVector(t.fwd.normalize(), 8);
    t.focus.y = 0;
    l.position.copy(t.focus).addScaledVector(u ? u.sunDir.value : DAY.dir, 18);
    l.position.y = Math.max(l.position.y, 4);
    l.target.position.copy(t.focus);
    l.target.updateMatrixWorld();
  });

  return (
    <>
      <mesh ref={dome} frustumCulled={false} renderOrder={-1}>
        <sphereGeometry args={[120, 32, 16]} />
        <shaderMaterial uniforms={uniforms} vertexShader={VERT} fragmentShader={FRAG} side={THREE.BackSide} depthWrite={false} />
      </mesh>
      <fog attach="fog" args={[DAY.horizon, 45, 115]} />
      <hemisphereLight ref={hemi} args={[DAY.hemi, DAY.ground, 1.85]} />
      <directionalLight
        ref={sun}
        intensity={1.25}
        castShadow={!lite}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
        shadow-camera-near={1}
        shadow-camera-far={50}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-radius={3}
      />
    </>
  );
}
