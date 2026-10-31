import type { z } from "zod";
import type { Permission } from "@/lib/auth/permissions";

// Every action defineAction() creates registers itself here by name so the
// C-03 escalation suite can call every action as every role (06 §1.2).
export type AnyAction = (institutionSlug: string, raw: unknown) => Promise<unknown>;

// M01-T5: metadata for GET /api/v1/actions (M01-T6). permission is null when
// it's a function of input (06 §1.2) — the manifest can't resolve that
// statically.
export type ActionMeta = { schema: z.ZodType; permission: Permission | null };

const registry = new Map<string, AnyAction>();
const metaRegistry = new Map<string, ActionMeta>();

// T-028 phase 2 (found debugging a j03/j04 e2e regression, root-caused — not
// weakened): Next 16.4's dev server (Turbopack) builds one "server actions"
// loader module PER ROUTE, re-evaluating the WHOLE shared source file's
// top level (the "use server" directive is file-granular, not per-export)
// for every route that reaches any export from it. A module file with
// several defineAction() calls, used from two different routes (e.g.
// admissions/actions.ts: /admissions uses updateEnquiryStatus,
// /admissions/applications/[id] uses decideApplication + enrolApplicant),
// gets its top level re-run once per route against this ONE process-wide
// `registry` Map — a legitimate re-registration of the same name from the
// same source, not a genuine naming collision between two unrelated
// actions. The hard throw (removed) turned that into a 500 on whichever
// route rendered second. No current test relies on the throw — the real
// "no two actions share a name" check (C-03) is T-042's, not yet built;
// when it lands, prefer a static check over this module's load-time path.
export function registerAction(name: string, action: AnyAction, meta?: ActionMeta): void {
  if (registry.has(name)) return;
  registry.set(name, action);
  if (meta) metaRegistry.set(name, meta);
}

export function getRegisteredActions(): ReadonlyMap<string, AnyAction> {
  return registry;
}

export function getActionMeta(): ReadonlyMap<string, ActionMeta> {
  return metaRegistry;
}
