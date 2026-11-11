"use client";

import type { RefObject } from "react";
import * as THREE from "three";
import { glow, shade } from "../kit";
import { Part, capsule, dome, ring, slab, sphere, tube, type Look } from "./parts";

/** Registers a group that should swing with secondary motion (braid, lanyard, drape). */
export type Tail = (el: THREE.Group | null) => void;
const INK = "#2a2422";
const SIDES = [-1, 1] as const;

/* ---------- head: face, hair, headwear. Origin = centre of the skull. ---------- */

/** Anime proportions: tall eyes a third of the way down the face, a small nose and mouth, a tapered chin. */
const IRIS = "#6a3a1c";
const blush = (skin: string) => `#${new THREE.Color(skin).lerp(new THREE.Color("#ff6f7d"), 0.38).getHexString()}`;
const LASH_ARC = Math.PI * 0.84;

export function Head({ look, eyes, pupils, tail }: { look: Look; eyes: RefObject<THREE.Group | null>; pupils: RefObject<THREE.Group | null>; tail: Tail }) {
  const { skin, hair, extras } = look;
  return (
    <group>
      <Part g={sphere(0.15, 24)} c={skin} scale={[0.93, 1.0, 0.97]} />
      {/* jaw: a smaller sphere set low and forward turns the ball into a face with a chin */}
      <Part g={sphere(0.112, 20)} c={skin} position={[0, -0.072, 0.022]} scale={[0.9, 0.86, 0.96]} cast={false} />
      {SIDES.map((s) => (
        <Part key={s} g={sphere(0.03, 10)} c={shade(skin, 0.94)} position={[s * 0.136, -0.012, -0.005]} scale={[0.5, 1, 0.8]} cast={false} />
      ))}
      <group ref={eyes} position={[0, 0.002, 0.126]}>
        {SIDES.map((s) => (
          <group key={s} position={[s * 0.058, 0, 0]}>
            <Part g={sphere(0.031, 16)} c="#fdfdfa" scale={[1.05, 1.45, 0.5]} cast={false} />
            {/* upper lash: a heavy arc over the eye; a blink squashes it into the closed-eye line */}
            <Part g={ring(0.034, 0.0062, LASH_ARC)} c={INK} position={[0, 0.004, 0.011]} rotation-z={(Math.PI - LASH_ARC) / 2} scale={[1.02, 1.36, 1]} cast={false} />
          </group>
        ))}
        <group ref={pupils}>
          {SIDES.map((s) => (
            <group key={s} position={[s * 0.058, -0.002, 0.01]}>
              <Part g={sphere(0.0215, 14)} c={IRIS} scale={[1, 1.45, 0.4]} cast={false} />
              <Part g={sphere(0.0105, 10)} c="#1c0f0a" position={[0, 0.002, 0.006]} scale={[1, 1.45, 0.4]} cast={false} />
              <mesh geometry={sphere(0.0078, 8)} material={glow("#ffffff")} position={[0.008, 0.014, 0.011]} scale={[1, 1, 0.4]} />
              <mesh geometry={sphere(0.004, 6)} material={glow("#ffffff")} position={[-0.007, -0.013, 0.011]} scale={[1, 1, 0.4]} />
            </group>
          ))}
        </group>
      </group>
      {SIDES.map((s) => (
        <Part key={s} g={slab(0.046, 0.007, 0.008)} c={shade(hair, 0.9)} position={[s * 0.058, 0.07, 0.136]} rotation-z={-s * 0.1} cast={false} />
      ))}
      {SIDES.map((s) => (
        <Part key={s} g={sphere(0.021, 10)} c={blush(skin)} position={[s * 0.09, -0.05, 0.108]} scale={[1.15, 0.6, 0.3]} cast={false} />
      ))}
      <Part g={sphere(0.0075, 8)} c={shade(skin, 0.82)} position={[0, -0.036, 0.151]} scale={[1, 0.8, 0.6]} cast={false} />
      <Part g={ring(0.02, 0.0042, Math.PI)} c="#8a3b34" position={[0, -0.074, 0.132]} rotation={[0.2, 0, Math.PI]} cast={false} />
      {extras.includes("bindi") && <Part g={sphere(0.007, 8)} c="#b3202a" position={[0, 0.07, 0.142]} cast={false} />}
      {extras.includes("glasses") && (
        <group position={[0, 0.002, 0.156]}>
          {SIDES.map((s) => (
            <Part key={s} g={ring(0.04, 0.0042)} c={INK} position={[s * 0.058, 0, 0]} scale={[1, 1.22, 1]} cast={false} />
          ))}
          <Part g={slab(0.034, 0.006, 0.006)} c={INK} cast={false} />
        </group>
      )}
      {extras.includes("beard") && (
        <>
          <Part g={dome(0.146, 1.72, 2.7)} c={hair} position={[0, 0.0, 0.014]} scale={[0.96, 1.12, 1]} />
          <Part g={capsule(0.012, 0.06)} c={hair} position={[0, -0.056, 0.142]} rotation-z={Math.PI / 2} cast={false} />
        </>
      )}
      <Hair look={look} tail={tail} />
    </group>
  );
}

