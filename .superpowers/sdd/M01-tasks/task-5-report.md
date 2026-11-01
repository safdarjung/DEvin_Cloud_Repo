# Task 5 report — M01-T5 Registry metadata (schema + permission)

## Files changed
- `src/lib/actions/registry.ts` — added `ActionMeta` type, `metaRegistry` map, `registerAction(name, action, meta?)` optional 3rd arg, new `getActionMeta()` export. Kept every existing comment verbatim. `getRegisteredActions()` unchanged.
- `src/lib/actions/define-action.ts` — `defineAction` now passes `{ schema, permission }` to `registerAction`; `permission` is `null` when `opts.permission` is a function (06 §1.2).
- `tests/unit/define-action.test.ts` — added 2 tests per brief: "defineAction records its schema and static permission", "function permission is recorded as null".

## TDD
RED: ran `pnpm test tests/unit/define-action.test.ts tests/unit/action-names-unique.test.ts` with tests added but no impl change → 2 failed (`getActionMeta is not a function`), 12 passed.
GREEN: after registry.ts + define-action.ts changes → same command, 14 passed, 0 failed.

## Accept criteria
- `pnpm test tests/unit/define-action.test.ts tests/unit/action-names-unique.test.ts` → 14 passed.
- `pnpm lint` → clean.
- `pnpm typecheck` → clean (route types generated, tsc --noEmit clean).

## Design notes
- `ActionMeta = { schema: z.ZodType; permission: Permission | null }` exactly as brief specifies.
- `registerAction`'s "first registration wins" behavior preserved: meta is only set alongside a name that wasn't already registered (the `if (registry.has(name)) return;` early-return still guards both maps together).
- `getRegisteredActions()` signature/return untouched — escalation suite (`tests/security/escalation.test.ts`) and dispatcher route unaffected.
- Import of `Permission`/`z` types added at top of registry.ts (no cycle: `src/lib/auth/permissions.ts` has zero imports).

## Scope
Touched only the 3 files named in the brief. No other files, no formatting/renaming elsewhere.

## New dependencies
None.

## Assumptions
None needed — brief's exact value spec (`ActionMeta`, `getActionMeta()` signature) was unambiguous.
