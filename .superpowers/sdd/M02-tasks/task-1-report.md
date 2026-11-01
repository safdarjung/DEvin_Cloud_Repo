# M02-T1 defineQuery + query registry — report

## Files changed
- `src/lib/actions/define-action.ts` (edit): extracted the guard body into exported `guardedCall<I,O>(opts: GuardedCallOptions<I,O>): Action<O>` — ctx resolve (incl. VITEST-gated `overrideCtx`), Zod parse, permission check, handler call, error mapping, all comments unchanged. `defineAction` is now `guardedCall(opts) + registerAction(...)`, same behavior. `Action<O>` and `GuardedCallOptions<I,O>` now exported for define-query.ts.
- `src/lib/actions/define-query.ts` (new): `defineQuery<I,O>(opts: { name; schema; permission; handler })` = `guardedCall(opts)` + register in a module-private `queryRegistry`/`queryMetaRegistry` (first registration wins, mirrors `registerAction`). `getRegisteredQueries(): ReadonlyMap<string, AnyAction>`, `getQueryMeta(): ReadonlyMap<string, ActionMeta>`. Reuses `ActionMeta`/`AnyAction` from `registry.ts`. No `"use server"` directive.
- `tests/unit/define-query.test.ts` (new): 5 tests per brief — ok(permitted), forbidden, validation_failed, registers in queries-not-actions map, meta records schema+static permission.

## Behavior
defineQuery wraps the same guard pipeline as defineAction but registers into a separate query namespace, keeping queries and actions distinct (06 §1.2 pattern extended for M02's `/api/v1/query/<name>`).

## Tests run
`pnpm test tests/unit/define-query.test.ts tests/unit/define-action.test.ts` (no `--`):
- RED (before define-query.ts existed): define-action.test.ts 12 passed; define-query.test.ts failed to resolve module (as expected).
- GREEN (after implementation): 2 files passed, 17 tests passed total (12 define-action + 5 define-query).

`pnpm lint`: clean. `pnpm typecheck`: clean (`next typegen && tsc --noEmit` succeeded).

## Tests not run
None skipped — unit only, no DB per brief.

## Limitations / honesty label
N/A — no UI, no simulated/limited surface.

## Security / integration risks
None introduced: `guardedCall` is the exact prior `defineAction` body, byte-identical logic, only lifted out of the registration call. The VITEST `overrideCtx` gate and its comment are untouched. Separate query/action registries mean a name can't collide across namespaces — intentional per brief ("not getRegisteredActions").

## Follow-ups
M02-T2+ (route handler, manifest) can build on `getRegisteredQueries`/`getQueryMeta` the same way M01-T4/T5 used the action registry.

## New dependencies
None.

## Assumptions made
- `ActionMeta`/`AnyAction` from registry.ts reused as-is for queries (brief: "reuse `ActionMeta`") — no query-specific meta type created.
- First-registration-wins semantics for queries copied from `registerAction`'s existing Turbopack-re-eval rationale (same module-reload situation applies to query files).
