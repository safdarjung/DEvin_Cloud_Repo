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
import { runAnatomy, runInfographic } from "@/modules/ai/components/explain/api";
import { useSpeechOutput } from "@/modules/ai/components/voice/useSpeechOutput";
import { plainChatText } from "@/modules/ai/chat-text";
import { parseOrbCommand } from "@/modules/ai/explain/commands";
import type { ExplainDepth } from "@/modules/ai/explain/schemas";
import { useResolutions } from "@/modules/ai/components/task-card/store";
import type { TaskCardProps } from "@/modules/ai/components/task-card/TaskCard";
import type { TaskProposalOutput } from "@/modules/ai/tasks/types";
import { OrbBody, buzz, type Lean } from "./OrbBody";
import { OrbComposer } from "./OrbComposer";
import type { OrbSignals } from "./OrbCore";
import { FeatureSearch, OrbGroups, useModeSwipe } from "./OrbGroups";
import { OrbModes, tabId } from "./OrbModes";
import { OrbTranscript, proposalsIn, type ExplainEntry, type LocalCard, type OrbMessage } from "./OrbTranscript";
import { CardFlight, OrbTray, type Flight, type StartFailure } from "./OrbTray";
import { orbState, stepIndex, typingPulse } from "./orb-layout";
import { MODES, explainFeatures, groupsFor, modesOf, pickMode, pushRecent, type OrbFeature, type OrbMode } from "./orb-modes";
import { ROLE_HOME, orbAccent } from "./orb-theme";
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
  /** The person's first name, for the greeting over the orb. */
  firstName?: string;
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
/** Fewer groups than this in a mode: their features ride the sphere instead. */
const FEATURE_CHIPS_BELOW = 4;
/** Without WebGL or with reduced motion the chips lie flat on the orb's front: more than this would spill over its edge, so they go in the row instead. */
const FLAT_MAX = 6;
const AUDIENCE: Partial<Record<Role, "student" | "teacher" | "parent">> = { student: "student", teacher: "teacher", guardian: "parent" };
const explainError = (msg: string | undefined) => msg?.trim() || "That didn't work. Try again in a moment.";
/** Ready questions that take turns as the message box's placeholder. */
const HINTS_MAX = 5;
/** The browser's clock, so the server renders a plain "Hello" and the client the time of day. */
const dayPart = () => {
  const h = new Date().getHours();
  return h < 5 ? "Hello" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

export function OrbView({ institutionSlug, role, chat, features, starters, initialQuery, initialMode, initialTask, controlCentreHref, firstName }: Props) {
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
  const [roomy, setRoomy] = useState(true);
  const [explains, setExplains] = useState<ExplainEntry[]>([]);
  const speech = useSpeechOutput();
  const use3d = useSyncExternalStore(noSubscribe, canRender3d, () => false);
  const reduced = useSyncExternalStore(subscribeReduced, () => window.matchMedia(REDUCED).matches, () => false);
  const dark = useTheme().resolvedTheme === "dark";
  const hello = useSyncExternalStore(noSubscribe, dayPart, () => "Hello");
  const signals = useRef<OrbSignals>({ level: 0, pulse: 0, spin: 0, hot: [0, 0, 1, 0], shock: 0, ptr: [0, 0, 0] });
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
      ...(chat ? explainFeatures(role, modesOf(features)) : []),
    ],
    [chat, recentKey, features, role],
  );
  const available = useMemo(() => modesOf(searchable), [searchable]);
  // First visit opens the role's own mode (when it has features there); afterwards the remembered one.
  const mode = picked ?? pickMode(available, { stored: storedMode || ROLE_HOME[role].mode });
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

  const explaining = explains.some((x) => x.pending || x.busy);
  const patchExplain = (id: string, p: Partial<ExplainEntry>) => setExplains((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const audience = AUDIENCE[role] ?? "staff";

  /** /anatomy, /teardown, /infographic: the explain routes, not chat; the result is its own transcript entry. */
  async function runCommand(line: string, cmd: NonNullable<ReturnType<typeof parseOrbCommand>>) {
    if (explaining) return;
    setInput("");
    setOpen(true);
    const id = `${Date.now()}-${explains.length}`;
    const mode = cmd.command === "teardown" ? "teardown" : "anatomy";
    const entry: ExplainEntry = { id, at: messages.length, line, subject: cmd.arg, mode, pending: Boolean(cmd.arg) };
    if (!cmd.arg) return setExplains((xs) => [...xs, { ...entry, error: `Say what to explain after the command, e.g. /${cmd.command} human heart.` }]);
    setExplains((xs) => [...xs, entry]);
    if (cmd.command === "infographic") {
      const res = await runInfographic({ institutionSlug, topic: cmd.arg, audience });
      if (!res.ok) return patchExplain(id, { pending: false, error: explainError(res.error.message) });
      if (res.data.refused) return patchExplain(id, { pending: false, error: explainError(res.data.reason) });
      return patchExplain(id, { pending: false, poster: res.data });
    }
    const res = await runAnatomy({ institutionSlug, subject: cmd.arg, mode, depth: "standard" });
    if (!res.ok) return patchExplain(id, { pending: false, error: explainError(res.error.message) });
    if (res.data.refused) return patchExplain(id, { pending: false, error: explainError(res.data.reason) });
    patchExplain(id, { pending: false, anatomy: res.data });
    if (speech.readAloud) speech.speak(`${res.data.anatomy.title}. ${res.data.anatomy.summary}`);
  }

  async function changeDepth(id: string, depth: ExplainDepth) {
    const x = explains.find((e) => e.id === id);
    if (!x?.anatomy || explaining) return;
    patchExplain(id, { busy: true, error: undefined });
    const res = await runAnatomy({ institutionSlug, subject: x.subject, mode: x.mode, depth, language: x.anatomy.language });
    if (!res.ok) return patchExplain(id, { busy: false, error: explainError(res.error.message) });
    if (res.data.refused) return patchExplain(id, { busy: false, error: explainError(res.data.reason) });
    patchExplain(id, { busy: false, anatomy: res.data });
  }

  async function makePoster(id: string) {
    const a = explains.find((e) => e.id === id)?.anatomy;
    if (!a || explaining) return;
    patchExplain(id, { busy: true, error: undefined });
    const res = await runInfographic({ institutionSlug, topic: a.anatomy.title, audience, language: a.language, fromAnatomy: a.anatomy });
    if (!res.ok) return patchExplain(id, { busy: false, error: explainError(res.error.message) });
    if (res.data.refused) return patchExplain(id, { busy: false, error: explainError(res.data.reason) });
    patchExplain(id, { busy: false, poster: res.data });
  }

  function send(text: string, taskHint?: string) {
    const t = text.trim();
    if (!chat || !t || busy) return;
    speech.stop();
    const cmd = taskHint ? null : parseOrbCommand(t);
    if (cmd) return void runCommand(t, cmd);
    if (error) clearError();
    signals.current.shock = 1;
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
    signals.current.shock = 1;
  }
  function stepMode(delta: number) {
    if (visibleModes.length < 2) return;
    changeMode(visibleModes[stepIndex(visibleModes.indexOf(mode), delta, visibleModes.length)], Math.sign(delta));
  }

  // Stable handlers for the memoised groups; they call the latest render's functions.
  const latest = useRef({ startTask, send, edit, stepMode, changeMode, visibleModes, input, chatOn: Boolean(chat) });
  useEffect(() => {
    latest.current = { startTask, send, edit, stepMode, changeMode, visibleModes, input, chatOn: Boolean(chat) };
  });
  const onRun = useCallback((f: OrbFeature) => {
    if (f.kind === "task" && f.task) void latest.current.startTask(f.task, f.label);
    // An "Explain & create" feature only fills the message box with its command.
    else if (f.prompt && parseOrbCommand(f.prompt)?.arg === "") latest.current.edit(f.prompt);
    else if (f.prompt) latest.current.send(f.prompt);
  }, []);
  const onEdit = useCallback((t: string) => latest.current.edit(t), []);
  const onSwipe = useCallback((d: number) => latest.current.stepMode(d), []);
  const onActive = useCallback((el: HTMLElement | null, hue: string) => {
    const orb = orbRef.current?.getBoundingClientRect();
    if (!el || !orb) return setLean(null);
    signals.current.pulse = typingPulse(signals.current.pulse);
    // A group on the sphere is part of the orb: it pulses and its dust lights up (OrbBody), no lean.
    if (el.closest("[data-orb-stage]")) return setLean(null);
    const r = el.getBoundingClientRect();
    const dx = r.left + r.width / 2 - (orb.left + orb.width / 2);
    const dy = r.top + r.height / 2 - (orb.top + orb.height / 2);
    const len = Math.hypot(dx, dy) || 1;
    setLean({ x: (dx / len) * LEAN_PX, y: (dy / len) * LEAN_PX, hue });
  }, []);
  // The ball's highlight and the dust under the mouse follow it; leaving keeps the last spot while it fades.
  const onPointer = useCallback((x: number, y: number, over: boolean) => {
    const ptr = signals.current.ptr;
    if (over) {
      ptr[0] = x;
      ptr[1] = y;
    }
    ptr[2] = over ? 1 : 0;
  }, []);
  const swipe = useModeSwipe(onSwipe);
  const msgCount = useRef(0);
  useEffect(() => {
    msgCount.current = messages.length;
  }, [messages.length]);
  const onResolved = useCallback<NonNullable<TaskCardProps["onResolved"]>>((r) => {
    if (r.status !== "approved") return;
    signals.current.shock = 1;
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

  // 1-6 switch modes and "/" jumps to the message box (starting a command), from anywhere that is not a text field or an open dialog (the tablist handles its own keys).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || !/^[1-6/]$/.test(e.key)) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.closest('[role="dialog"]'))) return;
      if (e.key === "/") {
        if (!latest.current.chatOn) return;
        e.preventDefault();
        return latest.current.edit(latest.current.input || "/");
      }
      const m = latest.current.visibleModes[Number(e.key) - 1];
      if (!m) return;
      e.preventDefault();
      latest.current.changeMode(m);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Read answers aloud: an answer that just finished speaks when the switch is on.
  const answering = useRef(false);
  useEffect(() => {
    const finished = answering.current && !busy;
    answering.current = busy;
    if (!finished || error || !speech.readAloud) return;
    const last = messages.at(-1);
    const text = last?.role === "assistant" ? plainChatText(last.parts.map((p) => (p.type === "text" ? p.text : "")).join("")) : "";
    if (text) speech.speak(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when an answer finishes and reads that render's messages
  }, [busy]);

  // The orb speaks: every piece of the answer that arrives nudges the dust, like a keystroke does.
  useEffect(() => {
    if (status === "streaming") signals.current.pulse = typingPulse(signals.current.pulse);
  }, [messages, status]);

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
    // A slash command in flight shows as thinking.
    status: explaining ? "submitted" : status,
    typing: input.trim().length > 0,
    error: Boolean(error) || errFlash,
    listening: voice.listening,
    proposing: flights.length > 0,
    done,
    waiting: pending.length > 0,
  });
  const hasTalk = (Boolean(chat) && messages.length > 0) || localCards.length > 0 || explains.length > 0;
  const showTranscript = hasTalk && (open || Boolean(error));
  // The groups ride the orb unless it is small (a conversation open, or a screen too small for tappable chips): then a row under it.
  const onSphere = !showTranscript && roomy && groups.length > 0 && ((use3d && !reduced) || groups.length <= FLAT_MAX);
  const home = ROLE_HOME[role];
  const hints = useMemo(() => (chat ? features.flatMap((f) => (f.kind === "ask" && f.mode === "ask" && f.prompt ? [f.prompt] : [])).slice(0, HINTS_MAX) : []), [chat, features]);
  const groupsEl = groups.length > 0 && (
    <OrbGroups
      mode={mode}
      groups={groups}
      layout={onSphere ? "sphere" : "row"}
      spin={use3d && !reduced}
      hasDraft={input.trim().length > 0}
      busy={busy}
      starting={starting}
      reduced={reduced}
      direction={direction}
      onRun={onRun}
      onEdit={onEdit}
      onActive={onActive}
      featureChips={groups.length < FEATURE_CHIPS_BELOW}
    />
  );

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
    <div className={`mx-auto grid w-full max-w-6xl gap-4 lg:grid-cols-[minmax(0,1fr)] lg:grid-rows-[auto_auto_1fr] ${showTranscript ? (explains.length > 0 ? "lg:grid-cols-[minmax(0,1fr)_minmax(23rem,36rem)]" : "lg:grid-cols-[minmax(0,1fr)_23rem]") : ""}`}>
      <h1 className="sr-only">App Orb</h1>
      <p ref={liveRef} role="status" aria-live="polite" className="sr-only" />

      <section aria-label="Orb" className="flex flex-col items-center gap-3 lg:col-start-1 lg:row-start-1">
        {!showTranscript && (
          <p className="text-balance px-4 text-center">
            <span
              className="block text-xs font-semibold uppercase tracking-[0.18em] text-(--orb-a) dark:text-(--orb-b)"
              style={{ "--orb-a": accent[0], "--orb-b": accent[1] } as React.CSSProperties}
            >
              {home.title}
            </span>
            <span className="mt-1 block text-xl font-semibold tracking-tight sm:text-2xl">
              {hello}
              {firstName ? `, ${firstName}` : ""}
            </span>
            <span className="mt-0.5 block text-sm text-muted-foreground">{home.greeting}</span>
          </p>
        )}
        <OrbBody
          state={state}
          accent={accent}
          dark={dark}
          reduced={reduced}
          use3d={use3d}
          signals={signals}
          compact={showTranscript}
          waiting={pending.length}
          lean={lean}
          typingTick={typingTick}
          orbRef={orbRef}
          nodeKey={onSphere ? `${mode}:${groups.map((g) => `${g.id}${g.features.length}`).join(",")}` : ""}
          onRoomy={setRoomy}
          onTap={() => inputRef.current?.focus()}
          onPointer={onPointer}
          showStatus={Boolean(chat) || pending.length > 0}
        >
          {onSphere && groupsEl}
        </OrbBody>
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
            Show conversation ({messages.length + localCards.length + explains.length})
          </button>
        )}
      </section>

      {showTranscript && (
        <div className="h-[50dvh] min-h-[18rem] lg:sticky lg:top-4 lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:h-[calc(100dvh-8rem)]">
          <OrbTranscript
            institutionSlug={institutionSlug}
            messages={messages}
            localCards={localCards}
            explains={explains}
            explainHandlers={{ onDepth: (id, d) => void changeDepth(id, d), onPoster: (id) => void makePoster(id) }}
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
              setExplains([]);
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
        {...swipe}
        className="min-w-0 lg:col-start-1 lg:row-start-2"
      >
        {visibleModes.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">No AI sections are available for your role yet.</p>
        ) : groups.length > 0 ? (
          <div className="space-y-3">
            <FeatureSearch features={searchable} hasDraft={input.trim().length > 0} busy={busy} starting={starting} reduced={reduced} onRun={onRun} />
            {!onSphere && groupsEl}
          </div>
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
      <div
        style={{ "--orb-a": accent[0], "--orb-b": accent[1] } as React.CSSProperties}
        className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 flex min-w-0 flex-col gap-2 self-start rounded-3xl bg-background/90 pb-1 backdrop-blur lg:bottom-2 lg:col-start-1 lg:row-start-3"
      >
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
          hints={hints}
          level={signals}
          reduced={reduced}
          voice={{ ...voice, start: () => (speech.stop(), voice.start()) }}
          speech={speech}
          inputRef={inputRef}
          onInput={(v) => {
            if (speech.speaking) speech.stop();
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
