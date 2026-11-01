# SDD ledger — plan: docs/planning/fabric/06-backend-packets/M05-tasks.md
Spec: 07-master-plan §3 M5. M01–M04 rulings carry over. Plan rulings in the task file header (storage delegated to documents RLS, bucket via migration not config.toml, permissions, soft delete, audited read URL).
## Pre-flight
| Pair | Interface | Finding |
|---|---|---|
| T1→T2..T4 | document.read/write keys | ok |
| T2→T3,T4,T5 | documents table, storage policies | T3 needs the storage INSERT policy to accept the pending row — ok |
| T3→T4 | actions.ts shared | sequential |
## Tasks
Task 1: complete (commits ..c714684, done inline by controller)
Task 2: complete (commits ..2c2163e); controller hardening: documents_insert requires status pending + path under <institution>/<entity_type>/<entity_id>/.
Ruling: T3+T4 batched (one Sonnet, shared actions.ts); T5 acceptance written in parallel by a second Sonnet against the card contract, rerun after T3+T4 land (owner asked for parallel work 2026-11-01).
Ruling: storage SELECT also allows the uploader's own pending object (confirmUpload existence check) — found by parallel T5 agent; controller patched 0067 locally.
Tasks 3,4,5: complete (commits ..f97cabb); T3/T4 and T5 ran in parallel; acceptance green after controller's storage-policy fix.
Security review (Sonnet): 0 CRIT, 0 HIGH, 1 MED, 3 LOW. Controller fixed MED: guard trigger now server-sets deleted_at/deleted_by on active→deleted and freezes them otherwise. Parked LOW: submission entity binding (M9), file_name returned raw (UI must escape), no rate limit (DBT-42).
Gate: unit 956, db 471, security 1325 green.
M05 DONE 665a0ed pushed to git; hosted 0067 push denied by auto-mode classifier (production deploy) — owner to run.
