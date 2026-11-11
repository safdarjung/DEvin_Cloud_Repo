"use client";

// App Orb: the one place to ask, do and create. A living, physical orb shows the AI
// state; a mode tablist (Ask / Do / Create / Teach / Learn / Manage, only the ones
// this person has) filters the sections; each section's features ask a question,
// start a draft, open a page, or open an approval card (no model call, or with the
// typed request as a task hint). Cards from answers and clicks stay in the
// conversation, and a "Waiting for you" tray keeps the unapproved ones in reach.
// Everything comes from the server: the client never recomputes permissions.
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { MessagesSquare } from "lucide-react";
import Link from "next/link";
import type { Role } from "@/lib/auth/permissions";
import { chatErrorMessage } from "@/modules/ai/chat-error";
import { startProposal } from "@/modules/ai/components/task-card/api";
import { useResolutions } from "@/modules/ai/components/task-card/store";
import type { TaskCardProps } from "@/modules/ai/components/task-card/TaskCard";
import type { TaskProposalOutput } from "@/modules/ai/tasks/types";
import { OrbBody, buzz, type Lean } from "./OrbBody";
import { OrbComposer } from "./OrbComposer";
import type { OrbSignals } from "./OrbCore";
import { OrbGroups } from "./OrbGroups";
import { OrbModes, tabId } from "./OrbModes";
import { OrbTranscript, proposalsIn, type LocalCard, type OrbMessage } from "./OrbTranscript";
import { CardFlight, OrbTray, type Flight, type StartFailure } from "./OrbTray";
import { orbState, stepIndex, typingPulse } from "./orb-layout";
import { MODES, groupsFor, modesOf, pickMode, pushRecent, type OrbFeature, type OrbMode } from "./orb-modes";
import { orbAccent } from "./orb-theme";
import { useVoice } from "./useVoice";

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
  /** Every feature the server found available for this person, in every mode. */
  features: OrbFeature[];
  /** Page-aware questions from the page the person came from (`?from=`). */
  starters?: string[];
  /** `?q=` from the Ask AI launcher: sent once on arrival when chat is on. */
  initialQuery?: string;
  /** `?mode=` (already validated). */
  initialMode?: OrbMode;
  /** `?task=` (already checked against the enabled tasks): its card opens on arrival. */
  initialTask?: { action: string; mode: OrbMode };
  /** Roles that may manage AI settings get a link from empty modes. */
  controlCentreHref?: string;
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

// Per-device preferences (recent prompts, last mode, dismissed tip) live only in this browser; every read/write is guarded.
const localListeners = new Set<() => void>();
const subscribeLocal = (cb: () => void) => {
  localListeners.add(cb);
  return () => void localListeners.delete(cb);
};
function readLocal(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function writeLocal(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the preference just does not persist */
  }
  localListeners.forEach((f) => f());
}
const useLocal = (key: string, fallback: string, server: string) =>
  useSyncExternalStore(subscribeLocal, () => readLocal(key, fallback), () => server);
