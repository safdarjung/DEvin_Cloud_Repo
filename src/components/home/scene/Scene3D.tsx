"use client";

import { Play, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { PROBLEMS, THREAD } from "../story";
import { HubBoard, PaperFace, ProductFace } from "./faces";
import { HUB_CINEMA, entryPose, hubPose, mix, panelState, weaveProgress, type Pose } from "./pose";

/**
 * The board and the cards are laid out at twice the size they are shown (home-scene.css, `--d`) and scaled
 * down here. The browser rasters a moving layer once, at its own size: drawn large, the text stays sharp
 * when a card comes to the front.
 */
const OVERSIZE = 2;
const css = (pose: Pose, u: number) =>
  `translate3d(${(pose.x * u).toFixed(1)}px, ${(pose.y * u).toFixed(1)}px, ${(pose.z * u).toFixed(1)}px) rotateX(${pose.rx.toFixed(2)}deg) rotateY(${pose.ry.toFixed(2)}deg) rotateZ(${pose.rz.toFixed(2)}deg) scale(${(pose.s / OVERSIZE).toFixed(4)})`;
/** Seconds a card takes to arrive when the page opens, and the gap between one card and the next. */
const ENTRY_S = 1.1;
const ENTRY_GAP_S = 0.09;
const easeOutBack = (x: number) => 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2;

export interface Scene3DProps {
  progress: RefObject<number>;
  /** Card on screen in the copy column: -1 hero, 0..6 a problem, 7 the finale. */
  current: number;
  /** Phone-sized or tall window: the scene sits above the copy instead of beside it. */
  lite: boolean;
  /** False while the film is scrolled off screen: the frame loop stops. */
  active: boolean;
  /** A card was clicked that is not the one being read: go to its part of the story. */
  onPick: (index: number) => void;
  onReady: () => void;
}

/**
 * The opening scene of the landing page, drawn with CSS 3D so every screen in it is real, sharp text:
 * a product board and seven cards. Scroll drives it (pose.ts); the pointer tilts it; a card can be clicked
 * to go to its part of the story, or flipped by hand while it is at the front; the board can play the
 * product film inside itself. It is decoration for the copy beside it, so it is hidden from assistive
 * technology and nothing in it takes keyboard focus: the same actions exist as real controls in the page.
 */
export default function Scene3D({ progress, current, lite, active, onPick, onReady }: Scene3DProps) {
  const root = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const hub = useRef<HTMLDivElement>(null);
  const shadow = useRef<HTMLDivElement>(null);
  const panels = useRef<(HTMLDivElement | null)[]>([]);
  const video = useRef<HTMLVideoElement>(null);
  /** Cards the reader has turned over by hand (a toggle on top of what the scroll does). */
  const turned = useRef(new Set<number>());
  const unit = useRef(600);
  /** The film plays only on the card it was started on: scrolling to another one stops it. */
  const [playAt, setPlayAt] = useState<number | null>(null);
  const playing = playAt !== null && playAt === current;
  const live = useRef({ playing, current, onReady });
  useEffect(() => {
    live.current = { playing, current, onReady };
  }, [playing, current, onReady]);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (playing) void v.play().catch(() => setPlayAt(null));
    else v.pause();
  }, [playing]);

  // The scene unit and the point the world hangs from follow the stage size.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => {
      const { clientWidth: w, clientHeight: h } = el;
      const u = lite ? Math.min(w * 0.8, h * 0.3) : Math.min(w * 0.44, h * 0.82);
      unit.current = u;
      el.style.setProperty("--u", `${u.toFixed(1)}px`);
      el.style.setProperty("--ox", `${(lite ? w * 0.5 : w * 0.725).toFixed(1)}px`);
      el.style.setProperty("--oy", `${(lite ? h * 0.22 : h * 0.47).toFixed(1)}px`);
    };
    measure();
    const seen = new ResizeObserver(measure);
    seen.observe(el);
    return () => seen.disconnect();
  }, [lite]);

  useEffect(() => {
    if (!active) return;
    const pointer = { x: 0, y: 0 };
    const tilt = { x: 0, y: 0 };
    const extra = PROBLEMS.map(() => 0);
    const side = PROBLEMS.map(() => "");
    let cinema = 0;
    let raf = 0;
    let first = true;
    let born = 0;
    const onMove = (e: PointerEvent) => {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const p = progress.current;
      const t = now / 1000;
      const u = unit.current;
      if (first) born = t;
      tilt.x += (pointer.x - tilt.x) * 0.06;
      tilt.y += (pointer.y - tilt.y) * 0.06;
      cinema += ((live.current.playing ? 1 : 0) - cinema) * 0.09;
      if (world.current) world.current.style.transform = `rotateX(${(-tilt.y * 5 * (1 - cinema)).toFixed(2)}deg) rotateY(${(tilt.x * 7 * (1 - cinema)).toFixed(2)}deg)`;

      const hubNow = mix(hubPose(p, t), HUB_CINEMA, cinema);
      if (hub.current) {
        hub.current.style.transform = css(hubNow, u);
        hub.current.style.setProperty("--weave", weaveProgress(p).toFixed(3));
      }
      if (shadow.current) shadow.current.style.transform = `translate3d(${(hubNow.x * u).toFixed(1)}px, ${((hubNow.y + 0.44) * u).toFixed(1)}px, ${((hubNow.z - 0.12) * u).toFixed(1)}px) rotateX(82deg) scale(${hubNow.s.toFixed(3)})`;

      for (let i = 0; i < PROBLEMS.length; i++) {
        const el = panels.current[i];
        if (!el) continue;
        const state = panelState(i, p, t, hubNow);
        extra[i] += ((turned.current.has(i) ? 1 : 0) - extra[i]) * 0.14;
        const turn = state.flip + extra[i];
        const arrived = Math.min(1, Math.max(0, (t - born - i * ENTRY_GAP_S) / ENTRY_S));
        const pose = arrived < 1 ? mix(entryPose(i), state.pose, easeOutBack(arrived)) : state.pose;
        el.style.transform = `${css(pose, u)} rotateY(${(turn * 180).toFixed(1)}deg)`;
        if (arrived < 1) el.style.opacity = Math.min(1, arrived * 3).toFixed(2);
        else if (el.style.opacity) el.style.opacity = "";
        el.style.setProperty("--detail", state.detail.toFixed(3));
        el.style.setProperty("--dim", cinema.toFixed(3));
        const facing = Math.round(turn) % 2 === 1 ? "product" : "paper";
        if (side[i] !== facing) {
          side[i] = facing;
          el.dataset.side = facing;
        }
      }
      if (first) {
        first = false;
        live.current.onReady();
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
    };
  }, [active, progress]);

  const pick = (i: number) => {
    if (live.current.current !== i) return onPick(i);
    // The card being read: turn it over by hand, to compare today with Fabric.
    if (!turned.current.delete(i)) turned.current.add(i);
  };
  const canPlay = current === -1 || current === PROBLEMS.length;

  return (
    <div ref={root} className="s3" data-lite={lite || undefined} data-playing={playing || undefined}>
      <div ref={world} className="s3-world">
        <div ref={shadow} className="s3-shadow" />
        <div ref={hub} className="s3-hub">
          <HubBoard />
          {/* Loaded only when asked for: the film is 5 MB. */}
          <video ref={video} className="s3-video" src="/film/fabric.mp4" poster="/film/fabric-poster.jpg" preload="none" playsInline controls={playing} tabIndex={-1} onEnded={() => setPlayAt(null)} />
          {playing ? (
            <button type="button" tabIndex={-1} className="s3-chip s3-close" onClick={() => setPlayAt(null)}>
              <X /> Close
            </button>
          ) : (
            canPlay && (
              <button type="button" tabIndex={-1} className="s3-chip s3-play" onClick={() => setPlayAt(current)}>
                <Play /> Play the film here
              </button>
            )
          )}
        </div>
        {PROBLEMS.map((p, i) => (
          <div
            key={p.thread}
            ref={(node) => {
              panels.current[i] = node;
            }}
            className="s3-panel"
            data-current={current === i || undefined}
            style={{ "--thread": THREAD[p.thread].color } as CSSProperties}
            onClick={() => pick(i)}
          >
            <span className="s3-lift">
              <PaperFace index={i} />
              <ProductFace index={i} />
            </span>
          </div>
        ))}
      </div>
      <p className="s3-note">Illustration with sample data</p>
    </div>
  );
}
