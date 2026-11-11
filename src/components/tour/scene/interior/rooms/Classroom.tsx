"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { PaperPlane } from "../../exterior/Critters";
import { Blob, Bunting, Clock, Rug, SkyWindow } from "../decor";
import { InRoom, ROLE } from "../Rooms";
import { Bag, Chair, Drawers, Mug, Papers, PinBoard } from "../props";
import { Ball, C, Cyl, Label, RBox, canvasTexture, mat, metal, shade } from "../../kit";
import { Person, stopFor } from "../../characters/Person";
import { LOOKS, kidLook } from "../../characters/parts";

const FAR = -Math.PI / 2;

const KIDS = [
  { p: [2.05, 0, 2.05], c: C.yellow, seed: 0 },
  { p: [3.45, 0, 1.55], c: "#ff6fae", seed: 2.1 },
] as const;

/** Classmate at a desk, facing the teacher; now and then a hand goes up. */
function Kid({ position, seed }: { position: readonly number[]; seed: number }) {
  const [x, , z] = position;
  return (
    <group position={[x, 0, z]} rotation-y={Math.atan2(0.8 - x, 0.6 - z)}>
      <RBox size={[0.85, 0.07, 0.55]} radius={0.03} color={C.wood} position={[0, 0.56, 0.42]} cast />
      {[-0.33, 0.33].map((dx) => (
        <RBox key={dx} size={[0.06, 0.54, 0.45]} radius={0.02} color={C.woodDark} position={[dx, 0.27, 0.42]} />
      ))}
      <RBox size={[0.36, 0.02, 0.26]} radius={0.01} color={C.white} position={[0.1, 0.605, 0.4]} rotation-y={0.2} />
      <RBox size={[0.42, 0.05, 0.4]} radius={0.02} color={C.blue} position={[0, 0.27, -0.08]} />
      <RBox size={[0.42, 0.4, 0.04]} radius={0.02} color={C.blue} position={[0, 0.5, -0.28]} />
      {[-0.17, 0.17].map((dx) => (
        <Cyl key={dx} r={0.018} h={0.27} m={metal()} position={[dx, 0.135, -0.08]} seg={6} />
      ))}
      <Person look={kidLook(Math.round(seed) + 1)} action="sit" seed={seed} position={[0, 0, -0.08]} rotationY={0} />
      <Blob w={1.1} d={1.2} position={[0, 0, 0.2]} />
    </group>
  );
}

