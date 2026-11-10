"use client";

import { Player, type PlayerRef } from "@remotion/player";
import { RotateCcw } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const [isEnded, setIsEnded] = useState(false);
  const data = TOUR_ROLES.find((r) => r.key === role);
  const onEndedRef = useRef(onEnded);
  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  useEffect(() => {
    wrapRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const player = ref.current;
    if (!player) return;
    const handleEnded = () => {
      setIsEnded(true);
      onEndedRef.current?.();
    };
    const handleResume = () => setIsEnded(false);
    player.addEventListener("ended", handleEnded);
    player.addEventListener("play", handleResume);
    player.addEventListener("seeked", handleResume);
    return () => {
      player.removeEventListener("ended", handleEnded);
      player.removeEventListener("play", handleResume);
      player.removeEventListener("seeked", handleResume);
    };
  }, [role]);

  if (!data) return null;

  const replay = () => {
    ref.current?.seekTo(0);
    ref.current?.play();
  };
  // Space is handled here (not by the Player) so it works as soon as the dialog opens, before any click.
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== " " || e.target !== e.currentTarget) return;
    e.preventDefault();
    if (isEnded) replay();
    else ref.current?.toggle();
  };

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      role="group"
      aria-label={`${data.label} feature explainer. Press space to play or pause.`}
      onKeyDown={handleKeyDown}
      style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", overflow: "hidden", outlineOffset: -3 }}
    >
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
        spaceKeyToPlayOrPause={false}
        showVolumeControls={false}
        acknowledgeRemotionLicense
        style={{ width: "100%", height: "100%" }}
      />
      {isEnded && (
        <button
          type="button"
          onClick={replay}
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 14px",
            borderRadius: 999,
            border: "3px solid #1F2937",
            boxShadow: "0 4px 0 #1F2937",
            background: "#fff",
            color: "#1F2937",
            fontWeight: 800,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          <RotateCcw size={16} aria-hidden /> Replay
        </button>
      )}
    </div>
  );
}