/** Pointed locks hanging from the hairline: [x, length, tilt]. Uneven lengths make it read as drawn hair. */
const FRINGE: readonly (readonly [number, number, number])[] = [
  [-0.088, 0.05, 0.42],
  [-0.045, 0.062, 0.16],
  [0.002, 0.048, -0.04],
  [0.05, 0.066, -0.2],
  [0.092, 0.05, -0.46],
];
const HAIR_R = 0.158;

function Hair({ look, tail }: { look: Look; tail: Tail }) {
  const { hair, hairStyle, accent } = look;
  if (hairStyle === "turban")
    return (
      <group position={[0, 0.075, -0.008]}>
        <Part g={sphere(0.17, 20)} c={accent} scale={[1, 0.74, 1.06]} />
        {[0.42, -0.42].map((tilt) => (
          <Part key={tilt} g={ring(0.135, 0.045)} c={shade(accent, tilt > 0 ? 0.88 : 1.12)} position={[0, 0.03, 0]} rotation={[Math.PI / 2, tilt, 0]} />
        ))}
        <Part g={slab(0.07, 0.03, 0.02)} c={shade(accent, 0.6)} position={[0, -0.035, 0.15]} rotation-x={-0.3} cast={false} />
      </group>
    );
  const long = hairStyle !== "short";
  return (
    <group>
      <Part g={dome(0.157, 0, 1.66)} c={hair} position={[0, 0.016, -0.01]} rotation-x={-0.6} scale={[1, 1.1, 1.06]} />
      {/* front cap: brings the hairline down to just above the brows */}
      <Part g={dome(HAIR_R, 0, 0.72)} c={hair} position={[0, 0.016, -0.004]} rotation-x={0.46} scale={[0.99, 1.04, 1.02]} cast={false} />
      {FRINGE.map(([x, len, tilt]) => (
        <Part key={x} g={tube(0.024, 0.002, len, 6)} c={hair} position={[x, 0.094 - len / 2, Math.sqrt(HAIR_R * HAIR_R - x * x - 0.0049) - 0.002]} rotation={[0.16, 0, tilt]} scale={[1, 1, 0.4]} cast={false} />
      ))}
      {long &&
        SIDES.map((s) => (
          <Part key={s} g={capsule(0.021, 0.1)} c={hair} position={[s * 0.133, -0.035, 0.048]} rotation-z={s * 0.08} scale={[0.7, 1, 1]} cast={false} />
        ))}
      {hairStyle === "bun" && <Part g={sphere(0.062, 14)} c={hair} position={[0, 0.05, -0.17]} />}
      {hairStyle === "braid" && (
        <group ref={tail} position={[0, -0.07, -0.13]}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Part key={i} g={sphere(0.036, 10)} c={hair} position={[0, -i * 0.058, -i * 0.004]} scale={1 - i * 0.07} />
          ))}
          <Part g={sphere(0.022, 8)} c={accent} position={[0, -0.36, -0.02]} />
        </group>
      )}
      {hairStyle === "plaits" &&
        SIDES.map((s) => (
          <group key={s} ref={tail} position={[s * 0.135, -0.06, -0.03]}>
            <Part g={sphere(0.024, 8)} c={accent} />
            {[1, 2, 3].map((i) => (
              <Part key={i} g={sphere(0.032, 10)} c={hair} position={[s * 0.008 * i, -i * 0.05, 0]} scale={1 - i * 0.1} />
            ))}
          </group>
        ))}
    </group>
  );
}

/* ---------- clothes on the torso. Origin = waist; the chest front is at z ≈ 0.12. ---------- */

