"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Nudge } from "@/modules/ai/nudges";

const SEEN_KEY = "askai:nudges-seen";
const DISMISSED_KEY = "askai:nudges-dismissed";
const COUNT_KEY = "askai:nudges-auto";
const MIN_GAP_MS = 45_000;
const MAX_GAP_MS = 120_000;
const COOLDOWN_MS = 60_000;
const SHOW_MS = 7_000;
const MAX_PER_SESSION = 6;
const LEAVE_MS = 300;

function readSet(key: string): Set<string> {
  try {
    return new Set<string>(JSON.parse(sessionStorage.getItem(key) ?? "[]"));
  } catch {
    return new Set();
  }
}
function writeSet(key: string, s: Set<string>) {
  try {
    sessionStorage.setItem(key, JSON.stringify([...s].slice(-200)));
  } catch {
    /* storage blocked: kept for this page load only */
  }
}
function readCount(): number {
  try {
    return Number(sessionStorage.getItem(COUNT_KEY)) || 0;
  } catch {
    return 0;
  }
}
function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.matches("input,textarea,select") || el.isContentEditable);
}

/** Bubble state for the orb: what is shown, hover/random/fresh triggers, cycling, dismissal. */
export function useNudgeBubble(nudges: Nudge[], fresh: { nudge: Nudge; at: number } | null, blocked: boolean) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => readSet(DISMISSED_KEY));
  const [seen, setSeen] = useState<Set<string>>(() => readSet(SEEN_KEY));
  const [index, setIndex] = useState(0);
  const [auto, setAuto] = useState(false);
  const [near, setNear] = useState(false);
  const [hidden, setHidden] = useState(false); // Esc: stay quiet until the pointer or focus leaves

  const list = nudges.filter((n) => !dismissed.has(n.id));
  const current = list.length ? list[Math.min(index, list.length - 1)] : undefined;
  const visible = !blocked && !hidden && !!current && (auto || near);
  const unseenAlerts = list.filter((n) => n.kind === "alert" && !seen.has(n.id)).length;

  const latest = useRef({ list, seen, blocked });
  const lastAuto = useRef(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    latest.current = { list, seen, blocked };
  });

  const showAuto = useCallback((at: number | "firstUnseen") => {
    const { list: l, seen: s } = latest.current;
    const i = at === "firstUnseen" ? l.findIndex((n) => !s.has(n.id)) : at;
    setIndex(Math.max(i, 0));
    setHidden(false);
    setAuto(true);
    lastAuto.current = Date.now();
    try {
      sessionStorage.setItem(COUNT_KEY, String(readCount() + 1));
    } catch {
      /* count then lives only in this page load */
    }
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setAuto(false), SHOW_MS);
  }, []);

  // Mark what is on screen as seen.
  const currentId = visible ? current?.id : undefined;
  useEffect(() => {
    if (!currentId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seen-ness follows what is on screen, not a prop
    setSeen((prev) => {
      if (prev.has(currentId)) return prev;
      const next = new Set(prev).add(currentId);
      writeSet(SEEN_KEY, next);
      return next;
    });
  }, [currentId]);

  // Random unprompted nudge, 45-120 s apart, only with something unseen.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const arm = () => {
      t = setTimeout(fire, MIN_GAP_MS + Math.random() * (MAX_GAP_MS - MIN_GAP_MS));
    };
    const fire = () => {
      const { list: l, seen: s, blocked: b } = latest.current;
      const ok = !b && !isTyping() && !document.hidden && Date.now() - lastAuto.current >= COOLDOWN_MS && readCount() < MAX_PER_SESSION && l.some((n) => !s.has(n.id));
      if (ok) showAuto("firstUnseen");
      arm();
    };
    arm();
    return () => clearTimeout(t);
  }, [showAuto]);

  // A brand-new alert may appear straight away (not while typing, not with the panel open).
  useEffect(() => {
    if (!fresh || latest.current.blocked || isTyping() || document.hidden || readCount() >= MAX_PER_SESSION) return;
    const i = latest.current.list.findIndex((n) => n.id === fresh.nudge.id);
    if (i >= 0) showAuto(i);
  }, [fresh, showAuto]);

  useEffect(() => () => {
    clearTimeout(hideTimer.current);
    clearTimeout(leaveTimer.current);
  }, []);

  const nearRef = useRef(false);
  const enter = useCallback(() => {
    clearTimeout(leaveTimer.current);
    if (!nearRef.current) {
      const { list: l, seen: s } = latest.current;
      setIndex(Math.max(l.findIndex((n) => !s.has(n.id)), 0)); // top unseen, else the first
    }
    nearRef.current = true;
    setNear(true);
  }, []);
  const leave = useCallback(() => {
    clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => {
      nearRef.current = false;
      setNear(false);
      setHidden(false);
    }, LEAVE_MS);
  }, []);

  return {
    current,
    list,
    index: current ? list.indexOf(current) : 0,
    visible,
    autoShown: auto && !near,
    unseenAlerts,
    enter,
    leave,
    hide: () => {
      nearRef.current = false;
      setAuto(false);
      setNear(false);
      setHidden(true);
    },
    step: (d: number) => setIndex((i) => (list.length ? (Math.min(i, list.length - 1) + d + list.length) % list.length : 0)),
    go: setIndex,
    dismiss: (id: string) =>
      setDismissed((prev) => {
        const next = new Set(prev).add(id);
        writeSet(DISMISSED_KEY, next);
        return next;
      }),
  };
}
