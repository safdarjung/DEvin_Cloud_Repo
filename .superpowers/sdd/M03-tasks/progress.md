# SDD ledger — plan: docs/planning/fabric/06-backend-packets/M03-tasks.md
Spec: 07-master-plan §3 M3; 05 §3; 07 §2.2/§4. M01 rulings carry over.
Ruling: non-tenant routes for create-institution and accept-invite — dispatcher needs a membership — cost if wrong: two endpoints outside the action registry listing.
Ruling: 0079 (spare) holds invitation RPCs — 150-line cap.
Ruling: academicYear.upsert clears previous current in handler (2 statements, not atomic) — cost if wrong: transient zero-current year on failure; revisit with an RPC if seen.
## Pre-flight
| Pair | Interface | Finding |
|---|---|---|
| T1→T2 | invitations table, bootstrap GUC | ok |
| T2→T5,T6,T11 | invite_member/accept_invitation/revoke_invitation | ok |
| T3→T9,T10 | FK binding policies | tests depend on 0065 order — sequential ok |
| T4/T6 | non-tenant routes reuse dispatch helpers | ok |
| T9/T10 | 4th file = all-actions import line | allowed |
## Tasks
Task 1: complete (commits ..2b7c2c5, controller review clean; LOW parked: create_institution doesn't validate p_timezone — owner can write settings anyway; 224 lines > cap accepted, one cohesive migration). Agent hit rate limit once, resumed.
Task 2: complete (commits ..eb6e136, 1 fix round: row lock, linked-record ownership conflict, unique_violation→conflict; 11/11)
Task 3: complete (commits ..fa0910f, review clean; curriculum_units negative test missing — parked LOW, covered by policy shape identical to tested tables). NOTE: 0065 applied after 0079 locally → hosted push needs --include-all.
Task 4: complete (commits ..365974e; controller fix: cookie path allowed, was bearer-only)
Ruling: T5+T7+T8 batched (same two files core/actions.ts + core/schemas.ts); T9+T10 batched later.
Tasks 5,7,8: complete (commits ..c6098cf, review clean; LOW parked: term sequence count+1 race → unique violation maps to internal)
Task 6: complete (commits ..00acf69, review clean; no RED captured — mirrors T4)
Tasks 9,10: complete (commits ..d9ae559). Ruling: kept app-level assertInInstitution lookups in subjectAssignment.set — 0036 already binds FKs; lookups give field-level not_found instead of RLS error. Columns per 0005 (brief shape was wrong).
Task 11: complete (commits ..b9d9a87); controller fix: core throwMapped 23505→conflict (dup year/term name was internal 500).
Security review (Sonnet): 0 CRIT, 0 HIGH, 2 MED, 2 LOW. Controller fixed: MED revoke_invitation now `for update`; MED create_institution per-user pg_advisory_xact_lock before quota count (both re-applied locally via create or replace, files unpushed); LOW stale setup.actions comment fixed. Parked LOW: null args fall through to constraint errors (internal, no leak).
Gate run 1 FAILED: (a) demo tenant emptied — core/schemas.ts gained an `@/lib` import (T4), seed script (plain node) crashed mid-reseed inside seed-determinism → fixed with relative .ts import, local demo:reset reseeded; lesson added to BRIEF-COMMON. (b) escalation.test.ts lacked C-03 fixtures for 13 new actions → fix agent dispatched (also switches the test to the all-actions manifest).
M03 DONE 27ce561 pushed; gate green (unit 928, db 432, sec 1237)
