Packet: X06-T3 Migration 0088 part B — `generate_seating_plan`

Files changed:
- supabase/migrations/20261028000088_exam_seating.sql (appended, not yet merged)
- tests/db/exam-seating-generate.test.ts (new)
- src/lib/db/types.ts (raw `pnpm db:types` regen, additive)
- tests/security/grants.test.ts (added `public.generate_seating_plan` to PUBLIC_AUTHENTICATED)
- docs/planning/coolskool/07-security-and-ai-governance.md §4 (one row)

Behavior implemented: `app.generate_seating_plan` + `public.generate_seating_plan` wrapper (0069 publish_timetable split, 0044 service_role-claim bypass). Checks in order: unauthenticated / exam not found in institution / forbidden (exam_write_roles, skipped for service_role) / exam published / slot started / no paper at slot / rooms shape+dup+institution+capacity (validation_failed) / zero students (invalid_state) / students>seats (conflict). Seats via `(roll_no/admission_no rank, same-name-section rank k, grade sort_key)` order into rooms in array order; supersedes prior current version in one transaction; `unique_violation` → conflict; audits `exam.seating.generated` with ids/counts only.

Tests run: `pnpm db:reset` ok (migration applies cleanly); `pnpm test:db tests/db/exam-seating-generate.test.ts` → 6/6 pass; `pnpm test:db tests/db/exam-seating-rls.test.ts` → 8/8 pass (unaffected); `pnpm test:security tests/security/grants.test.ts` → 9/9 pass after expectations update (said above); `pnpm lint` clean; `pnpm typecheck` 0 errors.

Limitations / honesty label: n/a (DB layer only).

Security / integration risks: same demo_reset/partial-unique-index interaction as T2 (regenerate leaves 2 versions); test's happy-path/regenerate case deletes seating rows explicitly before `inst.cleanup()`, mirroring T2's `cleanupSeatingFixture`. No module check in SQL (by design — rulings: "Not module-checked (MOD: not a security boundary)"; T5 gates in TS).

Follow-ups: T5 (action `examSeating.generate`, module gate + C-03 fixture + `all-actions.ts`).

New dependencies: none.

Assumptions made: `k` = `dense_rank()` by section name within grade (same-named sections across grades share k, matching the 6A/7A/8A/6B/7B/8B example literally). Audit `before`/`after` left null; all data in `metadata` (matches 0014 attendance_submit's shape for a non-before/after event).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
