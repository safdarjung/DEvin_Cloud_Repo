Packet: T-M14-T5 Migration 0076 part 4 — link_guardian
Files changed: supabase/migrations/20261028000076_student_lifecycle.sql (append); tests/db/guardian-link-rpc.test.ts (new); src/lib/db/types.ts (regen)
Behavior implemented: public.link_guardian(student_id, relationship, is_primary, guardian_id?, full_name?, phone?, email?) — SECURITY DEFINER (DBT-45, bypasses RLS recursion). Exactly one of guardian_id / (full_name+phone); cross-institution guardian_id -> validation_failed; new guardian found-by-phone reused untouched, else inserted; is_primary clears the student's old primary first; upsert on (guardian_id, student_id) conflict updates relationship/is_primary; audit ids only. Role gate: owner/principal/admin/admissions.
Tests run: pnpm test:db tests/db/guardian-link-rpc.test.ts -> 7/7 pass. pnpm lint (file) clean. pnpm typecheck clean.
Tests not run and why: full pnpm test:db / test:security (brief: non-owner-style scope here was DB owner for this step but ran only this task's file per lane concurrency; other tasks' suites covered by their own packets).
Limitations / honesty label: none (no simulated/limited UI surface in this RPC).
Security / integration risks: DBT-45 cycle not fixed, only avoided via SECURITY DEFINER (per ruling, not in scope). Audit entity_type "guardian", action "people.guardian.link" — T7's TS action layer must not duplicate this audit call.
Follow-ups: T6/T7 wire TS actions (lifecycle.*, people.guardian.link) over this RPC; T10 docs the definer + DBT-45 debt row.
New dependencies (justification): none
Assumptions made: audit action string "people.guardian.link" (matches <module>.<entity>.<verb> precedent in people/actions.ts); entity_type "guardian", entity_id = guardian id, metadata {studentId, created}.
