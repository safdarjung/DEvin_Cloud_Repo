# X01-T4 Migration 0085 part 1 — completion report

Packet: X01-T4 Migration 0085 part 1 — student leave, pre-mark, `app.module_catalog` insert
Files changed:
- `supabase/migrations/20261028000085_student_leave_diary.sql` (new)
- `tests/db/student-leave-rls.test.ts` (new)
- `src/lib/db/types.ts` (regen, raw `pnpm db:types`)
- `tests/security/rls-expectations.ts` (+1 entry: `student_leave_requests`)
- `tests/security/grants.test.ts` (+`public.decide_student_leave` to `PUBLIC_AUTHENTICATED`)
- `docs/planning/coolskool/07-security-and-ai-governance.md` (+1 §4 row)

Behavior implemented: `student_leave_requests` table + guard (section from enrolment, 7-day lookback, overlap conflict, identity immutable); `app.premark_student_leave` (OL pre-mark across open/submitted/no-session/holiday/Sunday/period cases); `public.decide_student_leave`/`app.decide_student_leave` state machine (approve/reject by admin or class teacher, cancel by requester only, all terminal); `app.module_catalog` rows for `student_leave`, `diary`.

Tests run: `pnpm test:db tests/db/student-leave-rls.test.ts` → 20/20 passed. `pnpm test:security` → 2200/2200 passed. `pnpm lint` → clean. `pnpm typecheck` → clean.

Tests not run and why: `pnpm db:reset` + `pnpm db:types` already run as part of this task (reseed completed).

Limitations / honesty label: none; no UI, no honesty badge applicable.

Security / integration risks: `tests/db/module-enabled-sql.test.ts` fails pre-existingly — `MODULE_KEYS` already carries `ptm` (added by a concurrent X08 lane task in this shared tree) but no `app.module_catalog` row exists for it yet (its migration 0099 hasn't landed). Not caused by this packet; resolves once X08 lands 0099's insert.

Follow-ups: X01-T5 appends diary part 2 to this same migration file.

New dependencies: none.

Assumptions made: cancel path for student leave is requester-only (ruling differs from staff `decide_leave`, which also lets an approver cancel); 07 §4 row added since `decide_student_leave` is a new `authenticated`-granted public RPC (grants.test.ts asserts an explicit list).
