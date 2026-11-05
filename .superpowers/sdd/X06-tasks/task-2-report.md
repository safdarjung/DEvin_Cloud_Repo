Packet: X06-T2 Migration 0088 part A — tables, RLS, grants, app.module_catalog insert

Files changed:
- supabase/migrations/20261028000088_exam_seating.sql (new)
- tests/db/exam-seating-rls.test.ts (new)
- src/lib/db/types.ts (raw `pnpm db:types` regen, additive)
- tests/security/rls-expectations.ts (2 entries: exam_seating_plans, exam_seats)

Behavior implemented: exam_seating_plans + exam_seats tables, checks, unique/partial-unique indexes, set_updated_at triggers, RLS (owner/principal/admin/exam_controller all versions; guardian/student current-header-only on plans, own-seat-in-current-plan on seats), explicit grants (select to authenticated; full CRUD service_role; none to anon — no write policy, T3 generator writes), app.module_catalog upsert for `exam_seating` (default_enabled false). Did not touch app.module_enabled (0084, hosted-applied): verified module-enabled-sql.test.ts still passes since exam_seating's own catalog default (false) coincides with its unmet-requires result.

Tests run: `pnpm db:reset` ok; `pnpm db:types` ok; `pnpm test:db tests/db/exam-seating-rls.test.ts` → 8/8 pass; `pnpm test:db tests/db/module-enabled-sql.test.ts` → 8/8 pass; `pnpm test:security` → 2216/2219 pass, 3 fail (membership-status, public-enquiry-route, website-schema — all pre-existing, unrelated files, 5s timeout under full-suite connection load; all 3 pass in isolation, confirmed not caused by this change). `pnpm lint` clean; `pnpm typecheck` 0 errors.

Limitations / honesty label: n/a (DB layer only, no UI).

Security / integration risks: demo_reset (0001, hosted-applied) nulls self-ref FKs generically; a plain partial-unique index (vs. marks/results' deferrable guard trigger) can't bypass via app.allow_reset, so a superseded seating chain would collide during demo_reset if left in place — test cleanup deletes seating rows explicitly before cleanup() to avoid it. Same risk exists for any real demo-tenant data with >1 plan version; none seeded by this packet (Replaces fixture: none).

Follow-ups: T3 (generate_seating_plan, same migration file, appends only).

New dependencies: none.

Assumptions made: rooms jsonb in test fixtures is a placeholder shape ({room_id, seats}); T3 owns real resolved-room values. Partial unique index chosen literally per ruling text (not a constraint trigger) — matches marks/results' own note that deferred behavior needs a trigger, not an index.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