export function Wear({ look, tail }: { look: Look; tail: Tail }) {
  const { extras, accent, top } = look;
  return (
    <>
      {extras.includes("collar") &&
        SIDES.map((s) => <Part key={s} g={slab(0.07, 0.035, 0.012)} c={shade(top, 1.25)} position={[s * 0.042, 0.475, 0.092]} rotation={[-0.5, 0, s * 0.5]} cast={false} />)}
      {extras.includes("tie") && (
        <group position={[0, 0.45, 0.118]} rotation-x={-0.06}>
          <Part g={slab(0.036, 0.03, 0.016)} c={accent} cast={false} />
          <Part g={slab(0.04, 0.19, 0.01)} c={accent} position={[0, -0.11, 0]} cast={false} />
        </group>
      )}
      {extras.includes("lanyard") && (
        <group ref={tail} position={[0, 0.47, 0.1]}>
          {SIDES.map((s) => (
            <Part key={s} g={slab(0.009, 0.25, 0.004)} c={accent} position={[s * 0.03, -0.12, 0.022]} rotation-z={s * 0.24} cast={false} />
          ))}
          <group position={[0, -0.275, 0.03]}>
            <Part g={slab(0.075, 0.095, 0.006)} c="#fbfbf6" rough={0.4} />
            <Part g={slab(0.075, 0.022, 0.007)} c={accent} position={[0, 0.036, 0]} cast={false} />
            <Part g={sphere(0.014, 8)} c="#8d6b52" position={[-0.015, -0.005, 0.004]} scale={[1, 1, 0.3]} cast={false} />
          </group>
        </group>
      )}
      {extras.includes("backpack") && (
        <>
          <Part g={capsule(0.085, 0.14)} c={accent} position={[0, 0.27, -0.17]} scale={[1.45, 1, 0.8]} />
          <Part g={slab(0.17, 0.1, 0.03)} c={shade(accent, 0.8)} position={[0, 0.2, -0.24]} />
          {SIDES.map((s) => (
            <Part key={s} g={capsule(0.017, 0.26)} c={shade(accent, 0.8)} position={[s * 0.115, 0.34, 0.1]} rotation-x={-0.12} scale={[1, 1, 0.5]} cast={false} />
          ))}
        </>
      )}
      {extras.includes("pallu") && (
        <>
          <Part g={slab(0.11, 0.56, 0.022)} c={shade(accent, 1.22)} position={[0.01, 0.27, 0.118]} rotation-z={0.55} cast={false} />
          <Part g={slab(0.1, 0.02, 0.024)} c="#e9c46a" position={[-0.12, 0.08, 0.118]} rotation-z={0.55} cast={false} />
          <group ref={tail} position={[0.16, 0.47, -0.07]}>
            <Part g={slab(0.13, 0.52, 0.016)} c={shade(accent, 1.22)} position={[0, -0.26, -0.03]} rotation-x={0.08} />
            <Part g={slab(0.13, 0.03, 0.018)} c="#e9c46a" position={[0, -0.5, -0.05]} rotation-x={0.08} cast={false} />
          </group>
        </>
      )}
      {extras.includes("dupatta") && (
        <>
          <Part g={ring(0.105, 0.03)} c="#f4e3ae" position={[0, 0.44, 0.012]} rotation-x={Math.PI / 2 + 0.42} scale={[1.15, 1, 1]} />
          {SIDES.map((s) => (
            <group key={s} ref={tail} position={[s * 0.1, 0.4, 0.1]}>
              <Part g={slab(0.065, 0.42, 0.012)} c="#f4e3ae" position={[0, -0.21, 0.02]} rotation-z={s * 0.04} />
            </group>
          ))}
        </>
      )}
    </>
  );
}

/** Skirt, kurta hem or saree, hanging from the pelvis. */
export function Skirt({ skirt }: { skirt: NonNullable<Look["skirt"]> }) {
  const { color, length, flare, hem } = skirt;
  return (
    <group position={[0, 0.07, 0]} scale={[1.08, 1, 0.82]}>
      <Part g={tube(0.155, 0.17 + flare, length)} c={color} rough={0.85} position={[0, -length / 2, 0]} />
      {hem && <Part g={tube(0.172 + flare, 0.174 + flare, 0.035)} c={hem} position={[0, -length + 0.018, 0]} cast={false} />}
    </group>
  );
}
