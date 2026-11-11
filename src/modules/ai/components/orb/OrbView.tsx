"use client";

// App Orb: a calm living orb that shows the AI state, the sections the person can
// use as groups of ready prompts and AI tools (OrbGroups), and an always-visible
// chat input (typed or spoken). Chat runs over the existing per-role endpoint.
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { motion } from "motion/react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { MessagesSquare } from "lucide-react";
import type { Role } from "@/lib/auth/permissions";
import { chatErrorMessage } from "@/modules/ai/chat-error";
import { OrbComposer } from "./OrbComposer";
import type { OrbSignals } from "./OrbCore";
import { OrbGroups } from "./OrbGroups";
import { OrbTranscript, type OrbMessage } from "./OrbTranscript";
import { pushRecent, type OrbGroup } from "./orb-groups";
import { orbState, type OrbState } from "./orb-layout";
import { ROLE_ACCENTS } from "./orb-theme";
import { useVoice } from "./useVoice";

const OrbCore = dynamic(() => import("./OrbCore"), { ssr: false });

export interface OrbChat {
  /** One of the existing role routes under /api/ai/agent. */
  endpoint: string;
  /** Guardians only: the selected child. */
  studentId?: string;
}

interface Props {
  institutionSlug: string;
  role: Role;
  chat: OrbChat | null;
  /** Sections the server found available for this person. */
  groups: OrbGroup[];
  /** Page-aware questions from the page the person came from (`?from=`). */
  starters?: string[];
  /** `?q=` from the Ask AI launcher: sent once on arrival when chat is on. */
  initialQuery?: string;
}

const noSubscribe = () => () => {};
const REDUCED = "(prefers-reduced-motion: reduce)";
const subscribeReduced = (cb: () => void) => {
  const mq = window.matchMedia(REDUCED);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
// Probed once: each probe would open a new WebGL context.
let webgl: boolean | undefined;
function canRender3d(): boolean {
  if (webgl !== undefined) return webgl;
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") ?? c.getContext("webgl");
    webgl = Boolean(gl);
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webgl = false;
  }
  return webgl;
}

const STATE_LABEL: Record<OrbState, string> = {
  idle: "Ready", listening: "Listening", typing: "Ready", submitted: "Thinking", streaming: "Answering", error: "Something went wrong",
};

// Recent prompts live only in this browser (never sent anywhere); every read/write is guarded.
const recentListeners = new Set<() => void>();
const subscribeRecent = (cb: () => void) => {
  recentListeners.add(cb);
  return () => void recentListeners.delete(cb);
};
function readRecent(key: string): string {
  try {
    return localStorage.getItem(key) ?? "[]";
  } catch {
    return "[]";
  }
}
function parseRecent(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function writeRecent(key: string, list: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* storage blocked: recents just do not persist */
  }
  recentListeners.forEach((f) => f());
}

interface Lean {
  x: number;
  y: number;
  hue: string;
}
const LEAN_PX = 10;

