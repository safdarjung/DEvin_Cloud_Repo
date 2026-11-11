"use client";

import { useEffect, useState } from "react";
import type { Nudge } from "@/modules/ai/nudges";

const POLL_MS = 90_000;
const MAX_BACKOFF_MS = 600_000;

function isNudge(x: unknown): x is Nudge {
  const n = x as Nudge;
  return !!n && typeof n.id === "string" && typeof n.text === "string" && typeof n.href === "string" && typeof n.ask === "string" && ["alert", "suggestion", "insight"].includes(n.kind);
}

/** Polls the nudge query every 90 s while the tab is visible (doubling on errors). `fresh` is an alert that was not in the previous fetch. Failures show nothing new. */
export function useNudges(slug: string): { nudges: Nudge[]; fresh: { nudge: Nudge; at: number } | null } {
  const [nudges, setNudges] = useState<Nudge[]>([]);
  const [fresh, setFresh] = useState<{ nudge: Nudge; at: number } | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ctl: AbortController | undefined;
    let known: Set<string> | null = null; // null until the first fetch: that one is the baseline, not "new"
    let failures = 0;
    // The query route validates `input` against the query schema; without it the input is undefined and fails.
    const url = `/api/v1/query/ai.askNudges?institution=${encodeURIComponent(slug)}&input=%7B%7D`;

    const schedule = () => {
      if (document.hidden) return;
      timer = setTimeout(() => void load(), Math.min(POLL_MS * 2 ** failures, MAX_BACKOFF_MS));
    };
    async function load() {
      clearTimeout(timer);
      ctl?.abort();
      ctl = new AbortController();
      try {
        const res = await fetch(url, { signal: ctl.signal, cache: "no-store", credentials: "same-origin" });
        const body: unknown = res.ok ? await res.json() : null;
        const data = (body as { ok?: boolean; data?: unknown } | null)?.data;
        if (!(body as { ok?: boolean } | null)?.ok || !Array.isArray(data)) throw new Error("nudges unavailable");
        const list = data.filter(isNudge).slice(0, 8);
        failures = 0;
        const added = known ? list.find((n) => n.kind === "alert" && !known!.has(n.id)) : undefined;
        known = new Set(list.map((n) => n.id));
        setNudges(list);
        if (added) setFresh({ nudge: added, at: Date.now() });
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        failures += 1; // keep whatever is already shown; show nothing new
      }
      schedule();
    }
    const onVisibility = () => {
      if (document.hidden) {
        clearTimeout(timer);
        ctl?.abort();
      } else void load();
    };

    void load();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimeout(timer);
      ctl?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [slug]);

  return { nudges, fresh };
}
