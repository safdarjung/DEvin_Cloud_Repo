Packet: T-7 M14-T7 People student/guardian actions (core)
Files changed: src/modules/people/actions.ts; tests/db/people-student-guardian-actions.test.ts (new); tests/security/escalation.test.ts (+3 fixtures)
Behavior implemented: updateStudent/updateGuardian (plain RLS updates, `student.write`, admissionNo/phone 23505->conflict with fieldErrors, 42501->forbidden, 0 rows->not_found, audit holds changedFields names only); linkGuardian (RPC wrapper over 0076 public.link_guardian, create-or-reuse-by-phone, mapSqlError for not_found/forbidden/validation_failed).
Tests run: pnpm test:db tests/db/people-student-guardian-actions.test.ts -> 7 passed; pnpm test:security tests/security/escalation.test.ts -> my 3 fixtures (people.student.update/guardian.update/guardian.link) all pass, no FAIL lines for them; pnpm typecheck -> 0 errors in touched files.
Tests not run and why: pnpm test tests/unit/action-names-unique.test.ts not clean (facilities./transport. query mismatches, unrelated to this task, another agent's concurrent module); not my file.
Limitations / honesty label: n/a, no simulated/limited surface here.
Security / integration risks: none new; RLS using-clause for students/guardians update already matches student.write role set (owner/principal/admin/admissions), so 42501 branch is defensive/untested by DB (can't be hit under current policies) — documented in code comment style of sibling actions.
Follow-ups: none new; T1/T6 already landed schemas/permissions this task reused.
New dependencies (justification): none.
Assumptions made: audit for guardian.link stays SQL-side only (0076's link_guardian already calls app.audit with ids only) per T6 rulings precedent — no TS-side duplicate audit call added.

Pre-existing/concurrent failures observed (not touched by this task, other lanes mid-edit): escalation.test.ts walk fails on `exam.paper.schedule` (missing FIXTURES entry) and action-names-unique.test.ts fails on `facilities.*`/`transport.*` query registry mismatches.
