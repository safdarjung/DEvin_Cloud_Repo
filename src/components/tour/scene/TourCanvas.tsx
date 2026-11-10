"use client";

import { Canvas } from "@react-three/fiber";
import type { RefObject } from "react";
import { TOUR_ROLES } from "../roles";
import { Building } from "./Building";
import { CameraRig, Ticker } from "./CameraRig";
import { Exterior } from "./Exterior";
import { FamilyRooms } from "./FamilyRooms";
import { Interior } from "./Interior";
import { C, ProgressContext } from "./kit";
import { StaffRooms } from "./StaffRooms";

const ACCENTS = TOUR_ROLES.map((r) => r.accent);

/** The whole school in one canvas. `flat` = no tone mapping, so toon colours stay exactly as picked. */
export default function TourCanvas({ progress }: { progress: RefObject<number> }) {
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 1.75]}
      shadows="percentage"
      flat
      camera={{ fov: 50, near: 0.1, far: 160, position: [0, 3, 21] }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
    >
      <ProgressContext value={progress}>
        <color attach="background" args={[C.sky]} />
        <fog attach="fog" args={[C.sky, 45, 150]} />
        <hemisphereLight args={["#ffffff", "#d8f0c0", 1.8]} />
        <CameraRig />
        <Ticker />
        <Exterior accents={ACCENTS} />
        <Building />
        <Interior />
        <StaffRooms />
        <FamilyRooms />
      </ProgressContext>
    </Canvas>
  );
}
