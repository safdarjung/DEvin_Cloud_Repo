"use client";

import { Instance, Instances } from "@react-three/drei";
import { useMemo } from "react";
import { Ball, C, Cyl, RBox, canvasTexture, glow, mat, metal, shade } from "../kit";
import { Blob } from "./decor";

/* Small furniture and clutter shared by the five rooms. Sizes are real: desk tops at 0.75 m, seats at 0.45 m. */

type V3 = [number, number, number];
interface Placed {
  position: V3;
  rotationY?: number;
}
const PLASTIC = "#2a2d36";

/** Flat monitor on a stand: bezel, glowing screen with a few "window" bars, and a keyboard in front of it. */
export function Computer({ position, rotationY = 0, accent = C.blue }: Placed & { accent?: string }) {
  return (
    <group position={position} rotation-y={rotationY}>
      <RBox size={[0.24, 0.015, 0.16]} radius={0.006} color={PLASTIC} position={[0, 0.008, -0.05]} />
      <Cyl r={0.018} h={0.16} color={PLASTIC} position={[0, 0.09, -0.07]} seg={8} />
      <RBox size={[0.58, 0.36, 0.025]} radius={0.012} color={PLASTIC} position={[0, 0.34, -0.06]} cast />
      <mesh material={glow("#e9f3fb")} position={[0, 0.345, -0.046]}>
        <planeGeometry args={[0.53, 0.31]} />
      </mesh>
      <mesh material={glow(accent)} position={[0, 0.47, -0.045]}>
        <planeGeometry args={[0.53, 0.05]} />
      </mesh>
      {[0.36, 0.3, 0.24].map((y, i) => (
        <mesh key={y} material={glow("#b9c7d6")} position={[-0.08 + i * 0.03, y, -0.045]}>
          <planeGeometry args={[0.3 - i * 0.06, 0.022]} />
        </mesh>
      ))}
      <RBox size={[0.42, 0.018, 0.14]} radius={0.006} color="#d9dce2" position={[0, 0.01, 0.2]} />
      <RBox size={[0.38, 0.006, 0.1]} radius={0.002} color="#aeb4be" position={[0, 0.021, 0.2]} />
      <RBox size={[0.06, 0.025, 0.1]} radius={0.012} color="#d9dce2" position={[0.32, 0.013, 0.2]} />
    </group>
  );
}

export function Mug({ position, colour = C.white, rotationY = 0 }: Placed & { colour?: string }) {
  return (
    <group position={position} rotation-y={rotationY}>
      <Cyl r={0.04} h={0.09} m={mat(colour, { rough: 0.3 })} position={[0, 0.045, 0]} seg={12} />
      <Cyl r={0.033} h={0.004} color="#5a3a26" position={[0, 0.088, 0]} seg={12} />
      <mesh material={mat(colour, { rough: 0.3 })} position={[0.045, 0.045, 0]}>
        <torusGeometry args={[0.024, 0.007, 5, 10]} />
      </mesh>
    </group>
  );
}

/** A loose stack of paper, the top sheets askew, a pen across it. */
export function Papers({ position, rotationY = 0, n = 4 }: Placed & { n?: number }) {
  return (
    <group position={position} rotation-y={rotationY}>
      {Array.from({ length: n }, (_, i) => (
        <RBox key={i} size={[0.21, 0.004, 0.3]} radius={0.002} color={i % 3 === 2 ? "#fff6d8" : "#fbfaf4"} position={[0, 0.003 + i * 0.004, 0]} rotation-y={(i * 0.37) % 0.4 - 0.15} />
      ))}
      <Cyl r={0.006} h={0.14} color="#27408b" position={[0.03, 0.012 + n * 0.004, 0.02]} rotation={[Math.PI / 2, 0, 0.6]} seg={6} />
    </group>
  );
}

