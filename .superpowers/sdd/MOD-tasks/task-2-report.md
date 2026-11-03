Packet: MOD-T2 Module gate in `guardedCall`
Files changed: src/lib/actions/define-action.ts; src/lib/actions/define-query.ts; src/lib/actions/registry.ts; tests/unit/define-action.test.ts
Behavior implemented: `GuardedCallOptions.module?: ModuleKey`; `ActionMeta.module?: ModuleKey` set by both defineAction/defineQuery. Gate in `guardedCall` after ctx resolved (both override + resolved branches), before Zod: `if (opts.module && !isModuleEnabled(ctx, opts.module)) return fail("forbidden", MODULE_DISABLED_MESSAGE)`.
Tests run: `pnpm test tests/unit/define-action.test.ts` → 21 passed (15 pre-existing + 6 new, all RED before impl, GREEN after). `pnpm lint` clean. `pnpm typecheck` clean.
Tests not run and why: none required by packet.
Limitations / honesty label: n/a (no UI).
Security / integration risks: none new; gate fails closed (forbidden) same as permission check. T13 later makes `module` required on Define*Options.
Follow-ups: none.
New dependencies (justification): none.
Assumptions made: `isModuleEnabled`/`MODULE_DISABLED_MESSAGE`/`ModuleKey` read from `src/lib/modules/catalog.ts` (T1, found already present uncommitted). Did not touch T1/T3/T4 files (entitlements.ts, require.ts, nav.ts, schemas.ts) — those are other agents' concurrent work per git status.
