Packet: M08-T3 Migration 0070 part 2: substitutions + assign/cancel_substitution RPCs + RLS test
Files changed: supabase/migrations/20261028000070_staffing.sql (appended), tests/db/substitutions-rls.test.ts (new), src/lib/db/types.ts (regen), tests/security/rls-expectations.ts (+1 entry), tests/security/grants.test.ts (+2 RPC names, see below)
Behavior implemented: `substitutions` table (RLS-select-only, O class, no write policy), 2 partial unique indexes (slot+date, substitute+date+period), `public.assign_substitution` (11 ordered checks per ruling: auth/not_found/forbidden/invalid_state/validation_failed x2/conflict x3/leave validation), `public.cancel_substitution` (assigned->cancelled, approver-only). app.*/public.* definer split matching 0069/0070-part1 pattern.
Tests run: `pnpm test:db tests/db/substitutions-rls.test.ts tests/db/staff-leave-rls.test.ts` -> 25/25 pass; `pnpm test:security` -> 1513/1513 pass; `pnpm lint` clean; `pnpm typecheck` clean.
Tests not run: full `pnpm test` suite (not asked; only db/security + lint/typecheck per ACCEPT line).
Limitations / honesty label: none (no UI this milestone, per rulings).
Security / integration risks: none found; cross-institution assign returns not_found (slot lookup is institution-blind, matches `not_found/forbidden` either-acceptable per ruling).
Follow-ups: none new; DBT-47..50 (leave race, no notifications, period-attendance gaps, future-substitution version drift) are T15's docs task, not touched here.
New dependencies: none.
Assumptions made: grants.test.ts's `PUBLIC_AUTHENTICATED` static list is a shared-registry-like file (not named in BRIEF-COMMON) but had to be extended with `assign_substitution`/`cancel_substitution` or `test:security` fails — minimal 2-line addition, re-read before editing.
