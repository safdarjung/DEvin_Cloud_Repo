### Task 1: M02-T1 defineQuery + query registry
READ: BRIEF-COMMON.md; `src/lib/actions/{define-action,registry}.ts`; `tests/unit/define-action.test.ts`
FILES: `src/lib/actions/define-action.ts` (edit); `src/lib/actions/define-query.ts` (new); `tests/unit/define-query.test.ts` (new)
EXPORTS: in define-action.ts move the guard body (ctx resolve incl. VITEST-gated `overrideCtx`, Zod parse, permission, handler, error mapping) into `export function guardedCall<I, O>(opts): Action<O>` with no registration; `defineAction` = `guardedCall` + `registerAction` (behaviour unchanged, all existing comments kept). define-query.ts: `defineQuery<I, O>(opts: { name; schema; permission; handler(input, ctx) })` = `guardedCall` + register in a module-private map; `getRegisteredQueries(): ReadonlyMap<string, AnyAction>`; `getQueryMeta(): ReadonlyMap<string, ActionMeta>` (reuse `ActionMeta`). First registration wins. Not a `"use server"` file.
TEST FIRST: "defineQuery returns ok(data) for a permitted ctx"; "missing permission → forbidden"; "bad input → validation_failed"; "query registers in getRegisteredQueries, not getRegisteredActions"; "meta records schema + static permission". Existing `define-action.test.ts` stays green untouched.
ACCEPT: `pnpm test tests/unit/define-query.test.ts tests/unit/define-action.test.ts`; `pnpm lint`; `pnpm typecheck`