/** A real blackboard: wiped-chalk haze, the day's lesson in a teacher's hand, a pie cut in quarters. */
const chalkboard = () =>
  canvasTexture("chalkboard", 512, 224, (g) => {
    g.fillStyle = "#2c5a47";
    g.fillRect(0, 0, 512, 224);
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `rgba(255,255,255,${0.012 + (i % 5) * 0.006})`;
      g.beginPath();
      g.ellipse((i * 97) % 512, (i * 53) % 224, 60 + ((i * 31) % 70), 14 + ((i * 17) % 20), (i % 7) * 0.2, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = "rgba(250,250,240,0.92)";
    g.font = 'italic 600 34px "Segoe Print", "Comic Sans MS", cursive';
    g.fillText("Fractions", 26, 50);
    g.font = 'italic 500 26px "Segoe Print", "Comic Sans MS", cursive';
    g.fillText("1/2  +  1/4  =  3/4", 26, 104);
    g.fillStyle = "rgba(255,226,140,0.9)";
    g.fillText("Homework: page 42", 26, 190);
    g.strokeStyle = "rgba(250,250,240,0.9)";
    g.lineWidth = 3;
    g.beginPath();
    g.arc(410, 100, 58, 0, Math.PI * 2);
    g.moveTo(352, 100);
    g.lineTo(468, 100);
    g.moveTo(410, 42);
    g.lineTo(410, 158);
    g.stroke();
    g.fillStyle = "rgba(255,170,190,0.55)";
    g.beginPath();
    g.moveTo(410, 100);
    g.arc(410, 100, 56, -Math.PI / 2, Math.PI);
    g.fill();
    g.fillStyle = "rgba(250,250,240,0.7)";
    g.font = '500 15px "Segoe Print", "Comic Sans MS", cursive';
    g.fillText("Mon 10 Nov", 400, 28);
  });

/** Flip-chart easel beside the teacher: she writes on it. Local frame = the teacher's (she faces +z). */
function Easel() {
  return (
    <group position={[-0.72, 0, 0.3]} rotation-y={1.05}>
      {[-0.32, 0.32].map((x) => (
        <Cyl key={x} r={0.018} h={1.95} color={C.wood} position={[x, 0.96, -0.06]} rotation-x={-0.06} seg={6} />
      ))}
      <Cyl r={0.018} h={1.9} color={C.wood} position={[0, 0.94, -0.42]} rotation-x={0.36} seg={6} />
      <RBox size={[0.8, 1.0, 0.03]} radius={0.01} color={C.white} position={[0, 1.38, 0]} cast />
      <Label text={"Today:\nFractions"} w={0.68} h={0.4} bg="#fbfbf6" fg="#2b4a8a" px={256} position={[0, 1.6, 0.017]} />
      <RBox size={[0.84, 0.04, 0.09]} radius={0.01} color={C.woodDark} position={[0, 0.86, 0.03]} />
      <Blob w={1.1} d={0.9} position={[0, 0, -0.2]} />
    </group>
  );
}

/** Globe on the teacher's desk, turning on its tilted axis. */
function Globe({ position }: { position: [number, number, number] }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.8;
  });
  return (
    <group position={position}>
      <Cyl r={0.12} h={0.04} color={C.woodDark} />
      <Cyl r={0.02} h={0.22} color={C.yellow} position={[0, 0.12, 0]} seg={6} />
      <group position={[0, 0.42, 0]} rotation-z={0.4}>
        <mesh rotation-x={Math.PI / 2}>
          <torusGeometry args={[0.24, 0.012, 6, 28, Math.PI]} />
          <meshBasicMaterial color={C.yellow} />
        </mesh>
        <group ref={ref}>
          <Ball r={0.21} color={C.blue} cast />
          <Ball r={0.1} color={C.green} position={[0.12, 0.08, 0.12]} scale={[1, 0.8, 0.5]} />
          <Ball r={0.09} color={C.green} position={[-0.14, -0.04, 0.1]} scale={[0.8, 1.1, 0.5]} />
          <Ball r={0.08} color={C.green} position={[0.02, 0.1, -0.17]} scale={[1.2, 0.7, 0.5]} />
        </group>
      </group>
    </group>
  );
}

