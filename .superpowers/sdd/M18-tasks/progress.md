# M18 ledger — Backup/restore drill + ops

Plan: `docs/planning/fabric/06-backend-packets/M18-tasks.md`. Spec: `07-master-plan` §3 M18, DBT-10. Rulings live in the task-file header. No migration. No new deps.

Routing: T1 haiku none [] ; T2 sonnet tests [1] ; T3 sonnet none [1] ; T4 sonnet exclusive [2,3] ; T5 haiku none [4]
Parallel: T1 → T2 ‖ T3 → T4 → T5. T2 is `tests` because it reads the shared local DB: a pg_dump snapshot plus count(*), no writes.

## Planning facts (verified 2026-11-02, no DB commands)
- No host pg_dump/psql/createdb; Docker present; Supabase CLI 2.122.0. `db dump` runs pg_dump in the CLI image. The flags `--role-only`, `--data-only`, `--use-copy`, `-s`, `-x`, `--dry-run`, `--db-url` all exist. `--workdir`, `start -x`, `stop --no-backup` and `stop --project-id` exist.
- The CLI's embedded data-dump script prefixes `SET session_replication_role = replica;`, uses `--column-inserts`, comments out psql `\restrict`, and excludes only the auth/storage migration tables (so auth and storage data are included). The schema dump excludes auth, storage, extensions, cron, net, vault and supabase_migrations.
- Hosted runs pg_cron, pg_net and vault (`scripts/hosted-schedule-jobs.ts`). Hence the data-dump schema allowlist `public,app,auth,storage`.
- 0067 puts policies on `storage.objects`. The schema dump drops them, so they are regenerated in `managed.sql` from `pg_policies`.
- `backups/` is already gitignored. `vitest.config.mts` loads `.env.local` without overriding env that is already set. db tests do not shell out to the supabase CLI. The seed tests spawn demo-reset with the inherited env.
- Second DB name on 54322 rejected: PostgREST/GoTrue/Storage serve only the stack's `postgres` DB → second stack `coolschool-drill` on 553NN.

## Tasks
(none started)
## Tasks
- 2026-11-04 T1 DONE (37 unit); T3 dispatched; T2 waits for M12-T2 exclusive
- T3 DONE (6 unit)
- T2 DONE (40 unit, manual dump ok); T4 (exclusive) waits for M12 db tasks to finish
