"use client";

import { Player, type PlayerRef } from "@remotion/player";
import { useEffect, useRef } from "react";
import { TOUR_ROLES, type TourRoleKey } from "../roles";
import { RoleExplainer } from "./RoleExplainer";
import {
  EXPLAINER_FPS,
  EXPLAINER_HEIGHT,
  EXPLAINER_WIDTH,
  explainerTimeline,
} from "./timeline";

export default function ExplainerPlayerInner({
  role,
  onEnded,
}: {
  role: TourRoleKey;
  onEnded?: () => void;
}) {
  const ref = useRef<PlayerRef>(null);
  const data = TOUR_ROLES.find((r) => r.key === role);
  const onEndedRef = useRef(onEnded);
  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  useEffect(() => {
    const player = ref.current;
    if (!player) return;
    const handle = () => onEndedRef.current?.();
    player.addEventListener("ended", handle);
    return () => player.removeEventListener("ended", handle);
  }, [role]);

  if (!data) return null;
  return (
    <Player
      ref={ref}
      key={role}
      component={RoleExplainer}
      inputProps={{ role: data }}
      durationInFrames={explainerTimeline(data.features.length).durationInFrames}
      fps={EXPLAINER_FPS}
      compositionWidth={EXPLAINER_WIDTH}
      compositionHeight={EXPLAINER_HEIGHT}
      controls
      autoPlay
      acknowledgeRemotionLicense
      style={{ width: "100%", aspectRatio: "16 / 9", borderRadius: 24, overflow: "hidden" }}
    />
  );
}
