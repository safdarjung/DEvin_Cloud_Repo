"use client";

import { Canvas } from "@react-three/fiber";
import type { RefObject } from "react";
import { FINALE_Z, GATE_Z } from "../path";
import { TOUR_ROLES } from "../roles";
import { Atmosphere } from "./Atmosphere";
import { Building } from "./Building";
import { CameraRig, Ticker } from "./CameraRig";
import { Birds, Butterflies, DustMotes, PaperPlane } from "./Critters";
import { Exterior } from "./Exterior";
import { Finale } from "./Finale";
import { Interior } from "./Interior";
import { LiteContext, ProgressContext } from "./kit";
import { Classroom } from "./rooms/Classroom";
import { FrontOffice } from "./rooms/FrontOffice";
import { Library } from "./rooms/Library";
import { ParentLounge } from "./rooms/Lounge";
import { PrincipalOffice } from "./rooms/Principal";

const ACCENTS = TOUR_ROLES.map((r) => r.accent);

interface Props {
  progress: RefObject<number>;
  /** Phones/tablets in portrait: lower resolution, no shadow maps, no critters. */
  lite?: boolean;
  onReady?: () => void;
}

/** The whole school in one canvas. `flat` = no tone mapping, so toon colours stay exactly as picked. */
export default function TourCanvas({ progress, lite = false, onReady }: Props) {
  return (
    <Canvas
      frameloop="demand"
      dpr={lite ? [1, 1.25] : [1, 1.75]}
      shadows={lite ? false : "percentage"}
      flat
      camera={{ fov: 50, near: 0.1, far: 160, position: [0, 3, 21] }}
      gl={{ antialias: !lite, powerPreference: "high-performance" }}
    >
      <ProgressContext value={progress}>
        <LiteContext value={lite}>
          <Atmosphere />
          <CameraRig />
          <Ticker onReady={onReady} />
          <Exterior accents={ACCENTS} />
          <Building />
          <Interior />
          <PrincipalOffice />
          <FrontOffice />
          <Classroom />
          <Library />
          <ParentLounge />
          <Finale />
          {!lite && (
            <>
              <Butterflies around={[[-5, 1.6, GATE_Z - 3], [5.5, 2, GATE_Z - 5], [-3, 1.5, FINALE_Z + 2], [3.5, 1.8, FINALE_Z + 1]]} />
              <Birds y={15} z={-30} speed={1.4} />
              <Birds y={18} z={-70} speed={1} phase={40} />
              <PaperPlane centre={[0, 2.7, -20]} radius={[1.2, 14]} speed={0.22} />
              <DustMotes />
            </>
          )}
        </LiteContext>
      </ProgressContext>
    </Canvas>
  );
}
