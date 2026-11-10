"use client";

import { RoundedBox } from "@react-three/drei";
import type { ThreeElements } from "@react-three/fiber";
import { createContext, useContext, useMemo, type RefObject } from "react";
import * as THREE from "three";

/* ---------- shared state ---------- */

/** Scroll progress 0..1, written by the DOM scroll trigger, read every frame inside the canvas. */
export const ProgressContext = createContext<RefObject<number>>({ current: 0 });
export const useProgress = () => useContext(ProgressContext);
/** Phones/tablets in portrait run a lighter scene (fewer critters, no shadow maps). */
export const LiteContext = createContext(false);
export const useLite = () => useContext(LiteContext);

/* ---------- palette (bright, flat, Duolingo-ish) ---------- */

export const C = {
  sky: "#a8e4ff",
  grass: "#7ed957",
  grassDark: "#58c23a",
  path: "#f6dfae",
  wall: "#fff3df",
  trim: "#ff7a59",
  window: "#8fd8ff",
  white: "#ffffff",
  yellow: "#ffc800",
  blue: "#1cb0f6",
  green: "#58cc02",
  red: "#ff4b4b",
  purple: "#ce82ff",
  orange: "#ff9600",
  wood: "#c98a4b",
  woodDark: "#9b6b43",
  ink: "#2b2d42",
  cream: "#fffaf0",
} as const;

/* ---------- materials ---------- */

let gradient: THREE.DataTexture | null = null;
const materials = new Map<string, THREE.MeshToonMaterial>();

/** Three-step cel shading: flat colour with a soft lit/unlit split. One material per colour, shared. */
export function toon(color: string): THREE.MeshToonMaterial {
  let m = materials.get(color);
  if (m) return m;
  if (!gradient) {
    gradient = new THREE.DataTexture(new Uint8Array([150, 205, 255]), 3, 1, THREE.RedFormat);
    gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
    gradient.needsUpdate = true;
  }
  m = new THREE.MeshToonMaterial({ color, gradientMap: gradient });
  materials.set(color, m);
  return m;
}

/** Text on a canvas texture (≤512px wide): signs, plaques, the chalkboard. No font download. */
export function useLabel(text: string, bg: string, fg: string, w = 512, h = 128): THREE.CanvasTexture {
  return useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d")!;
    g.fillStyle = bg;
    g.beginPath();
    g.roundRect(0, 0, w, h, h * 0.22);
    g.fill();
    g.fillStyle = fg;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const lines = text.split("\n");
    const size = Math.min(h / (lines.length + 0.6), (w * 1.6) / Math.max(...lines.map((l) => l.length)));
    g.font = `800 ${size}px ui-rounded, "Arial Rounded MT Bold", system-ui, sans-serif`;
    lines.forEach((line, i) => g.fillText(line, w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.1));
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }, [text, bg, fg, w, h]);
}

/* ---------- motion ---------- */

export interface Spring {
  x: number;
  v: number;
}
export const spring = (x = 0): Spring => ({ x, v: 0 });

/** Under-damped spring step (overshoot = the bounce). dt is clamped so a paused tab can't explode it. */
export function stepSpring(s: Spring, target: number, dt: number, stiffness = 170, damping = 11): number {
  const d = Math.min(dt, 1 / 30);
  s.v += ((target - s.x) * stiffness - s.v * damping) * d;
  s.x += s.v * d;
  return s.x;
}

/** Pointer cursor for clickable scene objects (the canvas itself has no DOM targets). */
export const cursor = (on: boolean) => () => {
  document.body.style.cursor = on ? "pointer" : "";
};

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Frame-rate independent exponential approach. */
export const damp = (from: number, to: number, rate: number, dt: number) => from + (to - from) * (1 - Math.exp(-rate * dt));

/* ---------- primitives ---------- */

type MeshProps = Omit<ThreeElements["mesh"], "args" | "ref">;
type Shadow = { cast?: boolean };

/** Chunky rounded box in a flat toon colour. */
export function RBox({ size, radius = 0.08, color, cast = false, ...rest }: MeshProps & Shadow & { size: [number, number, number]; radius?: number; color: string }) {
  const r = Math.min(radius, ...size.map((s) => s / 2 - 0.001));
  return <RoundedBox args={size} radius={r} smoothness={3} material={toon(color)} castShadow={cast} receiveShadow {...rest} />;
}

export function Ball({ r, color, cast = false, detail = 20, ...rest }: MeshProps & Shadow & { r: number; color: string; detail?: number }) {
  return (
    <mesh material={toon(color)} castShadow={cast} receiveShadow {...rest}>
      <sphereGeometry args={[r, detail, Math.round(detail * 0.75)]} />
    </mesh>
  );
}

export function Cyl({ r, h, color, rTop, seg = 18, cast = false, ...rest }: MeshProps & Shadow & { r: number; h: number; color: string; rTop?: number; seg?: number }) {
  return (
    <mesh material={toon(color)} castShadow={cast} receiveShadow {...rest}>
      <cylinderGeometry args={[rTop ?? r, r, h, seg]} />
    </mesh>
  );
}

/** Flat unlit label plane (signs, plaques) so text stays crisp under toon lighting. */
export function Label({ text, w, h, bg, fg, px = 512, ...rest }: MeshProps & { text: string; w: number; h: number; bg: string; fg: string; px?: number }) {
  const map = useLabel(text, bg, fg, px, Math.round((px * h) / w));
  return (
    <mesh {...rest}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={map} transparent toneMapped={false} />
    </mesh>
  );
}

/* ---------- colour + cached canvas textures ---------- */

/** k<1 darkens, k>1 mixes toward white (k=1.6 → 60% white). */
export function shade(color: string, k: number): string {
  const c = new THREE.Color(color);
  return `#${(k < 1 ? c.multiplyScalar(k) : c.lerp(new THREE.Color("#ffffff"), k - 1)).getHexString()}`;
}

const textures = new Map<string, THREE.CanvasTexture>();
/** Draw once into a small canvas (≤512px) and share the texture by key. */
export function canvasTexture(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  let t = textures.get(key);
  if (t) return t;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext("2d")!);
  t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  textures.set(key, t);
  return t;
}

const basics = new Map<string, THREE.MeshBasicMaterial>();
/** Unlit transparent material over a cached texture: blob shadows, floor-edge shading, sky in windows. */
export function decal(key: string, map: THREE.Texture, opacity = 1): THREE.MeshBasicMaterial {
  const id = `${key}:${opacity}`;
  let m = basics.get(id);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ map, transparent: true, opacity, depthWrite: false, toneMapped: false });
    basics.set(id, m);
  }
  return m;
}

export const blobTexture = () =>
  canvasTexture("blob", 128, 128, (g) => {
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, "rgba(40,30,60,0.55)");
    r.addColorStop(0.55, "rgba(40,30,60,0.28)");
    r.addColorStop(1, "rgba(40,30,60,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
  });

export const edgeTexture = () =>
  canvasTexture("edge", 4, 64, (g) => {
    const r = g.createLinearGradient(0, 0, 0, 64);
    r.addColorStop(0, "rgba(70,40,30,0.32)");
    r.addColorStop(1, "rgba(70,40,30,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, 4, 64);
  });