/** Swivel chair: five-star base, gas lift, padded seat and back. */
export function OfficeChair({ position, rotationY = 0, colour = PLASTIC }: Placed & { colour?: string }) {
  const pad = mat(colour, { surface: "fabric" });
  return (
    <group position={position} rotation-y={rotationY}>
      {[0, 1, 2, 3, 4].map((i) => (
        <RBox key={i} size={[0.3, 0.03, 0.045]} radius={0.012} color={PLASTIC} position={[Math.cos((i / 5) * Math.PI * 2) * 0.15, 0.05, Math.sin((i / 5) * Math.PI * 2) * 0.15]} rotation-y={-(i / 5) * Math.PI * 2} />
      ))}
      <Cyl r={0.025} h={0.36} m={metal(C.steel, 0.3)} position={[0, 0.25, 0]} seg={8} />
      <RBox size={[0.5, 0.08, 0.48]} radius={0.035} m={pad} position={[0, 0.47, 0]} cast />
      <RBox size={[0.46, 0.56, 0.07]} radius={0.035} m={pad} position={[0, 0.84, -0.23]} rotation-x={-0.1} cast />
      <RBox size={[0.05, 0.3, 0.04]} radius={0.01} color={PLASTIC} position={[0, 0.58, -0.25]} />
      <Blob w={0.9} position={[0, 0, 0]} />
    </group>
  );
}

/** Plain four-legged chair (visitors, pupils). */
export function Chair({ position, rotationY = 0, colour = C.blue, seat = 0.45 }: Placed & { colour?: string; seat?: number }) {
  const legs = metal(C.steel, 0.4);
  return (
    <group position={position} rotation-y={rotationY}>
      {[-0.18, 0.18].flatMap((x) => [-0.18, 0.18].map((z) => <Cyl key={`${x}${z}`} r={0.016} h={seat} m={legs} position={[x, seat / 2, z]} seg={6} />))}
      <RBox size={[0.44, 0.04, 0.44]} radius={0.018} m={mat(colour, { rough: 0.5 })} position={[0, seat, 0]} cast />
      <RBox size={[0.44, 0.34, 0.035]} radius={0.016} m={mat(colour, { rough: 0.5 })} position={[0, seat + 0.36, -0.2]} rotation-x={-0.08} cast />
      {[-0.18, 0.18].map((x) => (
        <Cyl key={x} r={0.014} h={0.4} m={legs} position={[x, seat + 0.2, -0.2]} seg={6} />
      ))}
      <Blob w={0.8} position={[0, 0, 0]} />
    </group>
  );
}

/** Drawer fronts with pulls on the face of a desk or cabinet. Local +z is the face normal. */
export function Drawers({ position, rotationY = 0, w, h, rows = 3 }: Placed & { w: number; h: number; rows?: number }) {
  const step = h / rows;
  return (
    <group position={position} rotation-y={rotationY}>
      {Array.from({ length: rows }, (_, i) => (
        <group key={i} position={[0, h / 2 - step * (i + 0.5), 0]}>
          <RBox size={[w, step - 0.03, 0.02]} radius={0.008} color={C.wood} />
          <RBox size={[w * 0.3, 0.02, 0.025]} radius={0.008} m={metal(C.brass, 0.35)} position={[0, 0, 0.02]} />
        </group>
      ))}
    </group>
  );
}

