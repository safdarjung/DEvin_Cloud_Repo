"use client";

// F-BE-04 — module-level client store for the Fabric demo. Phase 2 swaps
// this file for real queries/mutations without touching callers (the
// `DemoState`/`DemoIntent` contract stays the same).
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { DemoIntent } from "./reducer";
import { reduce } from "./reducer";
import { loadState, saveState } from "./persist";
import type { DemoState } from "./state";
import { initialState } from "./state";

let state: DemoState = initialState();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getState(): DemoState {
  return state;
}

export function dispatch(intent: DemoIntent): void {
  const next = reduce(state, intent);
  if (next === state) return;
  state = next;
  saveState(state);
  emit();
}

/**
 * Injects fixture-derived initial data (fixtures live in a parallel packet;
 * this module never imports them). No-op once the store has hydrated —
 * call it once, before the first `useDemoStore` render, e.g. from app init.
 */
export function initDemoStore(seedData: Partial<DemoState>): void {
  if (state.hydrated) return;
  state = initialState(seedData);
  emit();
}

/**
 * Reads the demo store. `getServerSnapshot` returns the plain (unhydrated)
 * initial state so SSR markup matches the client's first render; a
 * one-time effect after mount then loads localStorage and re-renders.
 * Pick a referentially stable slice in `selector` (e.g. a field or an
 * array already in state) — a freshly-built object/array on every call
 * defeats useSyncExternalStore's reference check.
 */
export function useDemoStore<T>(selector: (state: DemoState) => T): T {
  const selected = useSyncExternalStore(subscribe, () => selector(state), () => selector(state));

  const ranHydration = useRef(false);
  useEffect(() => {
    if (ranHydration.current || state.hydrated) return;
    ranHydration.current = true;
    const loaded = loadState();
    state = loaded ?? { ...state, hydrated: true };
    emit();
  }, []);

  return selected;
}
