"use client";

import { Player, type PlayerRef } from "@remotion/player";
import { RotateCcw } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { FabricFilm } from "./FabricFilm";
import { FILM, FILM_FPS, FILM_HEIGHT, FILM_WIDTH } from "./film-timeline";

export default function FilmPlayerInner({ autoPlay = false, onEnded }: { autoPlay?: boolean; onEnded?: () => void }) {
  const ref = useRef<PlayerRef>(null);
  const [isEnded, setIsEnded] = useState(false);
  const onEndedRef = useRef(onEnded);
  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

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
  }, []);

  const replay = () => {
    ref.current?.seekTo(0);
    ref.current?.play();
  };
  // Space is handled on the wrapper (not by the Player) so it works when the wrapper itself has focus.
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== " " || e.target !== e.currentTarget) return;
    e.preventDefault();
    if (isEnded) replay();
    else ref.current?.toggle();
  };

  return (
    <div
      tabIndex={0}
      role="group"
      aria-label="Fabric in 90 seconds, a silent product film. Press space to play or pause."
      onKeyDown={handleKeyDown}
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", outlineOffset: -3 }}
    >
      <Player
        ref={ref}
        component={FabricFilm}
        durationInFrames={FILM.durationInFrames}
        fps={FILM_FPS}
        compositionWidth={FILM_WIDTH}
        compositionHeight={FILM_HEIGHT}
        controls
        autoPlay={autoPlay}
        moveToBeginningWhenEnded={false}
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
