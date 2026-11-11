"use client";

// Browser-only voice input for the App Orb. Transcription is the browser's own
// Web Speech service; the mic level for the orb comes from a local Web Audio
// AnalyserNode that is never connected to any output or network.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { micLevel } from "./orb-layout";

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noSubscribe = () => () => {};
const NOTE_KEY = "coolskool.orb.voice-note-seen";
const LANG_KEY = "coolskool.orb.voice-lang";

export type VoiceLang = "en-IN" | "hi-IN";
export const VOICE_LANGS: readonly { id: VoiceLang; short: string }[] = [
  { id: "en-IN", short: "EN" },
  { id: "hi-IN", short: "हिन्दी" },
];
export const VOICE_UNSUPPORTED = "Voice input isn't supported in this browser; try Chrome or Edge.";
export const VOICE_INSECURE = "Voice input needs a secure page: open the orb over https.";

// The voice language is a per-device preference; every read/write is guarded.
const langListeners = new Set<() => void>();
const subscribeLang = (cb: () => void) => {
  langListeners.add(cb);
  return () => void langListeners.delete(cb);
};
function readLang(): VoiceLang {
  try {
    return window.localStorage.getItem(LANG_KEY) === "hi-IN" ? "hi-IN" : "en-IN";
  } catch {
    return "en-IN";
  }
}
function writeLang(v: VoiceLang) {
  try {
    window.localStorage.setItem(LANG_KEY, v);
  } catch {
    /* storage blocked: the choice lasts for this page only */
  }
  langListeners.forEach((f) => f());
}

const VOICE_ERRORS: Record<string, string> = {
  "not-allowed": "Microphone access is blocked. Allow it in your browser to talk to the orb.",
  "service-not-allowed": "Your browser's speech service is turned off.",
  "no-speech": "Didn't catch that. Try again.",
  "audio-capture": "No microphone found.",
  network: "Your browser's speech service is unreachable.",
};

function readNoteSeen(): boolean {
  try {
    return window.localStorage.getItem(NOTE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * `onText` gets the running transcript; `onDone` gets the final text once the
 * person stops (or the browser ends recognition). `level` receives 0..1 mic loudness.
 */
export function useVoice(opts: { onText: (t: string) => void; onDone: (t: string) => void; level: React.RefObject<{ level: number }> }) {
  const supported = useSyncExternalStore(noSubscribe, () => recognitionCtor() !== null, () => false);
  const lang = useSyncExternalStore(subscribeLang, readLang, () => "en-IN" as VoiceLang);
  const [listening, setListening] = useState(false);
  /** The person still wants the mic on (cleared by stop()); a silence that ends recognition restarts it once. */
  const wanted = useRef(false);
  const restarted = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [showNote, setShowNote] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const text = useRef("");
  const audio = useRef<{ stream: MediaStream; ctx: AudioContext; raf: number } | null>(null);
  const cbs = useRef(opts);
  useEffect(() => {
    cbs.current = opts;
  });

  function stopAudio() {
    const a = audio.current;
    audio.current = null;
    if (a) {
      cancelAnimationFrame(a.raf);
      a.stream.getTracks().forEach((t) => t.stop());
      void a.ctx.close();
    }
    cbs.current.level.current.level = 0;
  }

  async function startAudio() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!rec.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        cbs.current.level.current.level = micLevel(buf);
        if (audio.current) audio.current.raf = requestAnimationFrame(tick);
      };
      audio.current = { stream, ctx, raf: requestAnimationFrame(tick) };
    } catch {
      // Level is decoration only; recognition reports its own permission error.
    }
  }

  /** One recognition session; `base` is what earlier sessions heard (kept across the silence restart). */
  function listen(Ctor: RecognitionCtor, base: string): boolean {
    const r = new Ctor();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let t = "";
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0]?.transcript ?? "";
      text.current = `${base} ${t}`.trim();
      cbs.current.onText(text.current);
    };
    r.onerror = (e) => {
      if (e.error === "no-speech" && wanted.current && !restarted.current) return; // the restart below handles a first silence
      if (e.error !== "aborted") setError(VOICE_ERRORS[e.error] ?? "Voice input stopped unexpectedly.");
    };
    r.onend = () => {
      rec.current = null;
      // The browser ends recognition after a silence even in continuous mode: carry on once if the mic is still on.
      if (wanted.current && !restarted.current) {
        restarted.current = true;
        if (listen(Ctor, text.current)) return;
      }
      wanted.current = false;
      stopAudio();
      setListening(false);
      setShowNote(false);
      try {
        window.localStorage.setItem(NOTE_KEY, "1");
      } catch {
        // Private mode: the note shows again next time, which is fine.
      }
      if (text.current) cbs.current.onDone(text.current);
    };
    rec.current = r;
    try {
      r.start();
      return true;
    } catch {
      rec.current = null;
      return false;
    }
  }

  function start() {
    if (rec.current) return;
    const Ctor = recognitionCtor();
    if (!window.isSecureContext) return setError(VOICE_INSECURE);
    if (!Ctor) return setError(VOICE_UNSUPPORTED);
    text.current = "";
    wanted.current = true;
    restarted.current = false;
    setError(null);
    setShowNote(!readNoteSeen());
    setListening(true);
    if (!listen(Ctor, "")) {
      wanted.current = false;
      setListening(false);
      setError("Voice input could not start.");
      return;
    }
    void startAudio();
  }

  function stop() {
    wanted.current = false;
    rec.current?.stop();
  }

  useEffect(
    () => () => {
      const r = rec.current;
      rec.current = null;
      if (r) {
        r.onend = null;
        r.abort();
      }
      stopAudio();
    },
    // Unmount only.
    [],
  );

  return { supported, listening, error, showNote, start, stop, lang, setLang: writeLang, clearError: () => setError(null) };
}
