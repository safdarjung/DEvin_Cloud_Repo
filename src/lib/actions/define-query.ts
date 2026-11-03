import { guardedCall, type Action, type GuardedCallOptions } from "@/lib/actions/define-action";
import type { ActionMeta, AnyAction } from "@/lib/actions/registry";
import type { ModuleKey } from "@/lib/modules/catalog";

interface DefineQueryOptions<I, O> extends GuardedCallOptions<I, O> {
  /** Also the query registry key (M02 — GET /api/v1/query/<name>). */
  name: string;
  /** Required (MOD-T13): every query declares its module, core keys included. */
  module: ModuleKey;
}

// Separate from the action registry (src/lib/actions/registry.ts): queries
// and actions are distinct namespaces exposed on different routes.
const queryRegistry = new Map<string, AnyAction>();
const queryMetaRegistry = new Map<string, ActionMeta>();

export function defineQuery<I, O>(opts: DefineQueryOptions<I, O>): Action<O> {
  const query = guardedCall(opts);
  // First registration wins (mirrors registerAction — see registry.ts for why).
  if (!queryRegistry.has(opts.name)) {
    queryRegistry.set(opts.name, query as AnyAction);
    queryMetaRegistry.set(opts.name, {
      schema: opts.schema,
      permission: typeof opts.permission === "function" ? null : opts.permission,
      module: opts.module,
    });
  }
  return query;
}

export function getRegisteredQueries(): ReadonlyMap<string, AnyAction> {
  return queryRegistry;
}

export function getQueryMeta(): ReadonlyMap<string, ActionMeta> {
  return queryMetaRegistry;
}
