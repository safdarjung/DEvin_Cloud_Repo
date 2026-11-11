"use client";

// Browser text-to-speech for AI answers (window.speechSynthesis). Nothing goes
// through our server. The browser picks where the voice runs: on-device voices
// (localService) stay on the device; "online" voices (e.g. Chrome's Google
// voices, Edge's Microsoft Online voices) send the text to the browser maker,
// so a local voice is preferred and `remoteVoice` lets the UI say so.
// Long answers are spoken in sentence chunks: Chrome stops a single utterance
// after about 15 seconds.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";

export type SpeechLang = "en-IN" | "hi-IN";

const PREF_KEY = "coolskool.voice.read-aloud";
const PREF_EVENT = "coolskool:read-aloud";
const MAX_CHUNK = 180;

/** Markdown to plain speakable text; every line ends with a pause. */
export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, "\n")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/g, "link")
    .split("\n")
    .map((l) =>
      l
        .replace(/^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/, "") // table rule
        .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/, "")
        .replace(/(\*\*|__|~~|\*|_)(?=\S)(.*?\S)\1/g, "$2")
        .replace(/\s*\|\s*/g, ", ")
        .replace(/^[,\s]+|[,\s]+$/g, ""),
    )
    .filter(Boolean)
    .map((l) => (/[.!?।:;]$/.test(l) ? l : `${l}.`))
    .join(" ");
}

/** Sentence-sized chunks of at most `max` characters (a longer sentence splits at spaces). */
export function chunkText(text: string, max = MAX_CHUNK): string[] {
  const chunks: string[] = [];
  let cur = "";
  const push = (piece: string) => {
    if (cur && cur.length + 1 + piece.length > max) {
      chunks.push(cur);
      cur = piece;
    } else cur = cur ? `${cur} ${piece}` : piece;
  };
  for (const sentence of text.split(/(?<=[.!?।])\s+/)) {
    const words = sentence.trim().split(/\s+/).filter(Boolean);
    if (sentence.length <= max) {
      if (words.length) push(words.join(" "));
      continue;
    }
    for (const w of words) for (let i = 0; i < w.length; i += max) push(w.slice(i, i + max));
  }
  if (cur) chunks.push(cur);
  return chunks;
}

export function detectLang(text: string): SpeechLang {
  return /[ऀ-ॿ]/.test(text) ? "hi-IN" : "en-IN";
}

interface VoiceLike {
  lang: string;
  localService: boolean;
}

/** Exact language on-device, then exact language online, then the same base language. */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], lang: SpeechLang): V | null {
  const want = lang.toLowerCase();
  const rank = (v: V) => {
    const l = v.lang.replace("_", "-").toLowerCase();
    const match = l === want ? 0 : l.slice(0, 2) === want.slice(0, 2) ? 2 : 9;
    return match + (v.localService ? 0 : 1);
  };
  let best: V | null = null;
  for (const v of voices) if (rank(v) < 9 && (best === null || rank(v) < rank(best))) best = v;
  return best;
}

const noSubscribe = () => () => {};

function readPref(): boolean {
  try {
    return window.localStorage.getItem(PREF_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribePref(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(PREF_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(PREF_EVENT, cb);
  };
}

export function useSpeechOutput() {
  const supported = useSyncExternalStore(noSubscribe, () => "speechSynthesis" in window, () => false);
  const readAloud = useSyncExternalStore(subscribePref, readPref, () => false);
  const [state, setState] = useState<"idle" | "speaking" | "paused">("idle");
  const [remoteVoice, setRemoteVoice] = useState(false);
  // Bumped on every speak/stop so events from cancelled utterances are ignored.
  const run = useRef(0);
  const active = useRef(false);

  const stop = useCallback(() => {
    run.current++;
    if (active.current && "speechSynthesis" in window) window.speechSynthesis.cancel();
    active.current = false;
    setState("idle");
  }, []);

  const speak = useCallback((text: string, lang?: SpeechLang) => {
    if (!("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const mine = ++run.current;
    const clean = stripMarkdown(text);
    const chunks = chunkText(clean);
    if (chunks.length === 0) {
      active.current = false;
      setState("idle");
      return;
    }
    const voice = pickVoice(synth.getVoices(), lang ?? detectLang(clean));
    setRemoteVoice(voice !== null && !voice.localService);
    const done = () => {
      if (run.current !== mine) return;
      active.current = false;
      setState("idle");
    };
    chunks.forEach((chunk, i) => {
      const u = new SpeechSynthesisUtterance(chunk);
      u.lang = voice?.lang ?? lang ?? detectLang(clean);
      if (voice) u.voice = voice as SpeechSynthesisVoice;
      if (i === chunks.length - 1) u.onend = done;
      // Another speaker cancelling us arrives here as "interrupted"/"canceled".
      u.onerror = done;
      synth.speak(u);
    });
    active.current = true;
    setState("speaking");
  }, []);

  const pause = useCallback(() => {
    if (!active.current) return;
    window.speechSynthesis.pause();
    setState("paused");
  }, []);

  const resume = useCallback(() => {
    if (!active.current) return;
    window.speechSynthesis.resume();
    setState("speaking");
  }, []);

  const setReadAloud = useCallback((on: boolean) => {
    try {
      window.localStorage.setItem(PREF_KEY, on ? "1" : "0");
    } catch {
      // Private mode: the preference lasts for this page only.
    }
    window.dispatchEvent(new Event(PREF_EVENT));
  }, []);

  // Stop on route change and on unmount (the cleanup runs for both).
  const pathname = usePathname();
  useEffect(() => stop, [pathname, stop]);

  return { supported, speaking: state === "speaking", paused: state === "paused", remoteVoice, speak, stop, pause, resume, readAloud, setReadAloud };
}
