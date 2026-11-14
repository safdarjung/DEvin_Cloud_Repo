"use client";

import { Play, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { createPortal } from "react-dom";

const FilmPlayer = dynamic(() => import("./film/FilmPlayer"), {
  ssr: false,
  loading: () => <p className="lh-wait">Loading the film…</p>,
});

/**
 * "Watch the film": opens the 90-second product film in a modal. The player loads only when asked for.
 * The dialog is portalled to <body>: the hero it is opened from turns `inert` once the page scrolls on,
 * and an inert ancestor would disable an open dialog inside it.
 */
export function FilmButton({ kind, label = "Watch the 90-second film" }: { kind?: "paper" | "ink"; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="lm-btn" data-kind={kind} onClick={() => setOpen(true)}>
        <Play aria-hidden className="size-4" fill="currentColor" />
        {label}
      </button>
      {open &&
        createPortal(
          <dialog
            ref={(node) => {
              if (node && !node.open) node.showModal();
            }}
            className="lh-dialog"
            aria-label="Fabric in 90 seconds"
            data-lenis-prevent
            onClose={() => setOpen(false)}
          >
            <div className="lh-dialog-frame">
              <FilmPlayer autoPlay />
            </div>
            <p className="lh-dialog-note">Silent film with on-screen text. Space plays and pauses.</p>
            <form method="dialog">
              <button type="submit" className="lh-dialog-close" aria-label="Close the film">
                <X aria-hidden className="size-5" />
              </button>
            </form>
          </dialog>,
          document.body,
        )}
    </>
  );
}
