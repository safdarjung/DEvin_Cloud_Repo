"use client";

// F-BE-19 — client hook for the Laya visual router. Calls
// /api/ai/genui-route once per `state` change; picks the candidate whose
// Laya question scored highest (noul >= 0.5), else candidates[0]. Any
// bridge failure (route returns data:null) falls back the same way, so the
// UI never breaks — just loses the "laya"-sourced pick.
import { useEffect, useState } from "react";

export interface VisualRouteCandidate {
  id: string;
  question: string;
}

export type VisualRouteSource = "laya" | "default";

export interface UseVisualRouteInput {
  institution: string;
  state: string;
  candidates: VisualRouteCandidate[];
}

export interface UseVisualRouteResult {
  variantId: string | null;
  source: VisualRouteSource;
  loading: boolean;
}

const NOUL_THRESHOLD = 0.5;

/**
 * Pure selection: highest-scoring candidate at/above threshold, else the
 * first candidate, else null (no candidates).
 */
export function pickVariant(
  answers: Record<string, { noul: number }> | null,
  candidates: VisualRouteCandidate[],
): { variantId: string | null; source: VisualRouteSource } {
  if (candidates.length === 0) return { variantId: null, source: "default" };

  if (answers) {
    let bestId: string | null = null;
    let bestNoul = -Infinity;
    for (const candidate of candidates) {
      const noul = answers[candidate.id]?.noul;
      if (typeof noul === "number" && noul > bestNoul) {
        bestNoul = noul;
        bestId = candidate.id;
      }
    }
    if (bestId !== null && bestNoul >= NOUL_THRESHOLD) {
      return { variantId: bestId, source: "laya" };
    }
  }

  return { variantId: candidates[0].id, source: "default" };
}

interface FetchState {
  forKey: string;
  answers: Record<string, { noul: number }> | null;
}

// Identifies one (institution, state, candidate-set) request. Compared
// against `fetchState.forKey` to derive `loading` without ever setting it
// synchronously in the effect body (react-hooks/set-state-in-effect) —
// `loading` is true exactly while no response has landed yet for this key.
function requestKey(institution: string, state: string, candidates: VisualRouteCandidate[]): string {
  return JSON.stringify([institution, state, candidates.map((c) => c.id)]);
}

export function useVisualRoute({ institution, state, candidates }: UseVisualRouteInput): UseVisualRouteResult {
  const [fetchState, setFetchState] = useState<FetchState>({ forKey: "", answers: null });

  useEffect(() => {
    if (candidates.length === 0) return undefined;

    const controller = new AbortController();
    const key = requestKey(institution, state, candidates);
    const questions = Object.fromEntries(
      candidates.map((c) => [c.id, { type: "noul" as const, instructions: c.question }]),
    );

    fetch("/api/ai/genui-route", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ institutionSlug: institution, state, questions }),
      signal: controller.signal,
    })
      .then((res) => res.json())
      .then((body: { ok: boolean; data?: Record<string, { noul: number }> | null }) => {
        if (controller.signal.aborted) return;
        setFetchState({ forKey: key, answers: body.ok ? body.data ?? null : null });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setFetchState({ forKey: key, answers: null });
      });

    return () => controller.abort();
  }, [institution, state, candidates]);

  // Empty candidates has nothing to pick or fetch — derived directly,
  // never from fetchState, so a candidates->[] change needs no effect-driven reset.
  if (candidates.length === 0) {
    return { variantId: null, source: "default", loading: false };
  }

  const loading = fetchState.forKey !== requestKey(institution, state, candidates);
  return { ...pickVariant(fetchState.answers, candidates), loading };
}
