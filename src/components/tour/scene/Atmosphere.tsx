"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { CORRIDOR_END_Z, STOPS, dwellAmount, stopIndexAt } from "../path";
import { TOUR_ROLES } from "../roles";
import { clamp01, useLite, useProgress } from "./kit";

// Anime daylight: a deep summer sky, white cumulus with blue undersides, and shade that is violet-blue, not grey.
const DAY = { top: "#1766dc", horizon: "#bfe4fb", sun: "#fff3dc", hemi: "#c9d2ff", ground: "#e6d6c6", cloud: "#ffffff", cloudShade: "#b9d0f0", dir: new THREE.Vector3(0.45, 0.8, 0.4).normalize() };
const DUSK = { top: "#3f4fb8", horizon: "#ffb88a", sun: "#ff9a5a", hemi: "#e9c4e6", ground: "#e2ab8e", cloud: "#ffe2c2", cloudShade: "#c886a6", dir: new THREE.Vector3(0.2, 0.16, -1).normalize() };
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
uniform vec3 cloud;
uniform vec3 cloudShade;
uniform float time;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 5; i++) {
    s += a * noise(p);
    p = p * 2.03 + 17.0;
    a *= 0.5;
  }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.5)) : mix(horizon, ground, min(1.0, -h * 5.0));
  float s = max(dot(d, sunDir), 0.0);
  c += sunCol * (pow(s, 90.0) * 1.2 + pow(s, 8.0) * 0.22);

  // Painted cumulus standing on the horizon. Sampled around the compass circle, so there is no seam.
  vec2 ring = normalize(d.xz + 1e-5);
  float towers = fbm(ring * 2.6 + vec2(time * 0.006, 3.0));
  float puff = fbm(ring * 9.0 + vec2(h * 7.0, -h * 7.0) + time * 0.01);
  float crest = 0.03 + 0.34 * smoothstep(0.38, 0.72, towers) + 0.09 * (puff - 0.5);
  float aa = fwidth(h) * 1.5 + 0.002;
  float body = smoothstep(crest + aa, crest - aa, h) * step(0.0, h);
  // Three flat tones, like a background painting: lit crown, blue underside, hazier base.
  float under = smoothstep(crest - 0.05 - 0.07 * puff + aa, crest - 0.05 - 0.07 * puff - aa, h);
  float base = smoothstep(crest - 0.15 - 0.1 * puff + aa, crest - 0.15 - 0.1 * puff - aa, h);
  vec3 cl = mix(cloud, cloudShade, under * 0.75);
  cl = mix(cl, mix(cloudShade, horizon, 0.45), base * 0.8);
  cl += sunCol * pow(s, 6.0) * 0.12;
  c = mix(c, cl, body * smoothstep(0.0, 0.035, h));
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

/** Light levels outdoors → indoors (the roof casts no shadow map, so the sun is simply turned down inside). */
const SUN = [2.0, 1.0] as const;
/** Cel shading has no image-based fill: the hemisphere light alone colours the shadow tone, so it is strong. */
const HEMI = [2.1, 2.3] as const;
const LAMP = 20;

const c = (hex: string) => new THREE.Color(hex);
const mixHex = (a: string, b: string, k: number, out: THREE.Color) => out.copy(c(a)).lerp(c(b), k);

/** Sky dome, fog, a warm indoor lamp and a sun that follows the camera so one small shadow map covers the shot. */
export function Atmosphere() {
  const lite = useLite();
  const progress = useProgress();
  const dome = useRef<THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const lamp = useRef<THREE.PointLight>(null);
  const uniforms = useMemo(
    () => ({ top: { value: c(DAY.top) }, horizon: { value: c(DAY.horizon) }, ground: { value: c("#9be07a") }, sunDir: { value: DAY.dir.clone() }, sunCol: { value: c("#fff6d0") }, cloud: { value: c(DAY.cloud) }, cloudShade: { value: c(DAY.cloudShade) }, time: { value: 0 } }),
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
      mixHex(DAY.cloud, DUSK.cloud, dusk, u.cloud.value);
      mixHex(DAY.cloudShade, DUSK.cloudShade, dusk, u.cloudShade.value);
      u.time.value = state.clock.elapsedTime;
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
    // 1 inside the building, easing to 0 over the two metres either side of the front and garden doors.
    const inside = clamp01((1 - cam.z) / 2) * clamp01((cam.z - CORRIDOR_END_Z + 1) / 2);
    const mix = (pair: readonly [number, number]) => pair[0] + (pair[1] - pair[0]) * inside;
    if (hemi.current) hemi.current.intensity = mix(HEMI);
    if (lamp.current) {
      lamp.current.intensity = inside * LAMP;
      lamp.current.position.set(cam.x * 0.75, 3.05, cam.z - 0.5);
    }
    const l = sun.current;
    if (!l) return;
    l.intensity = mix(SUN);
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
      <fog attach="fog" args={[DAY.horizon, 38, 125]} />
      <hemisphereLight ref={hemi} args={[DAY.hemi, DAY.ground, HEMI[0]]} />
      <pointLight ref={lamp} color="#ffe3bd" intensity={0} distance={15} decay={1.5} />
      <directionalLight
        ref={sun}
        intensity={SUN[0]}
        castShadow={!lite}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
        shadow-camera-near={1}
        shadow-camera-far={50}
        shadow-bias={-0.0004}
        shadow-normalBias={0.05}
        shadow-radius={4}
      />
    </>
  );
}
