"use client";
// Tiny shared store: stacked cards learn when the proposal they wait for is approved.
import { useSyncExternalStore } from "react";

export type Resolution = { status: "approved" | "discarded"; resultHref?: string };

let resolved: ReadonlyMap<string, Resolution> = new Map();
let aliases: ReadonlyMap<string, string> = new Map();
const listeners = new Set<() => void>();

export function markResolved(proposalId: string, r: Resolution): void {
  resolved = new Map(resolved).set(proposalId, r);
  for (const l of listeners) l();
}

/** Test helper. */
export function resetResolutions(): void {
  resolved = new Map();
  aliases = new Map();
  for (const l of listeners) l();
}

/** A card adopted a new proposal (a section picked on an empty register): cards waiting on `oldId` now wait on `newId`. */
export function markReplaced(oldId: string, newId: string): void {
  aliases = new Map(aliases).set(oldId, newId);
  for (const l of listeners) l();
}

/** Follows replacements to the current proposal id. */
export function canonicalId(id: string): string {
  let cur = id;
  for (let i = 0; i < 10 && aliases.has(cur); i++) cur = aliases.get(cur)!;
  return cur;
}

export function getResolution(proposalId: string | undefined): Resolution | undefined {
  return proposalId ? resolved.get(canonicalId(proposalId)) : undefined;
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};

export function useResolution(proposalId: string | undefined): Resolution | undefined {
  return useSyncExternalStore(subscribe, () => getResolution(proposalId), () => undefined);
}

/** Resolutions for a list of proposals (stack "Approve all" bookkeeping). */
export function useResolutions(ids: readonly string[]): ReadonlySet<string> {
  const snap = useSyncExternalStore(subscribe, () => resolved, () => resolved);
  return new Set(ids.filter((id) => snap.has(canonicalId(id))));
}