function parseList(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Mirrors mode/task/q into the address bar without a navigation (null removes a key). */
function setUrl(params: Record<string, string | null>) {
  try {
    const url = new URL(window.location.href);
    for (const [k, v] of Object.entries(params)) {
      if (v === null) url.searchParams.delete(k);
      else url.searchParams.set(k, v);
    }
    window.history.replaceState(null, "", url);
  } catch {
    /* history blocked: the URL just does not follow */
  }
}

const LEAN_PX = 10;
const ERROR_FLASH_MS = 1800;
const DONE_MS = 1400;
const EXPIRY_TICK_MS = 30_000;
const ALL_MODES = MODES.map((m) => m.id);

export function OrbView({ institutionSlug, role, chat, features, starters, initialQuery, initialMode, initialTask, controlCentreHref }: Props) {
  const idBase = useId();
  const panelId = `${idBase}-panel`;
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(true);
  const [lean, setLean] = useState<Lean | null>(null);
  const [picked, setPicked] = useState<OrbMode | null>(initialMode ?? initialTask?.mode ?? null);
  const [direction, setDirection] = useState(0);
  const [localCards, setLocalCards] = useState<LocalCard[]>([]);
  const [starting, setStarting] = useState<string | null>(null);
  const [failure, setFailure] = useState<StartFailure | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [errFlash, setErrFlash] = useState(false);
  const [done, setDone] = useState(false);
  const [typingTick, setTypingTick] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const use3d = useSyncExternalStore(noSubscribe, canRender3d, () => false);
  const reduced = useSyncExternalStore(subscribeReduced, () => window.matchMedia(REDUCED).matches, () => false);
  const dark = useTheme().resolvedTheme === "dark";
  const signals = useRef<OrbSignals>({ level: 0, pulse: 0, spin: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLParagraphElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const store = `coolskool.orb.${institutionSlug}.${role}`;
  const recent = parseList(useLocal(`${store}.recent`, "[]", "[]"));
  const storedMode = useLocal(`${store}.mode`, "", "");
  const introDone = useLocal("coolskool.orb.intro.modes", "", "1") === "1";

  const recentKey = recent.join("\n");
  const searchable = useMemo<OrbFeature[]>(
    () => [
      ...(chat ? recentKey.split("\n").filter(Boolean).map((t): OrbFeature => ({ key: `recent:${t}`, label: t, prompt: t, mode: "ask", groupId: "recent", kind: "ask" })) : []),
      ...features,
    ],
    [chat, recentKey, features],
  );
  const available = useMemo(() => modesOf(searchable), [searchable]);
  const mode = picked ?? pickMode(available, { stored: storedMode });
  // A mode asked for by URL but empty for this person still gets its tab, to show why it is empty.
  const visibleModes = useMemo(() => ALL_MODES.filter((m) => available.includes(m) || m === mode), [available, mode]);
  const groups = useMemo(() => groupsFor(searchable, mode), [searchable, mode]);
  const counts = useMemo(() => Object.fromEntries(visibleModes.map((m) => [m, features.filter((f) => f.mode === m).length])), [visibleModes, features]);
  const accent = orbAccent(role, mode);
  const hueFor = useCallback((m: OrbMode) => orbAccent(role, m)[1], [role]);

  const { messages, sendMessage, status, error, stop, clearError, regenerate, setMessages } = useChat<OrbMessage>({
    transport: new DefaultChatTransport({
      api: chat?.endpoint ?? "/api/ai/agent/assistant",
      body: { institutionSlug, studentId: chat?.studentId },
    }),
  });
  const busy = status === "submitted" || status === "streaming";

  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  function send(text: string, taskHint?: string) {
    const t = text.trim();
    if (!chat || !t || busy) return;
    if (error) clearError();
    // The server narrows its task signatures by mode (and to one task with a hint); it re-checks everything.
    void sendMessage({ text: t }, { body: taskHint ? { mode, taskHint } : { mode } });
    writeLocal(`${store}.recent`, JSON.stringify(pushRecent(parseList(readLocal(`${store}.recent`, "[]")), t)));
    setInput("");
    setOpen(true);
  }
  function edit(text: string) {
    setInput(text);
    requestAnimationFrame(() => inputRef.current?.focus());
  }
  function flashError() {
    setErrFlash(true);
    later(() => setErrFlash(false), ERROR_FLASH_MS);
  }

  /** A task feature: with a typed request, send it as a hint; otherwise open an empty card (no model call). */
  async function startTask(action: string, label: string) {
    const draft = input.trim();
    if (draft && chat) return send(draft, action);
    setFailure(null);
    setStarting(action);
    const res = await startProposal(institutionSlug, action);
    setStarting(null);
    if (res.ok) {
      setLocalCards((cs) => [...cs, { proposal: res.data, at: messages.length }]);
      setOpen(true);
    } else {
      setFailure({ task: action, label, message: res.error.message });
      flashError();
    }
  }

  function changeMode(m: OrbMode, dir?: number) {
    if (m === mode) return;
    setDirection(dir ?? (Math.sign(visibleModes.indexOf(m) - visibleModes.indexOf(mode)) || 1));
    setPicked(m);
    writeLocal(`${store}.mode`, m);
    setUrl({ mode: m });
    signals.current.pulse = 1;
  }
  function stepMode(delta: number) {
    if (visibleModes.length < 2) return;
    changeMode(visibleModes[stepIndex(visibleModes.indexOf(mode), delta, visibleModes.length)], Math.sign(delta));
  }

  // Stable handlers for the memoised groups; they call the latest render's functions.
  const latest = useRef({ startTask, send, edit, stepMode, changeMode, visibleModes });
  useEffect(() => {
    latest.current = { startTask, send, edit, stepMode, changeMode, visibleModes };
  });
  const onRun = useCallback((f: OrbFeature) => {
    if (f.kind === "task" && f.task) void latest.current.startTask(f.task, f.label);
    else if (f.prompt) latest.current.send(f.prompt);
  }, []);
  const onEdit = useCallback((t: string) => latest.current.edit(t), []);
  const onSwipe = useCallback((d: number) => latest.current.stepMode(d), []);
  const onActive = useCallback((el: HTMLElement | null, hue: string) => {
    const orb = orbRef.current?.getBoundingClientRect();
    if (!el || !orb) return setLean(null);
    const r = el.getBoundingClientRect();
    const dx = r.left + r.width / 2 - (orb.left + orb.width / 2);
    const dy = r.top + r.height / 2 - (orb.top + orb.height / 2);
    const len = Math.hypot(dx, dy) || 1;
    signals.current.pulse = typingPulse(signals.current.pulse);
    setLean({ x: (dx / len) * LEAN_PX, y: (dy / len) * LEAN_PX, hue });
  }, []);
  const onTurn = useCallback((v: number) => {
    signals.current.spin = v;
  }, []);
  const msgCount = useRef(0);
  useEffect(() => {
    msgCount.current = messages.length;
  }, [messages.length]);
  const onResolved = useCallback<NonNullable<TaskCardProps["onResolved"]>>((r) => {
    if (r.status !== "approved") return;
    setDone(true);
    timers.current.push(setTimeout(() => setDone(false), DONE_MS));
  }, []);
  // The card's Undo hands back a new proposal: it joins the conversation as its own card.
  const onStart = useCallback((next: TaskProposalOutput) => {
    setLocalCards((cs) => [...cs, { proposal: next, at: msgCount.current }]);
  }, []);

  // Arrival: `?q=` sends (with `?task=` as its hint), `?task=` alone opens its card; both leave the URL so a reload does not repeat them.
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current) return;
    // Marked inside the frame: a dev StrictMode remount cancels the first frame and schedules it again.
    const raf = requestAnimationFrame(() => {
      arrived.current = true;
      if (initialQuery && chat) send(initialQuery, initialTask?.action);
      else if (initialTask) void startTask(initialTask.action, features.find((f) => f.task === initialTask.action)?.label ?? initialTask.action);
      if (initialQuery || initialTask) setUrl({ q: null, task: null });
      else if (!window.matchMedia("(pointer: coarse)").matches) inputRef.current?.focus(); // not on touch: no surprise keyboard
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once on mount
  }, []);

  // 1-6 switch modes from anywhere that is not a text field or an open dialog (the tablist handles its own keys).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || !/^[1-6]$/.test(e.key)) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.closest('[role="dialog"]'))) return;
      const m = latest.current.visibleModes[Number(e.key) - 1];
      if (!m) return;
      e.preventDefault();
      latest.current.changeMode(m);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
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

  // Cards: every proposal from answers (tool OUTPUT only) and from clicks; unresolved, unexpired ones wait in the tray.
  const chatProposals = useMemo(() => messages.flatMap((m) => (m.role === "assistant" ? proposalsIn(m.parts) : [])), [messages]);
  const proposals = useMemo(() => [...chatProposals, ...localCards.map((c) => c.proposal)], [chatProposals, localCards]);
  const resolved = useResolutions(proposals.map((p) => p.proposalId));
  const pending = proposals.filter((p) => !resolved.has(p.proposalId) && Date.parse(p.view.expiresAt) > now);
  useEffect(() => {
    if (proposals.length === 0) return;
    const t = setInterval(() => setNow(Date.now()), EXPIRY_TICK_MS);
    return () => clearInterval(t);
  }, [proposals.length]);

  // A new card visibly leaves the orb for its place (or the tray when its place is out of view).
  const seen = useRef(new Set<string>());
  const idsKey = proposals.map((p) => p.proposalId).join(" ");
  useEffect(() => {
    const fresh = idsKey.split(" ").filter((id) => id && !seen.current.has(id));
    fresh.forEach((id) => seen.current.add(id));
    if (fresh.length === 0) return;
    if (liveRef.current) liveRef.current.textContent = `${fresh.length === 1 ? "A card is" : `${fresh.length} cards are`} ready for you to check and approve`;
    buzz(reduced, 10);
    if (reduced) return;
    requestAnimationFrame(() => {
      const o = orbRef.current?.getBoundingClientRect();
      if (!o) return;
      const inView = (r: DOMRect | undefined) => r && r.width > 0 && r.bottom > 0 && r.top < window.innerHeight;
      const next = fresh.flatMap((id): Flight[] => {
        const card = document.querySelector(`[data-proposals~="${CSS.escape(id)}"]`)?.getBoundingClientRect();
        const r = inView(card) ? card : trayRef.current?.getBoundingClientRect();
        if (!r || !inView(r)) return [];
        return [{ id, from: { x: o.left + o.width / 2, y: o.top + o.height / 2 }, to: { left: r.left, top: r.top, width: r.width, height: r.height } }];
      });
      setFlights((f) => [...f, ...next]);
    });
  }, [idsKey, reduced]);
  const landed = useCallback((id: string) => setFlights((f) => f.filter((x) => x.id !== id)), []);

  const voice = useVoice({ onText: setInput, onDone: send, level: signals });
  const state = orbState({
    status,
    typing: input.trim().length > 0,
    error: Boolean(error) || errFlash,
    listening: voice.listening,
    proposing: flights.length > 0,
    done,
    waiting: pending.length > 0,
  });
  const hasTalk = (Boolean(chat) && messages.length > 0) || localCards.length > 0;
  const showTranscript = hasTalk && (open || Boolean(error));

  function jumpTo(id: string) {
    setOpen(true);
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-proposals~="${CSS.escape(id)}"]`);
      el?.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
      el?.focus({ preventScroll: true });
    });
  }

  const emptyText =
    mode === "ask"
      ? chat
        ? "Nothing ready to ask here yet. Type your own question below."
        : "Asking is off for your role."
      : "Nothing to do here yet — your school has not switched these on.";

  return (
    // The tall transcript spans all three rows on lg: only the last row may grow, so the orb, groups and composer stay evenly spaced.
    <div className={`mx-auto grid w-full max-w-6xl gap-4 lg:grid-cols-[minmax(0,1fr)] lg:grid-rows-[auto_auto_1fr] ${showTranscript ? "lg:grid-cols-[minmax(0,1fr)_23rem]" : ""}`}>
      <h1 className="sr-only">App Orb</h1>
      <p ref={liveRef} role="status" aria-live="polite" className="sr-only" />

      <section aria-label="Orb" className="flex flex-col items-center gap-3 lg:col-start-1 lg:row-start-1">
        <OrbBody
          state={state}
          accent={accent}
          dark={dark}
          reduced={reduced}
          use3d={use3d}
          signals={signals}
          compact={hasTalk}
          waiting={pending.length}
          lean={lean}
          modeIndex={Math.max(0, visibleModes.indexOf(mode))}
          modeCount={visibleModes.length}
          typingTick={typingTick}
          orbRef={orbRef}
          onFlick={stepMode}
          onTurn={onTurn}
          onTap={() => inputRef.current?.focus()}
          showStatus={Boolean(chat) || pending.length > 0}
        />
        <OrbModes
          modes={visibleModes}
          current={mode}
          counts={counts}
          idBase={idBase}
          panelId={panelId}
          hueFor={hueFor}
          reduced={reduced}
          showIntro={!introDone}
          onDismissIntro={() => writeLocal("coolskool.orb.intro.modes", "1")}
          onChange={changeMode}
        />
        {hasTalk && !open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-card px-4 text-xs font-medium shadow-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MessagesSquare className="size-3.5" aria-hidden />
            Show conversation ({messages.length + localCards.length})
          </button>
        )}
      </section>

      {showTranscript && (
        <div className="h-[50dvh] min-h-[18rem] lg:sticky lg:top-4 lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:h-[calc(100dvh-8rem)]">
          <OrbTranscript
            institutionSlug={institutionSlug}
            messages={messages}
            localCards={localCards}
            status={status}
            error={error ? chatErrorMessage(error) : null}
            accent={accent[1]}
            onRetry={() => {
              clearError();
              void regenerate({ body: { mode } });
            }}
            onDismissError={clearError}
            onNewChat={() => {
              if (busy) void stop();
              clearError();
              setMessages([]);
              setLocalCards([]);
            }}
            onCollapse={() => setOpen(false)}
            onResolved={onResolved}
            onStart={onStart}
          />
        </div>
      )}

      <section
        role={visibleModes.length ? "tabpanel" : undefined}
        id={panelId}
        aria-labelledby={visibleModes.length ? tabId(idBase, mode) : undefined}
        aria-label={visibleModes.length ? undefined : "What you can do"}
        className="min-w-0 lg:col-start-1 lg:row-start-2"
      >
        {visibleModes.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">No AI sections are available for your role yet.</p>
        ) : groups.length > 0 ? (
          <OrbGroups
            mode={mode}
            groups={groups}
            searchable={searchable}
            hasDraft={input.trim().length > 0}
            busy={busy}
            starting={starting}
            reduced={reduced}
            direction={direction}
            onRun={onRun}
            onEdit={onEdit}
            onActive={onActive}
            onSwipe={onSwipe}
          />
        ) : (
          <div className="mx-auto max-w-md rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm">
            <p>{emptyText}</p>
            {mode !== "ask" && controlCentreHref && (
              <Link href={controlCentreHref} className="mt-2 inline-flex min-h-11 items-center font-medium underline underline-offset-2">
                Turn tasks on in the control centre
              </Link>
            )}
          </div>
        )}
      </section>

      {/* Above the phone bottom nav (fixed, lg:hidden), so the message box is always in view. */}
      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 flex min-w-0 flex-col gap-2 self-start rounded-3xl bg-background/90 pb-1 backdrop-blur lg:bottom-2 lg:col-start-1 lg:row-start-3">
        <OrbTray
          items={pending.map((p) => ({ id: p.proposalId, title: p.view.title }))}
          failure={failure}
          chatOn={Boolean(chat)}
          reduced={reduced}
          trayRef={trayRef}
          onJump={jumpTo}
          onAskInstead={(f) => {
            setFailure(null);
            send(f.label, f.task);
          }}
          onDismissFailure={() => setFailure(null)}
        />
        <OrbComposer
          chatOn={Boolean(chat)}
          input={input}
          busy={busy}
          starters={starters}
          voice={voice}
          inputRef={inputRef}
          onInput={(v) => {
            setInput(v);
            signals.current.pulse = typingPulse(signals.current.pulse);
            setTypingTick((n) => n + 1);
          }}
          onSend={send}
          onStop={() => void stop()}
        />
      </div>

      {flights.map((f) => (
        <CardFlight key={f.id} flight={f} hue={accent[1]} onDone={landed} />
      ))}
    </div>
  );
}
