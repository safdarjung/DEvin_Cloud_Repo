Packet: T-M09-T5 Documents: enable submission entity in requestUpload
Files changed: src/modules/documents/actions.ts (edit: ENTITY_TABLE.submission = "assignment_submissions"; drop "not supported yet" throw; insert 42501 -> forbidden); tests/db/submission-documents.test.ts (new)
Behavior implemented: requestUpload/confirmUpload/delete now accept entityType "submission" — visibility check reuses RLS on assignment_submissions (own row only); any documents-insert RLS denial (42501) now maps to forbidden instead of internal (covers graded/foreign submission AND entityType "student" by a student, same fix).
Tests run: pnpm test:db tests/db/submission-documents.test.ts tests/db/documents-upload-actions.test.ts -> 12/12 pass · pnpm test:security tests/security/escalation.test.ts -> 842/842 pass · pnpm lint -> clean on touched files (1 pre-existing warning in untouched src/modules/people/hr.queries.ts) · pnpm typecheck -> clean on touched files (2 pre-existing errors in untouched src/modules/academics/curriculum.actions.ts and src/modules/timetable/substitution.actions.ts, other agents' concurrent work)
Tests not run and why: none skipped (full ACCEPT line run)
Limitations / honesty label: no new badge, real feature per ruling. No new names exported, matches packet.
Security / integration risks: none — relies entirely on T2's migration 0071 RLS (documents_insert submission branch, assignment_submissions_select); no RLS/permission change made here.
Follow-ups: none
New dependencies (justification): none
Assumptions made: forbidden-mapping on 42501 applied generically (not submission-specific) since the RLS violation shape is identical for entityType "student" by a student — ruling's wording ("student on a graded/foreign submission") is the motivating case, not an exclusivity constraint.
