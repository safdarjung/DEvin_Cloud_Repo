// Browser entry for scripts/tour/render-fallbacks.mjs (bundled with esbuild, never imported by the app).
// It shows one exact frame of the same Remotion composition the player uses, driven by a GSAP timeline
// that hyperframes seeks, so the MP4 fallbacks cannot drift from the live explainer.
import { Thumbnail } from "@remotion/player";
import { gsap } from "gsap";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { TOUR_ROLES } from "../roles";
import { RoleExplainer } from "./RoleExplainer";
import { EXPLAINER_FPS, EXPLAINER_HEIGHT, EXPLAINER_WIDTH, explainerTimeline } from "./timeline";

const host = document.getElementById("explainer");
const role = TOUR_ROLES.find((r) => r.key === host?.dataset.role);
if (!host || !role) throw new Error("fallback-entry: #explainer[data-role] must name a tour role");

const frames = explainerTimeline(role.features.length).durationInFrames;
const root = createRoot(host);
const show = (frame: number) =>
  flushSync(() =>
    root.render(
      <Thumbnail
        component={RoleExplainer}
        inputProps={{ role }}
        frameToDisplay={Math.min(frames - 1, Math.max(0, Math.round(frame)))}
        durationInFrames={frames}
        fps={EXPLAINER_FPS}
        compositionWidth={EXPLAINER_WIDTH}
        compositionHeight={EXPLAINER_HEIGHT}
        style={{ width: EXPLAINER_WIDTH, height: EXPLAINER_HEIGHT }}
      />,
    ),
  );

const clock = { frame: 0 };
const tl = gsap.timeline({ paused: true });
tl.to(clock, { frame: frames, duration: frames / EXPLAINER_FPS, ease: "none", onUpdate: () => show(clock.frame) });
show(0);

const w = window as unknown as { __timelines?: Record<string, gsap.core.Timeline>; __showFrame?: (f: number) => void };
w.__timelines = { ...w.__timelines, root: tl };
w.__showFrame = show;
