// Browser entry for scripts/film/render.mjs (bundled with esbuild, never imported by the app).
// It shows one exact frame of the same Remotion composition the player uses, driven by a GSAP timeline
// that hyperframes seeks, so public/film/fabric.mp4 cannot drift from the live film.
import { Thumbnail } from "@remotion/player";
import { gsap } from "gsap";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { FabricFilm } from "./FabricFilm";
import { FILM, FILM_FPS, FILM_HEIGHT, FILM_WIDTH } from "./film-timeline";

const host = document.getElementById("film");
if (!host) throw new Error("film-entry: the page needs a #film element");

const frames = FILM.durationInFrames;
const root = createRoot(host);
const show = (frame: number) =>
  flushSync(() =>
    root.render(
      <Thumbnail
        component={FabricFilm}
        frameToDisplay={Math.min(frames - 1, Math.max(0, Math.round(frame)))}
        durationInFrames={frames}
        fps={FILM_FPS}
        compositionWidth={FILM_WIDTH}
        compositionHeight={FILM_HEIGHT}
        style={{ width: FILM_WIDTH, height: FILM_HEIGHT }}
      />,
    ),
  );

const clock = { frame: 0 };
const tl = gsap.timeline({ paused: true });
tl.to(clock, { frame: frames, duration: frames / FILM_FPS, ease: "none", onUpdate: () => show(clock.frame) });
show(0);
// The render page inlines the brand font (scripts/film/render.mjs): have it decoded before the first text
// frame is captured, then repaint. Without the font the page keeps the system fallback.
void Promise.all([400, 700, 800].map((w) => document.fonts.load(`${w} 32px "Plus Jakarta Sans"`)))
  .then(() => show(clock.frame))
  .catch(() => undefined);

const w = window as unknown as { __timelines?: Record<string, gsap.core.Timeline>; __showFrame?: (f: number) => void };
w.__timelines = { ...w.__timelines, root: tl };
w.__showFrame = show;
