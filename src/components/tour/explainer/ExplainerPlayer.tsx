"use client";

import dynamic from "next/dynamic";
import type { TourRoleKey } from "../roles";

// Loaded on demand so remotion stays out of the first bundle.
const Inner = dynamic(() => import("./ExplainerPlayerInner"), {
  ssr: false,
  loading: () => <div style={{ aspectRatio: "16 / 9", width: "100%" }} aria-busy="true" />,
});

export default function ExplainerPlayer(props: { role: TourRoleKey; onEnded?: () => void }) {
  return <Inner {...props} />;
}
