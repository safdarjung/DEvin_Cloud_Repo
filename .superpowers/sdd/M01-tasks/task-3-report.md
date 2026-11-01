# Task 3 report: M01-T3 Action manifest + registry completeness

Status: DONE

## Files changed
- `src/app/api/v1/actions/all-actions.ts` (new) — side-effect imports of all 10 `*actions.ts` modules, same list as `tests/security/escalation.test.ts`. One comment: "every new action file must be imported here". No other exports.
- `tests/unit/action-names-unique.test.ts` (edit) — added `vi.mock("@/lib/supabase/server", ...)` opt-in mock import and one new `it`: "every defineAction name is registered after importing the dispatcher manifest". Reuses existing `walk`/`DEFINE_ACTION_NAME` regex to statically collect names, imports `all-actions`, then asserts `new Set(getRegisteredActions().keys())` equals the statically collected name set.

## TDD
RED: ran `pnpm test tests/unit/action-names-unique.test.ts` before creating `all-actions.ts` — new test failed with `Error: Cannot find package '@/app/api/v1/actions/all-actions'`. Old test still passed (1 failed | 1 passed).
GREEN: created `all-actions.ts`, reran same command — `Test Files 1 passed (1)`, `Tests 2 passed (2)`.

## Tests run
- `pnpm test tests/unit/action-names-unique.test.ts` → 2 passed (1 test file).
- `pnpm lint` → clean.
- `pnpm typecheck` → clean (`next typegen && tsc --noEmit`, no errors).

## Not run
- `pnpm test:db`, `pnpm test:security`, `pnpm test:e2e` — out of scope (unit tests only per task facts; not this packet's DB ownership).

## Limitations / honesty label
None — no UI/simulated surface touched.

## Security / integration risks
None identified. `all-actions.ts` is import-only (no exports beyond side effects), matches the existing escalation-test import list, so the HTTP dispatcher (future M01 task) and the security suite stay in sync by construction.

## Follow-ups
None for this task. The actual HTTP dispatcher route that imports `all-actions.ts` is a separate M01 task (not T3's scope per the brief's EXPORTS line).

## New dependencies
None.

## Assumptions
- Import list order/content mirrors `tests/security/escalation.test.ts` exactly (10 modules), per brief instruction "same list as escalation.test.ts".
- Test's `vi.mock` placement follows the pattern already used in `escalation.test.ts` (opt-in mock before any `@/modules/**`/`@/lib/actions/registry` import; here imports are deferred via dynamic `await import()` inside the test body since the mock only needs to be registered before the dynamic imports execute).
