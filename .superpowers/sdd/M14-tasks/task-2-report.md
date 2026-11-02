Packet: M14-T2 Migration 0076 part 1 — events table, RLS, status guards
Files changed: supabase/migrations/20261028000076_student_lifecycle.sql (new),
tests/db/lifecycle-rls.test.ts (new), tests/db/academics.test.ts (C-13 step
rewritten), tests/security/rls-expectations.ts (+student_lifecycle_events),
src/lib/db/types.ts (regen)
Behavior: student_lifecycle_events table (checks, partial unique tc_no,
index, set_updated_at + block_mutation), SELECT-only RLS (07 §2.2
student.read shape, 0025 initPlan helpers). app.guard_enrolment_status /
app.guard_student_status BEFORE triggers force status changes through the
app.allow_lifecycle GUC; bypass only service_role/postgres.
Tests run: pnpm db:reset, pnpm db:types (clean) → pnpm test:db
tests/db/lifecycle-rls.test.ts tests/db/academics.test.ts → 2 files, 10
passed → pnpm test:security → 18 files, 1547 passed → pnpm lint clean →
pnpm typecheck clean.
Tests not run: tests/db/lifecycle-promote-rpc.test.ts etc. (T3-T5, not
written yet — append to same migration file next).
Limitations/honesty: n/a (no UI).
Security/integration risks: none found; guard triggers verified to reject
admin/owner direct status writes and non-active inserts, accept
postgres-session writes (seed path), RLS scoped correctly to
guardian/teacher/accountant.
Follow-ups: T3 promote_students, T4 exit_student, T5 link_guardian append
to this same file in strict order.
New dependencies: none.
Assumptions: profiles.id == auth user id (confirmed via 0002's trigger) used
as created_by in tests.
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