const certificate = (accent: string) =>
  canvasTexture(`certificate:${accent}`, 256, 192, (g) => {
    g.fillStyle = "#fbf6e6";
    g.fillRect(0, 0, 256, 192);
    g.strokeStyle = accent;
    g.lineWidth = 6;
    g.strokeRect(10, 10, 236, 172);
    g.lineWidth = 1.5;
    g.strokeRect(18, 18, 220, 156);
    g.fillStyle = "#2b2d42";
    g.font = "italic 700 24px Georgia, serif";
    g.textAlign = "center";
    g.fillText("Certificate", 128, 56);
    g.fillStyle = "#8a8f99";
    for (const [y, w] of [
      [78, 150],
      [96, 120],
      [114, 136],
    ])
      g.fillRect(128 - w / 2, y, w, 4);
    g.fillStyle = "#d9a62e";
    g.beginPath();
    g.arc(196, 146, 16, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = accent;
    g.fillRect(40, 148, 70, 3);
  });

/** Framed certificate with a gold seal. */
export function Certificate({ position, rotationY = 0, accent = C.blue, w = 0.5 }: Placed & { accent?: string; w?: number }) {
  const h = w * 0.75;
  return (
    <group position={position} rotation-y={rotationY}>
      <RBox size={[w + 0.07, h + 0.07, 0.035]} radius={0.012} color={C.woodDark} />
      <mesh position={[0, 0, 0.019]}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial map={certificate(accent)} roughness={0.35} />
      </mesh>
    </group>
  );
}

const NOTE_COLOURS = ["#fff3c4", "#ffd9e2", "#d6ecff", "#def2d0", "#fffdf5", "#ffe6c9"];

/** Cork pin-board crowded with notes, a few of them children's drawings. */
export function PinBoard({ position, rotationY = 0, w = 1.4, h = 0.9, seed = 1 }: Placed & { w?: number; h?: number; seed?: number }) {
  const notes = useMemo(() => {
    const cols = Math.floor(w / 0.3);
    return Array.from({ length: cols * 2 }, (_, i) => {
      const r = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
      const k = r - Math.floor(r);
      return { x: -w / 2 + 0.2 + (i % cols) * ((w - 0.4) / Math.max(1, cols - 1)), y: i < cols ? h * 0.2 : -h * 0.2, tilt: (k - 0.5) * 0.3, c: NOTE_COLOURS[(i + seed) % NOTE_COLOURS.length], s: 0.8 + k * 0.35 };
    });
  }, [w, h, seed]);
  return (
    <group position={position} rotation-y={rotationY}>
      <RBox size={[w + 0.1, h + 0.1, 0.04]} radius={0.015} color={C.woodDark} />
      <RBox size={[w, h, 0.03]} radius={0.008} m={mat("#c79b6a", { surface: "fabric" })} position={[0, 0, 0.012]} />
      <Instances material={mat("#ffffff", { rough: 0.8 })} limit={16}>
        <boxGeometry args={[0.2, 0.25, 0.006]} />
        {notes.map((n, i) => (
          <Instance key={i} position={[n.x, n.y, 0.032]} rotation-z={n.tilt} scale={[n.s, n.s, 1]} color={n.c} />
        ))}
      </Instances>
      <Instances material={mat("#ffffff", { rough: 0.3 })} limit={16}>
        <sphereGeometry args={[0.014, 6, 5]} />
        {notes.map((n, i) => (
          <Instance key={i} position={[n.x, n.y + 0.1 * n.s, 0.04]} color={i % 2 ? C.red : C.blue} />
        ))}
      </Instances>
    </group>
  );
}

/** School bag slumped on the floor: body, front pocket, a strap looped over the top. */
export function Bag({ position, rotationY = 0, colour = C.red }: Placed & { colour?: string }) {
  return (
    <group position={position} rotation-y={rotationY}>
      <RBox size={[0.34, 0.4, 0.2]} radius={0.07} m={mat(colour, { surface: "fabric" })} position={[0, 0.2, 0]} rotation-x={-0.12} cast />
      <RBox size={[0.24, 0.2, 0.06]} radius={0.03} m={mat(shade(colour, 0.8), { surface: "fabric" })} position={[0, 0.14, 0.12]} rotation-x={-0.12} />
      <mesh material={mat(shade(colour, 0.7))} position={[0, 0.4, -0.03]} rotation-y={Math.PI / 2}>
        <torusGeometry args={[0.06, 0.012, 5, 10, Math.PI]} />
      </mesh>
      <Blob w={0.6} position={[0, 0, 0]} />
    </group>
  );
}

/** A potted desk plant, a tiffin box, a water bottle: the small things on a windowsill or counter. */
export function Bottle({ position, colour = C.blue }: { position: V3; colour?: string }) {
  return (
    <group position={position}>
      <Cyl r={0.035} h={0.2} m={mat(colour, { rough: 0.25 })} position={[0, 0.1, 0]} seg={10} />
      <Cyl r={0.022} h={0.04} color={C.white} position={[0, 0.22, 0]} seg={10} />
      <Ball r={0.02} color={C.white} position={[0, 0.25, 0]} detail={8} />
    </group>
  );
}
