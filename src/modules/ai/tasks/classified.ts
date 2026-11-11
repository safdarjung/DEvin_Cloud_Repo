import "server-only";
// Orb task bridge — the full classified task (entities, human-only, generated
// paths) and the action's Zod schema, from the live registry. Only the chat
// tools and the proposal actions need these; taskState never does.
import "@/app/api/v1/actions/all-actions"; // every action registered before getActionMeta() is read
import { getActionMeta, type ActionMeta } from "@/lib/actions/registry";
import { catalogRow } from "./catalog";
import { classify } from "./derive";
import type { ClassifiedTask } from "./types";

const classified = new Map<string, ClassifiedTask | null>();

/** The merged catalog row for a classified, registered action; undefined for excluded, unclassified or unregistered names. */
export function classifiedTask(action: string): ClassifiedTask | undefined {
  if (!classified.has(action)) {
    const row = catalogRow(action);
    const meta = getActionMeta().get(action);
    classified.set(action, row && row.excluded === undefined && meta ? classify(action, meta, row) : null);
  }
  return classified.get(action) ?? undefined;
}

export function taskActionMeta(action: string): ActionMeta | undefined {
  return getActionMeta().get(action);
}
