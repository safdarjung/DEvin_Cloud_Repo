"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VideoId } from "./content";
import { VIDEOS } from "./videos";

// Only one looping clip plays at a time: starting one pauses the previous.
let activeLoop: HTMLVideoElement | null = null;

const BTN =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-[var(--fos-line-strong)] bg-[color-mix(in_oklab,var(--fos-bg)_82%,transparent)] text-[var(--fos-fg)] backdrop-blur transition-colors hover:bg-[var(--fos-elev)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fos-cyan)]";

function PlayIcon({ size = 18 }: { size?: number }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l11-6.86a1 1 0 0 0 0-1.7l-11-6.86A1 1 0 0 0 8 5.14Z" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg aria-hidden width={18} height={18} viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

function Sources({ mp4, webm }: { mp4?: string; webm?: string }) {
  // Safari prefers H.264, so mp4 goes first when both exist.
  return (
    <>
      {mp4 ? <source src={mp4} type="video/mp4" /> : null}
      {webm ? <source src={webm} type="video/webm" /> : null}
    </>
  );
}

export function ProductVideo({ id, variant, className }: { id: VideoId; variant: "loop" | "showcase"; className?: string }) {
  const v = VIDEOS[id];
  if (!v || (!v.webm && !v.mp4)) return null;
  return variant === "loop" ? <LoopVideo id={id} className={className} /> : <ShowcaseVideo id={id} className={className} />;
}

function Frame({ title, ratio, caption, children, className }: { title: string; ratio: string; caption: string; children: React.ReactNode; className?: string }) {
  return (
    <figure className={`m-0 ${className ?? ""}`}>
      <div className="overflow-hidden rounded-[var(--fos-radius)] border border-[var(--fos-line)] bg-[var(--fos-elev)] shadow-[0_30px_80px_-30px_rgb(0_0_0/0.8)]">
        <div aria-hidden className="flex h-9 items-center gap-1.5 border-b border-[var(--fos-line)] px-3.5">
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="mx-auto truncate pr-10 text-[11px] tracking-wide text-[var(--fos-faint)]">{title}</span>
        </div>
        <div className="relative w-full bg-[var(--fos-bg-2)]" style={{ aspectRatio: ratio }}>
          {children}
        </div>
      </div>
      <figcaption className="mt-3 text-[13px] leading-snug text-[var(--fos-muted)]">{caption}</figcaption>
    </figure>
  );
}

function LoopVideo({ id, className }: { id: VideoId; className?: string }) {
  const v = VIDEOS[id];
  const ref = useRef<HTMLVideoElement>(null);
  const userPaused = useRef(false);
  const reduced = useRef(false);
  const visible = useRef(false);
  const [playing, setPlaying] = useState(false);

  const tryPlay = useCallback(() => {
    const el = ref.current;
    if (!el || reduced.current || userPaused.current || !visible.current) return;
    if (activeLoop && activeLoop !== el) activeLoop.pause();
    activeLoop = el;
    el.play().catch(() => {});
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduced.current = mq.matches;
    const onMq = () => {
      reduced.current = mq.matches;
      if (mq.matches) el.pause();
    };
    mq.addEventListener("change", onMq);
    const io = new IntersectionObserver(
      ([entry]) => {
        visible.current = entry.isIntersecting && entry.intersectionRatio >= 0.5;
        if (visible.current) tryPlay();
        else el.pause();
      },
      { threshold: [0, 0.5, 1] },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      mq.removeEventListener("change", onMq);
      el.pause();
      if (activeLoop === el) activeLoop = null;
    };
  }, [tryPlay]);

  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) {
      userPaused.current = false;
      reduced.current = false; // explicit user intent overrides the reduced-motion default
      if (activeLoop && activeLoop !== el) activeLoop.pause();
      activeLoop = el;
      el.play().catch(() => {});
    } else {
      userPaused.current = true;
      el.pause();
    }
  };

  return (
    <Frame title={v.title} ratio={`${v.width} / ${v.height}`} caption={v.description} className={className}>
      <video
        ref={ref}
        className="absolute inset-0 size-full object-cover"
        muted
        loop
        playsInline
        preload="none"
        poster={v.poster}
        aria-label={`${v.title}. ${v.description}`}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      >
        <Sources mp4={v.mp4} webm={v.webm} />
      </video>
      <button type="button" onClick={toggle} aria-pressed={playing} className={`${BTN} absolute right-3 bottom-3`}>
        {playing ? <PauseIcon /> : <PlayIcon />}
        <span className="sr-only">{playing ? `Pause ${v.title} video` : `Play ${v.title} video`}</span>
      </button>
    </Frame>
  );
}

function ShowcaseVideo({ id, className }: { id: VideoId; className?: string }) {
  const v = VIDEOS[id];
  const ref = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!started) return;
    const el = ref.current;
    el?.play().catch(() => {});
    el?.focus({ preventScroll: true });
  }, [started]);

  return (
    <Frame title={v.title} ratio={`${v.width} / ${v.height}`} caption={v.description} className={className}>
      {started ? (
        <video ref={ref} className="absolute inset-0 size-full bg-black object-contain" controls playsInline preload="auto" poster={v.poster} aria-label={v.title}>
          <Sources mp4={v.mp4} webm={v.webm} />
          {v.captions ? <track kind="captions" src={v.captions} srcLang="en" label="English" default /> : null}
        </video>
      ) : (
        <>
          {v.poster ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={v.poster} alt="" width={v.width} height={v.height} loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover" />
          ) : null}
          <button
            type="button"
            onClick={() => setStarted(true)}
            className="group absolute inset-0 flex items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-[var(--fos-cyan)]"
          >
            <span className="inline-flex size-20 items-center justify-center rounded-full bg-[var(--fos-fg)] text-[var(--fos-accent-fg)] shadow-[0_10px_40px_rgb(0_0_0/0.5)] transition-transform duration-300 group-hover:scale-105">
              <PlayIcon size={30} />
            </span>
            <span className="sr-only">
              Play video: {v.title}
              {v.durationSec ? `, ${Math.round(v.durationSec)} seconds` : ""}
            </span>
          </button>
        </>
      )}
    </Frame>
  );
}
