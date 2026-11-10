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
  const [listening, setListening] = useState(false);
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

  function start() {
    const Ctor = recognitionCtor();
    if (!Ctor || rec.current) return;
    const r = new Ctor();
    r.lang = document.documentElement.lang || navigator.language || "en-IN";
    r.continuous = true;
    r.interimResults = true;
    text.current = "";
    r.onresult = (e) => {
      let t = "";
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0]?.transcript ?? "";
      text.current = t.trim();
      cbs.current.onText(text.current);
    };
    r.onerror = (e) => {
      if (e.error !== "aborted") setError(VOICE_ERRORS[e.error] ?? "Voice input stopped unexpectedly.");
    };
    r.onend = () => {
      rec.current = null;
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
    setError(null);
    setShowNote(!readNoteSeen());
    setListening(true);
    try {
      r.start();
    } catch {
      rec.current = null;
      setListening(false);
      setError("Voice input could not start.");
      return;
    }
    void startAudio();
  }

  function stop() {
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

  return { supported, listening, error, showNote, start, stop, clearError: () => setError(null) };
}
