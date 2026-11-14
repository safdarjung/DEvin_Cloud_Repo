"use client";

import dynamic from "next/dynamic";
import type { Story } from "../story";

export interface StoryPlayerProps {
  story: Story;
  /** Parent asks to jump: seek to the first frame of beat `step` (0-based) and play. A new `nonce` forces the seek even for the same step. null = no request. */
  seek: { step: number; nonce: number } | null;
  /** Fired when playback enters beat i (0-based). Not fired for the title or end card. */
  onStep?: (index: number) => void;
  onEnded?: () => void;
  autoPlay?: boolean; // default false
}

// Loaded on demand so remotion stays out of the first bundle.
const Inner = dynamic(() => import("./StoryPlayerInner"), {
  ssr: false,
  loading: () => <div style={{ aspectRatio: "16 / 9", width: "100%" }} aria-busy="true" />,
});

export default function StoryPlayer(props: StoryPlayerProps) {
  return <Inner {...props} />;
}
