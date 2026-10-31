// F-BE-04 — localStorage persistence for the Fabric demo store. SSR-safe
// (no-op without `window`); a stored payload from a different schema
// version, or one that fails structural validation, is discarded rather
// than risking a bad hydration.
import { DEMO_STATE_VERSION } from "./state";
import type { DemoState } from "./state";
import { DemoStateSchema } from "./schema";

export const STORAGE_KEY = "fabric-demo:v1";

export function loadState(): DemoState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== DEMO_STATE_VERSION) return null;
    const result = DemoStateSchema.safeParse(parsed);
    if (!result.success) return null;
    return { ...(result.data as unknown as DemoState), hydrated: true };
  } catch {
    return null;
  }
}

export function saveState(state: DemoState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // quota exceeded / private-mode storage unavailable — demo state just won't persist
  }
}

export function exportJson(state: DemoState): string {
  return JSON.stringify(state, null, 2);
}

export interface ParseImportResult {
  ok: boolean;
  state: DemoState | null;
  error: string | null;
}

export function parseImport(text: string): ParseImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, state: null, error: "Invalid JSON" };
  }
  const result = DemoStateSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, state: null, error: result.error.issues[0]?.message ?? "Invalid state" };
  }
  return { ok: true, state: { ...(result.data as unknown as DemoState), hydrated: true }, error: null };
}
