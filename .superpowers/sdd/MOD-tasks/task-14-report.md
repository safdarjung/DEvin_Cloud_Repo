# MOD-T14 Completion Report

**Packet:** MOD-T14 Seed: demo tenant all modules on
**Files changed:** `scripts/seed/sections/core.ts`, `tests/db/seed-modules.test.ts`

## Behavior implemented

Demo tenant institution created with `settings.modules` set to `allModulesOn()`, enabling every optional module by default. Test verifies the seeded tenant matches the expected module state.

## Tests run

- `pnpm test:db tests/db/seed-modules.test.ts` → 2 passed
- `pnpm test:db tests/db/seed-determinism.test.ts` → 1 passed
- `DEMO_RESET_ALLOWED=true pnpm demo:reset` → seed completed in 48063ms
- `pnpm lint` → clean
- `pnpm typecheck` → clean

## Tests not run and why

None. Task requires only verification of seeded state.

## Limitations / honesty label

None.

## Security / integration risks

None. No new permissions, RLS, or security boundaries introduced.

## Follow-ups

None.

## New dependencies

None.

## Assumptions made

- `allModulesOn()` returns correct shape per T1 implementation
- `InstitutionSettingsSchema.parse()` validates the merged object correctly
