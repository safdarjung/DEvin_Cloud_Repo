Packet: M14-T4 Migration 0076 part 3 — exit_student (TC snapshot, portal access)
Files changed: supabase/migrations/20261028000076_student_lifecycle.sql (append); tests/db/lifecycle-exit-rpc.test.ts (new); src/lib/db/types.ts (db:types regen)
Behavior implemented: public.exit_student(p_student_id, p_kind, p_reason, p_left_on?, p_destination_school?, p_conduct?) definer. Validates role/status/kind/destination/reason/left_on, builds tc_no via app.next_sequence (seeds settings.numbering.tc_no on first use), builds tc_snapshot from rows (grade/section/year/admitted_on/primary guardian/dues_outstanding), sets enrolment+student withdrawn under app.allow_lifecycle, disables the student's own membership and any guardian with no other active child, revokes their pending invitations, skips the caller's own membership (0033/0038 guard), audits lifecycle.<kind>.
Tests run: pnpm db:reset; pnpm db:types; pnpm test:db tests/db/lifecycle-exit-rpc.test.ts → 7/7 pass. Also re-ran tests/db/lifecycle-promote-rpc.test.ts + lifecycle-rls.test.ts → 14/14 pass (no regression). pnpm lint, pnpm typecheck → clean.
Tests not run and why: pnpm test:security — not in T4's ACCEPT line; other milestones' files are mid-edit in this tree (not my db:owner scope).
Limitations / honesty label: n/a (no UI, no simulated/limited channel).
Security / integration risks: none new — RLS unaffected (no policy added; function is table-owner definer, same shape as promote_students). Self-edit guard explicitly respected.
Follow-ups: none.
New dependencies (justification): none.
Assumptions made: enrolment_status_history row is written automatically by the existing AFTER UPDATE trigger app.enrolment_status_changed (0005); exit_student does not insert it directly, matching promote_students precedent.
