# X06 security review findings

Source: review pass on X06 (CoolSkool), logged verbatim before fixing.

## MEDIUM — docs/planning/coolskool/07-security-and-ai-governance.md

§2.2 permission matrix now has two consecutive 'leave.approve (never own)' rows (lines 92 and 94) and the 'leave.request (s = own leave)' row was deleted outright by this diff (likely a merge collision with the concurrent X02-certificates edit landing in the same working tree). `leave.request` is still a real permission in src/lib/auth/permissions.ts (granted to owner/principal/admin/teacher/admissions/accountant/exam_controller) but is now undocumented, and the duplicate row is dead weight. Fix: restore the leave.request row and remove the duplicate leave.approve line before merge.

## LOW — src/modules/exam-seating/schemas.ts

`slotStart` uses `z.string().datetime({ offset: true })` instead of the ruling's `z.iso.datetime({ offset: true })` (Task 4 report calls this out as a deliberate deviation, citing M11 precedent). Functionally equivalent in zod 4.6.7 (same alias used in src/modules/website/schemas.ts) and no validation gap found, but it diverges from the written spec — worth a one-line note or alignment pass, not a security defect.

## LOW — src/modules/exam-seating/queries.ts

`examSeating.chart` / `.chartHtml` carry permission `exam.seating.read`, which per the ruling is also granted to student/guardian. `getSeatingChart` queries `rooms` with the caller's own session (fine — rooms RLS already lets any member read room names) and builds the per-room seat list purely from whatever `exam_seats` rows RLS returns to that role, so a guardian/student calling this query sees only their own child's single seat inside an otherwise-full room, with a footer count ('N students seated') that reflects the RLS-filtered count, not the true room occupancy. Not a confidentiality leak (no other student's data is exposed), but task-6's own completion report flags this path as 'not exercised for guardian/student in this packet's tests' — recommend an explicit test (or restricting these two query defs to the staff role set) so the behavior is intentional rather than incidental.

## LOW — supabase/migrations/20261028000088_exam_seating.sql

In `app.generate_seating_plan`, the duplicate-room-id check and the room-existence check cast `elem ->> 'room_id'` to `uuid` (and later `seats` to `int`) before any format validation of those JSON fields. A direct RPC caller (authenticated/service_role — the grant allows both) sending a non-UUID `room_id` or non-numeric `seats` gets an unhandled Postgres cast error instead of a clean `code:validation_failed`. `mapSqlError`'s generic fallback still prevents raw SQL text from reaching the client (logs a correlation id and returns 'internal'), so this is a robustness/UX gap, not an information-disclosure or authorization bug — the normal TS action path is already protected by `GenerateSeatingSchema`'s uuid/int checks before this RPC is ever called.

---

## Outcomes

- **MEDIUM (07-security-and-ai-governance.md matrix)** — fixed. Restored `leave.request (s = own leave)` row (own/pri/adm/ads/acc/exc/tch = s) before `leave.approve`, deleted the duplicate `leave.approve` row. Matches `src/lib/auth/permissions.ts` grants and the existing `tests/unit/permissions.test.ts` matrix snapshot (already passing, unchanged).

- **LOW (exam-seating/schemas.ts datetime alias)** — fixed. Changed `slotStart: z.string().datetime({ offset: true })` to `z.iso.datetime({ offset: true })`, matching the ruling and the precedent in `src/modules/exams/schemas.ts` / `src/modules/fabric/spec/schemas.ts`. Confirmed functionally identical in zod 4.6.7 before changing. `tests/unit/exam-seating-schemas.test.ts` → 12/12 pass.

- **LOW (exam-seating/queries.ts guardian/student chart scoping)** — fixed via test, no code change. Added a case to `tests/db/exam-seating-queries.test.ts` (guardian calls `examSeatingChartQuery` on a current plan) asserting the room comes back with exactly the guardian's child's seat, confirming the RLS-derived scoping is intentional and pinned. Left the query defs on `exam.seating.read` (not restricted to staff) since the ruling grants that permission to student/guardian and the behavior is correct, just previously untested. `tests/db/exam-seating-queries.test.ts` → 3/3 pass.

- **LOW (20261028000088_exam_seating.sql generate_seating_plan cast robustness)** — fixed. Migration not yet hosted (only ≤0084 is HOSTED-APPLIED), edited in place: added a format-validation `if exists` block (regex check on `room_id` as uuid, `seats` as digits) before any `::uuid`/`::int` cast, raising `code:validation_failed` instead of an unhandled Postgres cast error. Added two cases to `tests/db/exam-seating-generate.test.ts` (non-uuid `room_id`, non-numeric `seats`) asserting `code:validation_failed`. `pnpm db:reset` applied cleanly; `tests/db/exam-seating-generate.test.ts` → 6/6 pass.

Full rerun of this milestone's test files (per task reports, after `pnpm db:reset` + reseed):
- `pnpm test:db tests/db/exam-seating-generate.test.ts` → 6/6 pass
- `pnpm test:db tests/db/exam-seating-queries.test.ts` → 3/3 pass
- `pnpm test:db tests/db/exam-seating-rls.test.ts` → 8/8 pass
- `pnpm test:db tests/db/exam-seating-actions.test.ts` → 5/5 pass
- `pnpm test:db tests/db/exam-seating-html.test.ts` → 1/1 pass
- `pnpm test:db tests/db/exam-seating-acceptance.test.ts` → 2/2 pass
- `pnpm test:db tests/db/seed-exam-seating.test.ts` → 4/4 pass
- `pnpm test:db tests/db/api-query-route.test.ts` → 7/7 pass
- `pnpm test tests/unit/exam-seating-schemas.test.ts` → 12/12 pass
- `pnpm test tests/unit/exam-seating-html.test.ts` → 9/9 pass
- `pnpm test tests/unit/permissions.test.ts` → 19/19 pass (matrix doc fix matches existing snapshot)
- `pnpm test:security tests/security/grants.test.ts tests/security/escalation.test.ts tests/security/module-gate.test.ts` → 1326/1326 pass
- `pnpm lint` → clean
- `pnpm typecheck` → 0 errors

No git state changes made. No new dependencies.