export function Classroom() {
  const role = ROLE.teacher;
  return (
    <InRoom roleKey="teacher">
      <Rug r={1.8} accent={role.accent} position={[1.6, 0.02, 0.6]} />
      <group position={[4.4, 1.95, -0.9]} rotation-y={FAR}>
        <RBox size={[3.6, 1.7, 0.1]} radius={0.06} color={C.wood} />
        <mesh position={[0, 0, 0.056]}>
          <planeGeometry args={[3.36, 1.46]} />
          <meshToonMaterial map={chalkboard()} />
        </mesh>
        <RBox size={[0.16, 0.06, 0.09]} radius={0.02} m={mat("#e8e2d2", { surface: "fabric" })} position={[-1.1, -0.8, 0.1]} />
        <RBox size={[3.2, 0.06, 0.16]} radius={0.02} color={C.woodDark} position={[0, -0.86, 0.08]} />
        {[C.white, C.yellow, "#ff9ebb"].map((c, i) => (
          <Cyl key={c} r={0.025} h={0.14} color={c} position={[0.6 + i * 0.18, -0.81, 0.1]} rotation-z={Math.PI / 2} seg={6} />
        ))}
      </group>
      <SkyWindow position={[4.42, 1.85, 2.2]} rotationY={FAR} w={1.1} h={1.2} curtain={shade(role.accent, 1.3)} />
      <Clock position={[4.42, 3.05, 2.2]} rotationY={FAR} rim={role.accent} r={0.26} />
      <Bunting a={[4.38, 3.4, -3.4]} b={[4.38, 3.4, 1.2]} n={14} sag={0.22} />
      <group position={[2.75, 0, -1.75]}>
        <RBox size={[1, 0.1, 1.6]} radius={0.04} color={C.wood} position={[0, 0.8, 0]} cast />
        <RBox size={[0.9, 0.75, 0.1]} radius={0.03} color={C.woodDark} position={[0, 0.38, -0.7]} />
        <RBox size={[0.9, 0.75, 0.1]} radius={0.03} color={C.woodDark} position={[0, 0.38, 0.7]} />
        <Ball r={0.13} color={C.red} position={[-0.15, 0.97, 0.45]} cast />
        <RBox size={[0.04, 0.1, 0.07]} radius={0.015} color={C.green} position={[-0.13, 1.12, 0.47]} rotation-z={0.4} />
        {[C.blue, C.orange, C.purple].map((c, i) => (
          <RBox key={c} size={[0.4, 0.07, 0.3]} radius={0.02} color={c} position={[0.15, 0.89 + i * 0.075, 0.1]} rotation-y={i * 0.25} />
        ))}
        <Globe position={[0.05, 0.85, -0.45]} />
        <Blob w={1.6} d={2.3} position={[0, 0, 0]} />
      </group>
      <Drawers position={[2.24, 0.42, -1.75]} rotationY={-Math.PI / 2} w={0.9} h={0.6} rows={2} />
      <Mug position={[2.6, 0.85, -2.3]} colour={role.accent} rotationY={0.6} />
      <Papers position={[2.75, 0.85, -1.2]} rotationY={-0.2} n={7} />
      <Bag position={[1.55, 0, 2.35]} rotationY={0.9} colour={C.red} />
      <Bag position={[3.9, 0, 1.25]} rotationY={-0.7} colour={C.blue} />
      <PinBoard position={[2.3, 2.1, 3.57]} rotationY={Math.PI} w={2.2} h={1.1} seed={5} />
      <group position={[3.1, 0, 3.0]} rotation-y={Math.atan2(0.8 - 3.1, 0.6 - 3.0)}>
        <RBox size={[0.85, 0.07, 0.55]} radius={0.03} color={C.wood} position={[0, 0.56, 0.42]} cast />
        {[-0.33, 0.33].map((dx) => (
          <RBox key={dx} size={[0.06, 0.54, 0.45]} radius={0.02} color={C.woodDark} position={[dx, 0.27, 0.42]} />
        ))}
        <Chair position={[0, 0, -0.08]} seat={0.28} colour={C.blue} />
      </group>
      {KIDS.map((k) => (
        <Kid key={k.seed} position={k.p} seed={k.seed} />
      ))}
      <PaperPlane centre={[2.2, 2.55, 0.4]} radius={[1.6, 1.1]} speed={0.55} />
      <Person
        look={LOOKS.teacher(role.accent)}
        action="write"
        stop={stopFor("teacher")}
        seed={3}
        stage={<Easel />}
        handR={<Cyl r={0.012} h={0.13} color={C.ink} position={[0, -0.03, 0.03]} rotation-x={0.9} seg={8} />}
        handL={
          <group position={[0, -0.03, 0.06]} rotation-x={0.3}>
            <RBox size={[0.3, 0.21, 0.02]} radius={0.008} color={C.blue} />
            <RBox size={[0.27, 0.18, 0.02]} radius={0.005} color={C.cream} position={[0, 0, 0.012]} />
          </group>
        }
      />
    </InRoom>
  );
}