export function OrbView({ institutionSlug, role, chat, groups, starters, initialQuery }: Props) {
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(true);
  const [lean, setLean] = useState<Lean | null>(null);
  const use3d = useSyncExternalStore(noSubscribe, canRender3d, () => false);
  const reduced = useSyncExternalStore(subscribeReduced, () => window.matchMedia(REDUCED).matches, () => false);
  const dark = useTheme().resolvedTheme === "dark";
  const accent = ROLE_ACCENTS[role];
  const signals = useRef<OrbSignals>({ level: 0, pulse: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLParagraphElement>(null);
  const recentKey = `coolskool.orb.recent.${institutionSlug}.${role}`;
  const recentRaw = useSyncExternalStore(subscribeRecent, () => readRecent(recentKey), () => "[]");
  const recent = useMemo(() => parseRecent(recentRaw), [recentRaw]);
  const { messages, sendMessage, status, error, stop, clearError, regenerate, setMessages } = useChat<OrbMessage>({
    transport: new DefaultChatTransport({
      api: chat?.endpoint ?? "/api/ai/agent/assistant",
      body: { institutionSlug, studentId: chat?.studentId },
    }),
  });
  const busy = status === "submitted" || status === "streaming";

  function send(text: string) {
    const t = text.trim();
    if (!chat || !t || busy) return;
    if (error) clearError();
    void sendMessage({ text: t });
    writeRecent(recentKey, pushRecent(parseRecent(readRecent(recentKey)), t));
    setInput("");
    setOpen(true);
  }
  function edit(text: string) {
    setInput(text);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  const autoSent = useRef(false);
  useEffect(() => {
    if (autoSent.current || !initialQuery || !chat) return;
    autoSent.current = true;
    send(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once on mount
  }, []);

  // Screen readers hear thinking and the arrival of an answer (the transcript has its own live region for the text).
  const wasBusy = useRef(false);
  useEffect(() => {
    const live = liveRef.current;
    if (!live) return;
    if (status === "submitted") live.textContent = "Thinking";
    else if (status === "streaming") live.textContent = "Answering";
    else if (wasBusy.current) live.textContent = error ? "The answer failed. You can retry." : "Answer ready";
    wasBusy.current = busy;
  }, [status, busy, error]);

  const voice = useVoice({ onText: setInput, onDone: send, level: signals });
  const state = orbState({ status, typing: input.trim().length > 0, error: Boolean(error), listening: voice.listening });
  const hasTalk = Boolean(chat) && messages.length > 0;
  const showTranscript = hasTalk && (open || Boolean(error));
  const showCanvas = use3d && !reduced;

  const onActive = useCallback((el: HTMLElement | null, hue: string) => {
    const orb = orbRef.current?.getBoundingClientRect();
    if (!el || !orb) return setLean(null);
    const r = el.getBoundingClientRect();
    const dx = r.left + r.width / 2 - (orb.left + orb.width / 2);
    const dy = r.top + r.height / 2 - (orb.top + orb.height / 2);
    const len = Math.hypot(dx, dy) || 1;
    setLean({ x: (dx / len) * LEAN_PX, y: (dy / len) * LEAN_PX, hue });
  }, []);

  const busyNow = state === "submitted" || state === "streaming";
  return (
    <div className={`mx-auto grid w-full max-w-6xl gap-4 lg:grid-cols-[minmax(0,1fr)] ${showTranscript ? "lg:grid-cols-[minmax(0,1fr)_23rem]" : ""}`}>
      <h1 className="sr-only">App Orb</h1>
      <p ref={liveRef} role="status" aria-live="polite" className="sr-only" />

      <section aria-label="Orb status" className="flex flex-col items-center gap-2 lg:col-start-1 lg:row-start-1">
        <motion.div
          ref={orbRef}
          aria-hidden
          className={`relative ${hasTalk ? "size-28 sm:size-32" : "size-36 sm:size-44"}`}
          animate={reduced ? undefined : { x: lean?.x ?? 0, y: lean?.y ?? 0, scale: lean ? 1.05 : 1 }}
          transition={{ type: "spring", stiffness: 160, damping: 14 }}
        >
          {lean && !reduced && (
            <motion.span
              className="absolute -inset-3 rounded-full blur-xl"
              style={{ background: `radial-gradient(circle, ${lean.hue}, transparent 70%)` }}
              initial={{ opacity: 0.2, scale: 0.9 }}
              animate={{ opacity: [0.25, 0.6, 0.25], scale: [0.95, 1.08, 0.95] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            />
          )}
          <div
            className="absolute inset-[12%] rounded-full"
            style={{
              background: `radial-gradient(circle at 35% 30%, ${accent[1]}, ${accent[0]} 70%)`,
              opacity: showCanvas ? (dark ? 0.35 : 0.3) : 0.9,
              boxShadow: `0 0 40px -8px ${accent[1]}`,
            }}
          />
          {showCanvas && (
            <div className="absolute -inset-[6%]">
              <OrbCore state={state} dark={dark} accent={accent} signals={signals} />
            </div>
          )}
        </motion.div>
        {chat && (
          <p className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium">
            <span
              className={`size-2 rounded-full ${busyNow && !reduced ? "animate-pulse" : ""}`}
              style={{ background: state === "error" ? "var(--destructive)" : accent[1] }}
              aria-hidden
            />
            {STATE_LABEL[state]}
          </p>
        )}
        {hasTalk && !open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-card px-4 text-xs font-medium shadow-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MessagesSquare className="size-3.5" aria-hidden />
            Show conversation ({messages.length})
          </button>
        )}
      </section>

      {showTranscript && (
        <div className="h-[50dvh] min-h-[18rem] lg:sticky lg:top-4 lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:h-[calc(100dvh-8rem)]">
          <OrbTranscript
            institutionSlug={institutionSlug}
            messages={messages}
            status={status}
            error={error ? chatErrorMessage(error) : null}
            accent={accent[1]}
            onRetry={() => {
              clearError();
              void regenerate();
            }}
            onDismissError={clearError}
            onNewChat={() => {
              if (busy) void stop();
              clearError();
              setMessages([]);
            }}
            onCollapse={() => setOpen(false)}
          />
        </div>
      )}

      <section aria-label="What you can ask" className="min-w-0 lg:col-start-1 lg:row-start-2">
        {groups.length > 0 || recent.length > 0 ? (
          <OrbGroups groups={groups} recent={chat ? recent : []} busy={busy} reduced={reduced} onSend={send} onEdit={edit} onActive={onActive} />
        ) : (
          <p className="text-center text-sm text-muted-foreground">No AI sections are available for your role yet.</p>
        )}
      </section>

      <div className="sticky bottom-2 z-20 min-w-0 rounded-3xl bg-background/90 pb-1 backdrop-blur lg:col-start-1 lg:row-start-3">
        <OrbComposer
          chatOn={Boolean(chat)}
          input={input}
          busy={busy}
          starters={starters}
          voice={voice}
          inputRef={inputRef}
          onInput={(v) => {
            setInput(v);
            signals.current.pulse = 1;
          }}
          onSend={send}
          onStop={() => void stop()}
        />
      </div>
    </div>
  );
}
