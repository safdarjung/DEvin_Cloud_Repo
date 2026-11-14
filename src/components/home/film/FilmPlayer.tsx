"use client";

import dynamic from "next/dynamic";

// Loaded on demand so remotion stays out of the first bundle.
const Inner = dynamic(() => import("./FilmPlayerInner"), {
  ssr: false,
  loading: () => <div style={{ width: "100%", height: "100%" }} aria-busy="true" />,
});

export default function FilmPlayer(props: { autoPlay?: boolean; onEnded?: () => void }) {
  return <Inner {...props} />;
}
