"use client";

import { useEffect, useRef } from "react";

// Hero sky: static procedural starfield + static planetary rim (canvas), plus
// the planet-glow video on desktop only. Nothing in the sky animates except
// that video; the canvas fallback stays static.
const VIDEO_SRC = "https://d2ol7oe51mr4n9.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/e859f229-8ebd-43fb-a5a0-58006ba75327.mp4";
const DESKTOP_VIDEO = "(min-width: 900px) and (orientation: landscape) and (prefers-reduced-motion: no-preference)";
const CROSSFADE_S = 1;

function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

function fit(canvas: HTMLCanvasElement) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const { width, height } = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  const ctx = canvas.getContext("2d");
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

function drawStars(canvas: HTMLCanvasElement) {
  const { ctx, width, height } = fit(canvas);
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  const r = rng(7);
  const count = Math.round((width * height) / 2600);
  for (let i = 0; i < count; i++) {
    const depth = r();
    const size = depth > 0.97 ? 1.5 : depth > 0.85 ? 1 : 0.6;
    ctx.globalAlpha = 0.15 + depth * 0.75;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(r() * width, r() * height, size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Polar colour table: hue/brightness by angle from the rim's apex.
const POLAR: [number, string][] = [
  [0, "255,214,255"],
  [0.12, "214,120,255"],
  [0.3, "160,32,255"],
  [0.55, "122,28,248"],
  [1, "40,6,90"],
];

function polar(t: number) {
  for (let i = 1; i < POLAR.length; i++) if (t <= POLAR[i][0]) return POLAR[i - 1][1];
  return POLAR[POLAR.length - 1][1];
}

function drawRim(canvas: HTMLCanvasElement) {
  const { ctx, width: w, height: h } = fit(canvas);
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  // Planet: a huge circle whose top edge crests near 62% of the plate height.
  const R = Math.max(w * 1.15, h * 2);
  const cx = w / 2;
  const cy = h * 0.62 + R;
  ctx.globalCompositeOperation = "lighter";
  const steps = 90;
  for (let i = 0; i < steps; i++) {
    const a0 = -Math.PI / 2 - 0.9 + (i / steps) * 1.8;
    const a1 = a0 + 1.8 / steps + 0.004;
    const t = Math.abs(i / steps - 0.5) * 2;
    const rgb = polar(t);
    for (const [spread, alpha] of [
      [60, 0.05],
      [26, 0.1],
      [9, 0.32],
      [2.5, 0.9],
    ] as const) {
      ctx.strokeStyle = `rgba(${rgb},${alpha * (1 - t * 0.65)})`;
      ctx.lineWidth = spread;
      ctx.beginPath();
      ctx.arc(cx, cy, R, a0, a1);
      ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = "source-over";
  // Planet body occludes stars beneath the rim.
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.arc(cx, cy, R - 1.5, 0, Math.PI * 2);
  ctx.fill();
  // Inner atmospheric haze just under the rim.
  const g = ctx.createLinearGradient(0, h * 0.62, 0, h * 0.62 + 140);
  g.addColorStop(0, "rgba(147,18,255,.22)");
  g.addColorStop(1, "rgba(147,18,255,0)");
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R - 1.5, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = g;
  ctx.fillRect(0, h * 0.62, w, 140);
  ctx.restore();
}

export function Starfield({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    drawStars(c);
    const ro = new ResizeObserver(() => drawStars(c));
    ro.observe(c);
    return () => ro.disconnect();
  }, []);
  return <canvas ref={ref} className={className} aria-hidden />;
}

export function PlanetRim({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    drawRim(c);
    const ro = new ResizeObserver(() => drawRim(c));
    ro.observe(c);
    return () => ro.disconnect();
  }, []);
  return <canvas ref={ref} className={className} aria-hidden />;
}

/** Two stacked copies of the loop: the last second of one crossfades into the
 *  first second of the other, so the seam never shows and nothing reverses. */
export function PlanetVideo({ className }: { className?: string }) {
  const a = useRef<HTMLVideoElement>(null);
  const b = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const va = a.current;
    const vb = b.current;
    if (!va || !vb || !window.matchMedia(DESKTOP_VIDEO).matches) return;
    let front = va;
    let back = vb;
    let fading = false;
    const show = () => va.parentElement?.setAttribute("data-ready", "");
    const onTime = () => {
      if (fading || !front.duration) return;
      if (front.currentTime >= front.duration - CROSSFADE_S) {
        fading = true;
        back.currentTime = 0;
        void back.play().catch(() => {});
        back.style.opacity = "1";
        front.style.opacity = "0";
        window.setTimeout(() => {
          front.pause();
          [front, back] = [back, front];
          fading = false;
        }, CROSSFADE_S * 1000);
      }
    };
    for (const v of [va, vb]) {
      v.addEventListener("timeupdate", onTime);
      v.src = VIDEO_SRC;
      v.load();
    }
    va.addEventListener("canplay", show, { once: true });
    va.style.opacity = "1";
    void va.play().catch(() => {});
    return () => {
      for (const v of [va, vb]) {
        v.removeEventListener("timeupdate", onTime);
        v.pause();
        v.removeAttribute("src");
        v.load();
      }
    };
  }, []);
  return (
    <div className={className} aria-hidden>
      <video ref={a} muted playsInline preload="none" />
      <video ref={b} muted playsInline preload="none" />
    </div>
  );
}
