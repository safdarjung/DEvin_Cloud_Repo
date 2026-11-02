Packet: T-0NN M09-T7 Acceptance over HTTP (submissions)
Files changed: tests/db/submissions-acceptance.test.ts (new)
Behavior implemented: HTTP acceptance — teacher creates+publishes past-due
assignment; student submits (late), resubmits (attempt 2), direct PostgREST
insert with another student's id denied, attaches+confirms a document on
own submission; teacher roster (academics.submissionsForAssignment) shows
submission + documentCount 1; teacher grades (200); accountant grade (403);
resubmit after grading (409 invalid_state); guardian mySubmissions shows
feedback for own child, [] for another family's child.
Tests run: `pnpm test:db tests/db/submissions-acceptance.test.ts` → 1 file,
1 test, passed. `pnpm lint` → clean. `pnpm typecheck` → clean.
Tests not run and why: full test:db/db:reset/seed/db:types — forbidden for
non-DB-owner on this packet; only this file run.
Limitations / honesty label: no SimulatedBadge/LimitedBadge — real feature
per rulings.
Security / integration risks: none found; direct-insert-denied assertion
confirms self-grading hole stays closed (no INSERT policy on
assignment_submissions).
Follow-ups: none new; debt rows already filed under T8.
New dependencies (justification): none.
Assumptions made: T1–T6 (permissions, migration 0071, schemas, actions,
documents submission branch, queries) already landed in the tree exactly as
M09-tasks.md's rulings specify — read, not rebuilt.
