"use client";

import type { ThreeElements } from "@react-three/fiber";
import * as THREE from "three";
import { mat, shade } from "../kit";
import type { TourRoleKey } from "../../roles";

/* ---------- shared geometry (every person reuses the same few buffers) ---------- */

const geos = new Map<string, THREE.BufferGeometry>();
function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geos.get(key) as T | undefined;
  if (!g) {
    g = make();
    geos.set(key, g);
  }
  return g;
}
export const capsule = (r: number, len: number) => cached(`c:${r}:${len}`, () => new THREE.CapsuleGeometry(r, len, 5, 12));
export const sphere = (r: number, seg = 16) => cached(`s:${r}:${seg}`, () => new THREE.SphereGeometry(r, seg, Math.round(seg * 0.7)));
/** Part of a sphere between two polar angles (hair caps, beards). */
export const dome = (r: number, from: number, to: number) => cached(`d:${r}:${from}:${to}`, () => new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, from, to - from));
export const tube = (rTop: number, rBottom: number, h: number, seg = 16) => cached(`t:${rTop}:${rBottom}:${h}:${seg}`, () => new THREE.CylinderGeometry(rTop, rBottom, h, seg));
export const ring = (r: number, t: number, arc = Math.PI * 2) => cached(`r:${r}:${t}:${arc}`, () => new THREE.TorusGeometry(r, t, 6, 18, arc));
export const slab = (w: number, h: number, d: number) => cached(`b:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d));

type MeshProps = Omit<ThreeElements["mesh"], "args" | "ref" | "geometry" | "material">;
/** One body part: shared geometry + shared material, casting a shadow. */
export function Part({ g, c, rough = 0.8, m, cast = true, ...rest }: MeshProps & { g: THREE.BufferGeometry; c?: string; rough?: number; m?: THREE.Material; cast?: boolean }) {
  return <mesh geometry={g} material={m ?? mat(c ?? "#ffffff", { rough })} castShadow={cast} receiveShadow {...rest} />;
}

/* ---------- looks: one rig, five wardrobes ---------- */

export type HairStyle = "short" | "bun" | "braid" | "plaits" | "turban";
export type Extra = "glasses" | "tie" | "lanyard" | "backpack" | "beard" | "bindi" | "pallu" | "dupatta" | "collar";
export interface Look {
  /** 1 = adult (about 1.75 m with the stylised head). */
  scale: number;
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  top: string;
  sleeves: "long" | "short";
  thigh: string;
  shin: string;
  shoe: string;
  /** Skirt, kurta hem or saree: length in metres from the waist, and how far it flares. */
  skirt?: { color: string; length: number; flare: number; hem?: string };
  accent: string;
  extras: readonly Extra[];
}

const SKIN = { warm: "#c98f62", deep: "#9c6a45", tan: "#b9825a", light: "#d9a57c" } as const;
const HAIR = { black: "#1d1a1c", brown: "#33241c", grey: "#6f6a68" } as const;

/** The five people who run the school, dressed in their role colour. */
export const LOOKS: Record<TourRoleKey, (accent: string) => Look> = {
  // Principal: saree in the role colour, hair in a greying bun, glasses.
  principal: (accent) => ({
    scale: 0.97,
    skin: SKIN.warm,
    hair: HAIR.grey,
    hairStyle: "bun",
    top: shade(accent, 0.7),
    sleeves: "short",
    thigh: accent,
    shin: accent,
    shoe: "#5b3a29",
    skirt: { color: accent, length: 0.84, flare: 0.1, hem: "#e9c46a" },
    accent,
    extras: ["glasses", "pallu", "bindi"],
  }),
  // Administrator: short-sleeved shirt, ID lanyard.
  admin: (accent) => ({
    scale: 1,
    skin: SKIN.deep,
    hair: HAIR.black,
    hairStyle: "short",
    top: shade(accent, 1.25),
    sleeves: "short",
    thigh: "#3b4252",
    shin: "#3b4252",
    shoe: "#22252e",
    accent,
    extras: ["lanyard", "collar", "glasses"],
  }),
  // Teacher: kurta with a dupatta, long braid.
  teacher: (accent) => ({
    scale: 0.95,
    skin: SKIN.tan,
    hair: HAIR.black,
    hairStyle: "braid",
    top: accent,
    sleeves: "long",
    thigh: "#f3ead8",
    shin: "#f3ead8",
    shoe: "#8a5a3c",
    skirt: { color: accent, length: 0.5, flare: 0.05, hem: shade(accent, 0.7) },
    accent,
    extras: ["dupatta", "bindi"],
  }),
  // Student: white shirt, tie, pinafore skirt, plaits with ribbons, backpack.
  student: (accent) => ({
    scale: 0.76,
    skin: SKIN.light,
    hair: HAIR.brown,
    hairStyle: "plaits",
    top: "#f4f4ee",
    sleeves: "short",
    thigh: SKIN.light,
    shin: "#f4f4ee",
    shoe: "#1f2026",
    skirt: { color: "#2f3e63", length: 0.32, flare: 0.09 },
    accent,
    extras: ["tie", "backpack", "collar"],
  }),
  // Parent: father in a turban, kurta shirt, phone in hand.
  parent: (accent) => ({
    scale: 1.02,
    skin: SKIN.warm,
    hair: HAIR.black,
    hairStyle: "turban",
    top: "#f1ead9",
    sleeves: "long",
    thigh: "#3a4660",
    shin: "#3a4660",
    shoe: "#4a3327",
    skirt: { color: "#f1ead9", length: 0.3, flare: 0.02 },
    accent,
    extras: ["beard"],
  }),
};

const KID_TOPS = ["#f4f4ee", "#f4f4ee", "#f4f4ee"] as const;
/** Background schoolchildren in the same uniform, varied by seed. */
export function kidLook(seed: number, accent = "#2f3e63"): Look {
  const girl = seed % 2 === 0;
  return {
    scale: 0.7 + (seed % 3) * 0.04,
    skin: [SKIN.light, SKIN.deep, SKIN.tan, SKIN.warm][seed % 4],
    hair: seed % 3 ? HAIR.black : HAIR.brown,
    hairStyle: girl ? (seed % 4 ? "plaits" : "braid") : "short",
    top: KID_TOPS[seed % 3],
    sleeves: "short",
    thigh: girl ? [SKIN.light, SKIN.deep, SKIN.tan, SKIN.warm][seed % 4] : "#2f3e63",
    shin: girl ? "#f4f4ee" : "#2f3e63",
    shoe: "#1f2026",
    skirt: girl ? { color: "#2f3e63", length: 0.32, flare: 0.09 } : undefined,
    accent,
    extras: seed % 3 === 0 ? ["tie", "collar", "backpack"] : ["tie", "collar"],
  };
}
