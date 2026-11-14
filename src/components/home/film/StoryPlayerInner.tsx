"use client";

import { Player, type PlayerRef } from "@remotion/player";
import { RotateCcw } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { EXPLAINER_FPS, EXPLAINER_HEIGHT, EXPLAINER_WIDTH, BEAT_FRAMES, TITLE_FRAMES } from "../../tour/explainer/timeline";
import type { StoryPlayerProps } from "./StoryPlayer";
import { StoryExplainer, storyTimeline } from "./StoryExplainer";

/** Beat index for a frame, or -1 on the title and end cards. */
function beatAt(frame: number, count: number): number {
  const i = Math.floor((frame - TITLE_FRAMES) / BEAT_FRAMES);
  return frame >= TITLE_FRAMES && i < count ? i : -1;
}

export default function StoryPlayerInner({ story, seek, onStep, onEnded, autoPlay = false }: StoryPlayerProps) {
  const ref = useRef<PlayerRef>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Keyed by story so a story change never inherits the previous film's ended state.
  const [endedFor, setEndedFor] = useState<string | null>(null);
  const isEnded = endedFor === story.key;
  const lastStep = useRef(-1);
  const cb = useRef({ onStep, onEnded });
  useEffect(() => {
    cb.current = { onStep, onEnded };
  }, [onStep, onEnded]);

  const count = story.steps.length;
  const timeline = storyTimeline(story);

  useEffect(() => {
    lastStep.current = -1;
    const player = ref.current;
    if (!player) return;
    const handleEnded = () => {
      setEndedFor(story.key);
      cb.current.onEnded?.();
    };
    const handleResume = () => setEndedFor(null);
    const handleFrame = (e: { detail: { frame: number } }) => {
      const i = beatAt(e.detail.frame, count);
      if (i === lastStep.current) return;
      lastStep.current = i;
      if (i >= 0) cb.current.onStep?.(i);
    };
    player.addEventListener("ended", handleEnded);
    player.addEventListener("play", handleResume);
    player.addEventListener("seeked", handleResume);
    player.addEventListener("frameupdate", handleFrame);
    return () => {
      player.removeEventListener("ended", handleEnded);
      player.removeEventListener("play", handleResume);
      player.removeEventListener("seeked", handleResume);
      player.removeEventListener("frameupdate", handleFrame);
    };
  }, [story.key, count]);

  const nonce = seek?.nonce;
  const step = seek?.step;
  useEffect(() => {
    if (nonce === undefined || step === undefined) return;
    const beat = timeline.beats[Math.min(Math.max(step, 0), count - 1)];
    ref.current?.seekTo(beat.from);
    ref.current?.play();
    // timeline and count are derived from story; a story change resets to frame 0 via the Player key, so only a new request seeks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, step]);

  const replay = () => {
    ref.current?.seekTo(0);
    ref.current?.play();
  };
  // Space is handled here (not by the Player) so it works before any click inside the frame.
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
      aria-label={`${story.title}: ${story.question} Press space to play or pause.`}
      onKeyDown={handleKeyDown}
      style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", overflow: "hidden", outlineOffset: -3 }}
    >
      <Player
        ref={ref}
        key={story.key}
        component={StoryExplainer}
        inputProps={{ story }}
        durationInFrames={timeline.durationInFrames}
        fps={EXPLAINER_FPS}
        compositionWidth={EXPLAINER_WIDTH}
        compositionHeight={EXPLAINER_HEIGHT}
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
