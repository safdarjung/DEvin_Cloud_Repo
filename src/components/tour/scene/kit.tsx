"use client";

import { RoundedBox } from "@react-three/drei";
import { useFrame, type ThreeElements } from "@react-three/fiber";
import { createContext, useContext, useMemo, useRef, type ReactNode, type RefObject } from "react";
import * as THREE from "three";
import { surface, track, type SurfaceKind } from "./materials/textures";

/* ---------- shared state ---------- */

/** Scroll progress 0..1, written by the DOM scroll trigger, read every frame inside the canvas. */
export const ProgressContext = createContext<RefObject<number>>({ current: 0 });
export const useProgress = () => useContext(ProgressContext);
/** Low quality tier (see pickTier): no shadow maps, no crowd or critters, less grass. */
export const LiteContext = createContext(false);
export const useLite = () => useContext(LiteContext);

/**
 * Draws its children only while the camera's depth (world z) is between `min` and `max`. The camera walks one
 * way down the school, so whole wings can be switched off when they are behind it or still far ahead:
 * frustum culling alone would keep drawing every room that happens to sit behind a wall in view.
 */
export function Zone({ min = -Infinity, max = Infinity, children }: { min?: number; max?: number; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => {
    const z = state.camera.position.z;
    if (ref.current) ref.current.visible = z > min && z < max;
  });
  return <group ref={ref}>{children}</group>;
}

/* ---------- quality tier ---------- */

export type Tier = "high" | "low";
/** Phones, and laptops with little memory or few cores, get the low tier: no shadow maps, no crowd, less grass. */
export function pickTier(lite: boolean): Tier {
  if (lite) return "low";
  const nav = navigator as Navigator & { deviceMemory?: number };
  return (nav.deviceMemory ?? 8) <= 4 || (nav.hardwareConcurrency ?? 8) <= 4 ? "low" : "high";
}

/* ---------- palette (natural, slightly warm: a film set, not a toy box) ---------- */

export const C = {
  sky: "#a8d8f5",
  grass: "#6fae4a",
  grassDark: "#4e8f3c",
  path: "#d8c8a6",
  wall: "#f2e7d3",
  trim: "#b4553b",
  window: "#9fd0ea",
  white: "#f8f6f0",
  yellow: "#f0b52e",
  blue: "#2f8fd8",
  green: "#5aa832",
  red: "#e0524a",
  purple: "#a877dc",
  orange: "#ee8a26",
  wood: "#b98352",
  woodDark: "#86593a",
  ink: "#2b2d42",
  cream: "#fbf5e6",
  brass: "#c9a24a",
  steel: "#9aa3ad",
} as const;

/* ---------- materials (PBR, shared by key) ---------- */

export interface Finish {
  rough?: number;
  metal?: number;
  surface?: SurfaceKind;
}
const materials = new Map<string, THREE.MeshStandardMaterial>();
const WOODS: readonly string[] = [C.wood, C.woodDark];

/** One standard material per colour + finish. Wood colours pick up a grain automatically. */
export function mat(color: string, { rough, metal = 0, surface: kind = WOODS.includes(color) ? "grain" : undefined }: Finish = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${rough}|${metal}|${kind}`;
  let m = materials.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ color, roughness: rough ?? (kind ? 0.85 : 0.68), metalness: metal });
  if (kind) {
    const s = surface(kind);
    m.map = s.map;
    m.bumpMap = s.bumpMap;
    m.bumpScale = kind === "grain" || kind === "fabric" ? 0.6 : 1.6;
    if (s.roughnessMap) {
      m.roughnessMap = s.roughnessMap;
      m.roughness = 1;
    }
  }
  materials.set(key, m);
  return m;
}

/** A painted surface (brick, planks, …), optionally tinted. */
export const surf = (kind: SurfaceKind, tint = "#ffffff", rough?: number) => mat(tint, { surface: kind, rough });
/** Window glass: a dark mirror of the sky. */
export const glass = () => mat("#a9cfe6", { rough: 0.06, metal: 0.92 });
export const metal = (color: string = C.steel, rough = 0.35) => mat(color, { rough, metal: 0.85 });

const glows = new Map<string, THREE.MeshBasicMaterial>();
/** Unlit, over-bright: lamps and screens. Reads as "on" without a bloom pass. */
export function glow(color: string): THREE.MeshBasicMaterial {
  let m = glows.get(color);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, toneMapped: false });
    glows.set(color, m);
  }
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
    const tex = track(new THREE.CanvasTexture(canvas));
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

/**
 * Under-damped spring step (overshoot = the bounce). Long frames are integrated in small sub-steps, so on a slow
 * device a door still opens in real time instead of in slow motion; a paused tab is capped at a quarter second.
 */
export function stepSpring(s: Spring, target: number, dt: number, stiffness = 170, damping = 11): number {
  for (let left = Math.min(dt, 0.25); left > 1e-5; left -= SPRING_STEP) {
    const d = Math.min(left, SPRING_STEP);
    s.v += ((target - s.x) * stiffness - s.v * damping) * d;
    s.x += s.v * d;
  }
  return s.x;
}
const SPRING_STEP = 1 / 60;

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

/** Rounded box. `m` overrides the colour with a ready material (brick, glass, …). */
export function RBox({ size, radius = 0.08, color = C.white, m, cast = false, ...rest }: MeshProps & Shadow & { size: [number, number, number]; radius?: number; color?: string; m?: THREE.Material }) {
  const r = Math.min(radius, ...size.map((s) => s / 2 - 0.001));
  return <RoundedBox args={size} radius={r} smoothness={2} material={m ?? mat(color)} castShadow={cast} receiveShadow {...rest} />;
}

export function Ball({ r, color = C.white, m, cast = false, detail = 20, ...rest }: MeshProps & Shadow & { r: number; color?: string; m?: THREE.Material; detail?: number }) {
  return (
    <mesh material={m ?? mat(color)} castShadow={cast} receiveShadow {...rest}>
      <sphereGeometry args={[r, detail, Math.round(detail * 0.75)]} />
    </mesh>
  );
}

export function Cyl({ r, h, color = C.white, m, rTop, seg = 18, cast = false, ...rest }: MeshProps & Shadow & { r: number; h: number; color?: string; m?: THREE.Material; rTop?: number; seg?: number }) {
  return (
    <mesh material={m ?? mat(color)} castShadow={cast} receiveShadow {...rest}>
      <cylinderGeometry args={[rTop ?? r, r, h, seg]} />
    </mesh>
  );
}

/** Flat unlit label plane (signs, plaques) so text stays crisp. */
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
  t = track(new THREE.CanvasTexture(canvas));
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
