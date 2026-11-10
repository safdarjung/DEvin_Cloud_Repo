"use client";

import { Canvas } from "@react-three/fiber";
import { useEffect, useMemo, type RefObject } from "react";
import * as THREE from "three";
import { FINALE_Z, GATE_Z, ROOM_ORDER } from "../path";
import { TOUR_ROLES } from "../roles";
import { Atmosphere } from "./Atmosphere";
import { Building } from "./exterior/Building";
import { CameraRig, Ticker } from "./CameraRig";
import { CorridorWalkers } from "./characters/Crowd";
import { Birds, Butterflies, DustMotes, PaperPlane } from "./exterior/Critters";
import { Exterior } from "./exterior/Grounds";
import { Finale } from "./exterior/Finale";
import { Interior } from "./interior/Corridor";
import { CORRIDOR_FROM, FRONT_UNTIL, GARDEN_FROM, roomZone } from "./interior/Rooms";
import { LiteContext, ProgressContext, Zone, pickTier } from "./kit";
import { disposeTextures } from "./materials/textures";
import { Classroom } from "./interior/rooms/Classroom";
import { FrontOffice } from "./interior/rooms/FrontOffice";
import { Library } from "./interior/rooms/Library";
import { ParentLounge } from "./interior/rooms/Lounge";
import { PrincipalOffice } from "./interior/rooms/Principal";

const ACCENTS = TOUR_ROLES.map((r) => r.accent);
const ROOM_SCENES = { principal: PrincipalOffice, admin: FrontOffice, teacher: Classroom, student: Library, parent: ParentLounge } as const;

interface Props {
  progress: RefObject<number>;
  /** Phones/tablets in portrait: lower resolution; always the low quality tier. */
  lite?: boolean;
  onReady?: () => void;
}

/** The whole school in one canvas: PBR materials under ACES tone mapping. `low` tier drops shadow maps and extras. */
export default function TourCanvas({ progress, lite = false, onReady }: Props) {
  const low = useMemo(() => pickTier(lite) === "low", [lite]);
  useEffect(() => disposeTextures, []);
  return (
    <Canvas
      frameloop="demand"
      dpr={lite ? [1, 1.25] : [1, 1.75]}
      shadows={low ? false : "percentage"}
      camera={{ fov: 50, near: 0.1, far: 160, position: [0, 3, 21] }}
      gl={{ antialias: !lite, powerPreference: "high-performance", toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
    >
      <ProgressContext value={progress}>
        <LiteContext value={low}>
          <Atmosphere />
          <CameraRig />
          <Ticker onReady={onReady} />
          <Zone min={FRONT_UNTIL}>
            <Exterior accents={ACCENTS} />
            <Building />
          </Zone>
          <Interior />
          {ROOM_ORDER.map((key) => {
            const Room = ROOM_SCENES[key];
            return (
              <Zone key={key} {...roomZone(key)}>
                <Room />
              </Zone>
            );
          })}
          <Zone max={GARDEN_FROM}>
            <Finale />
          </Zone>
          {!low && (
            <>
              <Butterflies around={[[-5, 1.6, GATE_Z - 3], [5.5, 2, GATE_Z - 5], [-3, 1.5, FINALE_Z + 2], [3.5, 1.8, FINALE_Z + 1]]} />
              <Birds y={15} z={-30} speed={1.4} />
              <Birds y={18} z={-70} speed={1} phase={40} />
              <PaperPlane centre={[0, 2.7, -20]} radius={[1.2, 14]} speed={0.22} />
              <DustMotes />
              <Zone max={CORRIDOR_FROM}>
                <CorridorWalkers />
              </Zone>
            </>
          )}
        </LiteContext>
      </ProgressContext>
    </Canvas>
  );
}
