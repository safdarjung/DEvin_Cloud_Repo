# M18 — Backup/restore drill + ops

Source: `07-master-plan-v1-v2.md` §3 M18; debt DBT-10 (`12-decision-log.md` §3). **No migration** (no `10-backlog-index.md` claim). **No new deps:** Supabase CLI 2.122 (`pnpm exec supabase`), Docker, and `postgres` (postgres.js) are already installed. This machine has **no host `pg_dump`/`psql`/`createdb`**: every dump runs in the CLI's own Docker image (`supabase db dump`), and restore loads the SQL through postgres.js `.simple()` (multi-statement simple protocol, `node_modules/postgres/README.md` §simple). New files: ops scripts under `scripts/` (plain Node type-stripping: erasable TS only, relative `.ts` imports, no `@/`, as `scripts/demo-reset.ts`). Fixtures replaced: none. The hosted drill is owner-run (T5 writes the commands). No agent task touches hosted.

Rulings:
- **Location and naming.** One directory per backup: `backups/<UTC YYYYMMDDTHHMMSSZ>-<label>/`, label `^[a-z0-9-]{1,20}$` (default `local`; `hosted` for the owner's hosted runs). `backups/` is already in `.gitignore`. Directory mode `0700`, files `0600`. Contents: `roles.sql`, `schema.sql`, `data.sql`, `managed.sql`, `manifest.json`, and `drill.json` after a drill. The throwaway drill workdir is `backups/.drill/` (also ignored).
- **What is dumped.** Source = `SUPABASE_DB_URL`, passed as `--db-url` to `pnpm exec supabase db dump` (CLI 2.122 embedded scripts, read from the binary):
  - `--role-only` → `roles.sql` (reserved Supabase roles are commented out by the CLI).
  - The default schema dump → `schema.sql`. It excludes the managed schemas (`auth`, `storage`, `extensions`, `cron`, `net`, `vault`, `realtime`, `supabase_migrations`, …), so it holds `public` + `app` (the repo's only custom schemas) with grants, RLS, functions and triggers.
  - `--data-only -s public,app,auth,storage` → `data.sql`, as INSERTs: no `--use-copy`, so the file is plain SQL that postgres.js can run. The CLI already wraps the file in `SET session_replication_role = replica; … RESET ALL;`, so immutability guards, state guards and FKs do not fire during the load. Including `auth` + `storage` keeps users, identities, buckets and object metadata (the CLI excludes only their migration tables). The schema allowlist keeps platform state out: hosted `cron.job`/`job_run_details`, `net.*` queues, and `vault.secrets` (ciphertext bound to the source project key). Restoring those into another project fails. A new custom schema must be added to `DATA_SCHEMAS`.
  - **Lost by design, so handled:** (a) our objects inside managed schemas. Today these are the 0067 `storage.objects` policies `tenant_docs_select`/`tenant_docs_insert`. `managed.sql` regenerates every `pg_policies` row in `auth`/`storage` at backup time (`drop policy if exists` + `create policy`). If a future migration adds a trigger or function in `auth`/`storage`, it must extend `managed.sql` in the same PR. (b) Migration history: `manifest.appliedMigrations` records it, and a hosted restore runs `migration repair` (runbook). (c) Hosted pg_cron + pg_net + the vaulted `CRON_SECRET`: a hosted restore re-runs `scripts/hosted-schedule-jobs.ts`. (d) Project settings (Auth site URL, confirmations): set again by hand (11 §4 step 3).
  - **Storage object bytes (bucket `tenant-docs`) are in no dump.** Only the `storage.objects` metadata rows are. Locally the bytes are test data. On hosted, the owner can copy them with `supabase storage cp -r … --experimental` (11 §6). New debt row.
  - Only `pgcrypto` is created by migrations, and every Supabase project preinstalls it. A migration that adds an extension must add it to the restore notes.
- **Manifest** (`manifest.json`): `{label, startedAt, finishedAt, cliVersion, source: {host, port, database}` (never user or password)`, appliedMigrations: string[]` (empty if `supabase_migrations.schema_migrations` is absent)`, files: [{name, bytes, sha256, ms}], counts: {"schema.table": [before, after]}}`. Counts are exact `count(*)` for every base table in `public`/`app` plus `auth.users`, `auth.identities`, `storage.buckets` and `storage.objects`, taken before and after the dumps. On a busy hosted DB the range covers concurrent writes. Locally the two values are equal.
- **Restore** (`scripts/db-restore.ts <backupDir>`). The target comes only from `RESTORE_DB_URL`, never `SUPABASE_DB_URL`, so `.env.local` can never aim it at the shared DB. Steps, in this order:
  1. Refuse before any connection when the target is unset or unparseable, uses port `54322` (the shared local stack), or uses a non-loopback host, unless `RESTORE_ALLOW_REMOTE_HOST` equals the URL hostname exactly.
  2. Refuse when a file's sha256 differs from the manifest.
  3. Connect. Refuse when the target `public` schema has any table (fresh targets only). This check is also what protects a live hosted project.
  4. Load `roles → schema → data → managed` in **one transaction**, so a failure leaves the target fresh and the restore can be re-run.
  5. Run the parity check: every manifest table's restored count must fall within `[min, max]` of its pair. Exit 1 on any mismatch.
- **Fresh local DB = a second throwaway Supabase stack, never the shared one (`db=exclusive`).** A second database name on the shared server (`createdb` on 54322) cannot work: `pnpm test:db` needs PostgREST + GoTrue + Storage, and those serve only the stack's `postgres` database. The drill (`scripts/db-drill.ts`) works like this:
  - It writes `backups/.drill/supabase/config.toml` = `drillConfig(repo config)`: `project_id = "coolschool-drill"`, every `543NN` port becomes `553NN` (API 55321, DB 55322, shadow 55320, pooler 55329, studio 55323, mailpit 55324, analytics 55327), `inspector_port` 8083 becomes 8183, and `[db.seed] enabled = false`. It also creates an empty `supabase/migrations/`, so the stack starts with managed schemas only.
  - It starts the stack: `pnpm exec supabase --workdir backups/.drill start -x studio,imgproxy,mailpit,edge-runtime,logflare,vector,supavisor,postgres-meta`. The distinct project_id gives distinct containers, volumes and network. The shared `coolschool` stack keeps running untouched.
  - It reads `supabase --workdir backups/.drill status -o json` in memory and maps `API_URL` → `NEXT_PUBLIC_SUPABASE_URL`, `PUBLISHABLE_KEY` (else `ANON_KEY`) → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SECRET_KEY` (else `SERVICE_ROLE_KEY`) → `SUPABASE_SECRET_KEY`, and `DB_URL` → `SUPABASE_DB_URL` + `RESTORE_DB_URL`. It aborts if any of these contains `:54321` or `:54322`.
  - The child env overrides all four variables for the restore and `pnpm test:db` children. `vitest.config.mts`'s `.env.local` loader only fills unset keys. Node's `--env-file` never overrides existing env. The demo-reset children of the seed tests inherit `process.env`. So every test hits the drill stack.
  - Teardown always runs `pnpm exec supabase --workdir backups/.drill stop --no-backup` in `finally`, unless `--keep` is passed. **Never `supabase stop` without `--workdir backups/.drill`, never `--all`, never `--project-id coolschool`: those delete the shared DB volume.**
- **RPO/RTO** (11 §6; DBT-10 closes on these targets plus the hosted drill record):
  - Hosted demo (free tier has no platform backups, so these dumps are the only backups): **RPO ≤ 24 h** (the owner runs `db:backup --label hosted` daily and before every `db push`). **RTO ≤ 2 h** (new project → restore → migration repair → cron jobs → Vercel env swap → smoke J-00).
  - Drill bar: backup + stack start + restore + parity ≤ 30 min at seed scale. A miss becomes a debt row.
  - First real school: Supabase Pro daily backups (PITR as an owner cost decision) become primary, and these dumps become the off-platform copy (weekly and before every push).
  - Retention: the newest 14 backup directories. The owner prunes by hand (no pruning code).
- **Secrets.**
  - Scripts never print or write DB URLs, passwords or keys. They print paths, byte counts, sha256 values, durations, table names and counts only.
  - The URL reaches the CLI as one `execFileSync` argv element (no shell, so no shell history). Child stdout/stderr is piped, and anything echoed passes through `redactDbUrl` first.
  - `supabase start` and `status` stdout print keys, so that output is never echoed.
  - On a SQL error, print `code` + `message` only, never `detail`/`query`/`where`: they can hold row values (PII).
  - Dumps hold PII and `auth.users` password hashes, so they are secret-class files: gitignored, never attached to chats/issues, and encrypted for any off-laptop copy.
  - Hosted credentials live only in `.env.production.local` (gitignored by `.env.*`). Agents never receive or `cat` env files, and run no hosted command.
- **Exports contract** between scripts: `db-backup.ts` stdout ends with `backup: <dir>`. `db-restore.ts` stdout ends with `restore: ok <n> tables <ms> ms`. Exit code 1 on any failure.

Routing: T1 haiku none [] ; T2 sonnet tests [1] ; T3 sonnet none [1] ; T4 sonnet exclusive [2,3] ; T5 haiku none [4]

Parallel: T1 → T2 ‖ T3 → T4 → T5. T2 = `tests` because it reads the shared local DB: a snapshot dump plus `count(*)`, no writes. It is safe beside db test runs, but not during an exclusive task. Only T4 edits `package.json`, which avoids parallel edits.

---

### Task 1: M18-T1 Backup helpers (Haiku)
READ: BRIEF-COMMON.md; rulings; `scripts/lib/admin-client.ts` (style); `tests/unit/seed-lib.test.ts` (a unit test importing `scripts/`)
FILES: `scripts/lib/backup.ts` (new; pure, `node:*` imports only); `tests/unit/backup-lib.test.ts` (new)
EXPORTS:
- `DATA_SCHEMAS = ["public","app","auth","storage"] as const`
- `DRILL_PROJECT_ID = "coolschool-drill"`
- `DRILL_EXCLUDES = "studio,imgproxy,mailpit,edge-runtime,logflare,vector,supavisor,postgres-meta"`
- `SHARED_LOCAL_DB_PORT = "54322"`
- `backupDirName(now: Date, label: string): string` → `20261102T093005Z-local`; throws on a label outside `^[a-z0-9-]{1,20}$`
- `quoteIdent(name: string): string` → `"` + name with `"` doubled + `"`
- `isLoopbackHost(hostname: string): boolean` → true for `127.0.0.1`, `localhost`, `::1`, `[::1]`
- `redactDbUrl(text: string, dbUrl: string): string` → replaces the full URL and the password (raw and percent-decoded) with `***`. It skips the bare-password replacement when the password is empty or the public local default `postgres`.
- `assertRestoreTarget(dbUrl: string | undefined, allowRemoteHost?: string): URL` → throws `Error`s whose message never contains the URL. Throw cases: unset or unparseable; port `54322`, even with an allow; non-loopback host unless `allowRemoteHost === url.hostname`.
- `drillConfig(configToml: string): string` → per rulings; replaces `enabled = true` only inside the `[db.seed]` section
- `type PolicyRow = {schemaname, tablename, policyname: string; permissive: "PERMISSIVE" | "RESTRICTIVE"; roles: string[]; cmd: string; qual: string | null; with_check: string | null}`
- `policyDdl(row: PolicyRow): string` → `drop policy if exists "p" on "s"."t";\ncreate policy "p" on "s"."t" as permissive for select to "authenticated" using (…) with check (…);`. The role `public` stays unquoted. The `using`/`with check` clauses are omitted when null.
- `sha256File(path: string): string` (hex)
- `countsMismatch(expected: Record<string, [number, number]>, actual: Record<string, number>): string[]` → `"public.students: expected 252–252, got 0"`; a missing table reads `got missing`
TEST FIRST:
- name for 2026-11-02T09:30:05.123Z/local; label `../x` throws
- redacts a hosted-style URL with an `%40`-encoded password (both forms gone); keeps the word "postgres" for a local URL
- target unset / port 54322 / `db.example.invalid` without allow → throw, and the message never contains the URL; `127.0.0.1:55322` passes; a remote host with a matching allow passes
- `drillConfig(readFileSync("supabase/config.toml"))` contains `project_id = "coolschool-drill"`, `port = 55322`, `inspector_port = 8183`, and no `543\d\d`; its `[db.seed]` has `enabled = false`; `[api]`'s `enabled = true` is untouched
- `policyDdl` quotes identifiers, leaves `public` unquoted, and omits null clauses
- `countsMismatch` flags an out-of-range and a missing table, and passes one within `[before, after]`
ACCEPT: `pnpm test tests/unit/backup-lib.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 2: M18-T2 `scripts/db-backup.ts`
READ: BRIEF-COMMON.md; rulings; T1 lib; `scripts/demo-reset.ts`; `scripts/hosted-schedule-jobs.ts` (postgres.js `ssl: "require"` for hosted). Before coding, run `pnpm exec supabase db dump --db-url "$SUPABASE_DB_URL" --data-only -s public,app,auth,storage --dry-run` **against local only**. Confirm the `--schema` pattern and the auth/storage inclusion. Paste only the pg_dump flag lines into the report.
FILES: `scripts/db-backup.ts` (new); `tests/unit/db-backup-cli.test.ts` (new)
EXPORTS: CLI `node --env-file-if-exists=.env.local scripts/db-backup.ts [--label <l>] [--out <dir>]` (default out `backups`). Steps:
1. Require `SUPABASE_DB_URL`. Create `<out>/<backupDirName>` with mode 0700.
2. Open a postgres.js connection (`max: 1`; `ssl: isLoopbackHost ? false : "require"`). Run the before-counts (tables from `information_schema.tables` per rulings; `count(*)` via `quoteIdent`), `appliedMigrations` (guard with `to_regclass('supabase_migrations.schema_migrations')`), and the `pg_policies` rows where `schemaname in ('auth','storage')`. Write `managed.sql` from `policyDdl`.
3. Run three `execFileSync("pnpm", ["exec","supabase","db","dump","--db-url", url, …, "-f", file], {stdio: ["ignore","pipe","pipe"]})` calls, timed: `--role-only` → roles.sql; none → schema.sql; `--data-only -s public,app,auth,storage` → data.sql. On error, print `redactDbUrl(stderr)` and exit 1.
4. Take the after-counts. Get `cliVersion` from `pnpm exec supabase --version` (stdout first line). Chmod every file 0600. Write `manifest.json`. Print one line per file (name, bytes, ms), then `backup: <dir>`.
TEST FIRST (spawn `node scripts/db-backup.ts`; build the child env as `{PATH}` plus overrides, never spreading `process.env`, because vitest loaded `.env.local`; `--out` = a `mkdtemp` dir):
- `SUPABASE_DB_URL` unset → exit 1, and the out dir stays empty
- label `../x` → exit 1
- a URL with password `s3cr3t-pass` and an unreachable port (`127.0.0.1:1`) → exit 1, and stdout + stderr never contain `s3cr3t-pass`
ACCEPT:
- `pnpm test tests/unit/db-backup-cli.test.ts tests/unit/backup-lib.test.ts`
- `node --env-file-if-exists=.env.local scripts/db-backup.ts --label t2` (shared local, read-only) → five files. `managed.sql` contains `tenant_docs_select` and `tenant_docs_insert`. `manifest.json` has counts for `public.students` and `auth.users` and `appliedMigrations` ending in the newest applied version. `grep -c "postgres:postgres@" <dir>/*` = 0. `stat -c %a` gives 700 for the dir and 600 for the files. Then `rm -rf` that dir.
- `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 3: M18-T3 `scripts/db-restore.ts`
READ: BRIEF-COMMON.md; rulings; T1 lib; `node_modules/postgres/README.md` (`.simple()`, `unsafe`, `begin`)
FILES: `scripts/db-restore.ts` (new); `tests/unit/db-restore-cli.test.ts` (new)
EXPORTS: CLI `node scripts/db-restore.ts <backupDir>`. Steps, in order:
1. `assertRestoreTarget(RESTORE_DB_URL, RESTORE_ALLOW_REMOTE_HOST)`.
2. Check that the dir has `manifest.json` + the 4 `.sql` files and that each sha256 matches.
3. Connect (`max: 1`, ssl per `isLoopbackHost`). Run the fresh-target check (`pg_tables` in `public` = 0, else exit 1 with "target not fresh").
4. In `sql.begin`, load each file in the order roles, schema, data, managed via `tx.unsafe(text).simple()`, timed per file.
5. Run `countsMismatch` against the restored counts → exit 1 listing the mismatches. Otherwise print `restore: ok <n> tables <ms> ms`.
- SQL errors print `code` + `message` only.
- If `roles.sql` fails on a fresh stack because of a reserved Supabase role, stop and report it. Do not hand-patch dumps.
TEST FIRST (spawn; env `{PATH}` + overrides; no case reaches a DB):
- `RESTORE_DB_URL` unset → exit 1
- `postgresql://postgres:s3cr3t-pass@127.0.0.1:54322/postgres` → exit 1 with "shared local", and the output has no `s3cr3t-pass`
- host `db.example.invalid` without an allow → exit 1
- with `RESTORE_ALLOW_REMOTE_HOST=other.invalid` → exit 1
- with a matching allow and a missing backup dir → exit 1 on the dir check (proves the order: guard → files → connect)
- a manifest whose sha256 differs from the file → exit 1 "checksum"
ACCEPT: `pnpm test tests/unit/db-restore-cli.test.ts`; `pnpm lint`; `pnpm typecheck` (the real load is proven in T4)
REPLACES FIXTURE: none

### Task 4: M18-T4 `scripts/db-drill.ts` + local drill (**exclusive**: no other agent may touch the local DB during this task)
READ: BRIEF-COMMON.md; rulings (the fresh-local-DB and secrets bullets in full); T1–T3 scripts; `vitest.config.mts` (`.env.local` loader); `tests/db/seed-determinism.test.ts` (child env)
FILES: `scripts/db-drill.ts` (new); `package.json` (scripts `db:backup`, `db:restore`, `db:drill` = `node --env-file-if-exists=.env.local scripts/<name>.ts`)
EXPORTS: CLI `pnpm db:drill [--from <backupDir>] [--skip-tests] [--keep]`. Steps:
1. Write the drill workdir (`drillConfig`, empty migrations dir). Assert that the drill project_id ≠ the repo `project_id`.
2. Unless `--from` is given, spawn `node scripts/db-backup.ts --label drill` with the parent env (shared local source) and parse `backup: <dir>`.
3. Start the drill stack (`--workdir`, `-x DRILL_EXCLUDES`; stdout discarded). Read the status JSON, map the env, and assert there is no `:54321`/`:54322`.
4. Spawn `node scripts/db-restore.ts <dir>` with the drill env.
5. Unless `--skip-tests`, run `pnpm test:db --reporter=default --reporter=json --outputFile.json=<dir>/testdb.json` with the four variables overridden. Check the flag syntax against the installed vitest.
6. In `finally`, run `stop --no-backup --workdir backups/.drill` unless `--keep`.
7. Write `<dir>/drill.json` `{startedAt, source, phases: {backupMs?, startMs, restoreMs, testDbMs?, stopMs, totalMs}, parity: "ok", testDb?: {total, passed, failed, failedFiles}}` and print the phases.
TEST FIRST: none new (pure logic in T1, guards in T2/T3); the drill run is the test.
ACCEPT:
1. Record `docker exec supabase_db_coolschool psql -U postgres -tAc "select count(*) from public.audit_events"` before the drill.
2. `pnpm db:drill` → exit 0 and parity ok. Every failed test file is re-run alone against the shared DB (`pnpm test:db tests/db/<file>.test.ts`, no `--`). Only failures that also fail there are allowed (pre-existing, e.g. DBT-46); name them. Any other failure is a restore defect: fix it (two-attempt rule).
3. After the drill, the shared `audit_events` count is unchanged (proves test:db never hit the shared DB).
4. `docker ps -a --format '{{.Names}}' | grep -c coolschool-drill` = 0 and `docker volume ls -q | grep -c coolschool-drill` = 0, while `supabase_db_coolschool` is still Up.
5. `pnpm test tests/unit/backup-lib.test.ts tests/unit/db-backup-cli.test.ts tests/unit/db-restore-cli.test.ts`; `pnpm lint`; `pnpm typecheck`.
6. The report carries `drill.json` phases + `data.sql` MB + test:db counts (T5 copies them).
7. Delete the backup dirs created in T2–T4.
REPLACES FIXTURE: none

### Task 5: M18-T5 Ops docs (Haiku)
READ: rulings; T4 report (timings); `docs/planning/coolskool/11-operations.md` §1, §4, §6, §11; `12-decision-log.md` §3 (DBT-10 row, last DBT number)
FILES: `docs/planning/coolskool/11-operations.md`; `docs/planning/coolskool/12-decision-log.md`; `.env.example` (append only: `RESTORE_DB_URL`, `RESTORE_ALLOW_REMOTE_HOST` names + one-line comments, no values). Files 2 and 3 have other milestones' uncommitted edits: append/edit only your lines, and the controller commits the hunks.
EXPORTS:
- **§1**: two env rows (`RESTORE_DB_URL` = restore target, fresh DB only; `RESTORE_ALLOW_REMOTE_HOST` = exact hostname for a non-local restore).
- **§6 rewritten**, in this order:
  - (a) What a backup holds and does not hold (rulings: managed.sql, storage bytes, migration history, cron/vault).
  - (b) RPO/RTO + retention (rulings).
  - (c) Local commands: `pnpm db:backup [--label x]`, `pnpm db:drill`, `RESTORE_DB_URL=… pnpm db:restore <dir>`.
  - (d) **Hosted drill (owner-run)**, exact steps:
    1. Docker running. `.env.production.local` holds `SUPABASE_DB_URL` = the dashboard **Session pooler** URI (port 5432, password percent-encoded; the direct host is IPv6-only). Never paste it into chat or agents.
    2. `node --env-file=.env.production.local scripts/db-backup.ts --label hosted`.
    3. Optional: `pnpm exec supabase storage cp -r ss:///tenant-docs backups/<dir>/storage --linked --experimental` (check `--help` first).
    4. `pnpm db:drill --from backups/<dir> --skip-tests`. Restoring into the throwaway local stack only, the hosted DB is only read.
    5. Fill one timing row.
    6. Keep the dir as the latest backup (encrypt any off-laptop copy) or delete it.
  - (e) **Hosted disaster restore (owner-run, not drilled destructively):**
    1. New Supabase project in ap-south-1.
    2. Put `RESTORE_DB_URL` (the new project's Session pooler URI) and `RESTORE_ALLOW_REMOTE_HOST` (its pooler hostname) in `.env.restore.local` (gitignored). Never set them inline, because inline values land in shell history. Then run `node --env-file=.env.restore.local scripts/db-restore.ts backups/<dir>`. The fresh-target check refuses the live project.
    3. `pnpm exec supabase link --project-ref <new-ref>`, then `pnpm exec supabase migration repair --status applied <manifest.appliedMigrations…>`, then `pnpm exec supabase migration list --linked`.
    4. `node --env-file=.env.production.local scripts/hosted-schedule-jobs.ts` (new project values).
    5. Storage bytes back with `storage cp -r backups/<dir>/storage ss:///tenant-docs --linked --experimental`.
    6. Auth settings per §4 step 3.
    7. Vercel env swap + redeploy.
    8. Smoke J-00/J-01.
  - (f) **Drill log table** with header `| Date | Operator | Source | data.sql MB | Backup min | Stack start min | Restore+parity min | test:db pass/fail | Total min | Within bar (≤30 min)? | Notes |`. Fill one row with T4's local numbers; leave one empty `hosted` row for the owner.
- **§11**: "backups policy and retention" → "platform backups (Supabase Pro daily / PITR): owner decision before the first real school".
- **12 §3**: update the DBT-10 row (scripts + local drill done; RPO 24 h / RTO 2 h defined in 11 §6; remaining: hosted drill row, platform backups before the first real school). Add two rows at the next free DBT numbers (grep first, because other milestones add rows): storage object bytes not in the DB dump (manual experimental `storage cp`; trigger: first real school uploads documents); hosted backups depend on the owner running them from a laptop (trigger: first real school → Pro backups/PITR or a scheduled job with a read-only role).
ACCEPT: `pnpm lint` (no code touched); every command in §6 matches the script flags in T2–T4; no secret values anywhere (`grep -nE "sb_secret_|sb_publishable_|postgres:[^@]+@[^1]" docs/planning/coolskool/11-operations.md` → none)
REPLACES FIXTURE: none

---

Controller after T5: one Sonnet security review of the T1–T4 diff. Focus: secret echo paths, child-process argv/env, restore guards, and the `stop --no-backup` scope. Fix CRIT/HIGH/MED. Then the full gate, commit/push, and `DONE M18 <sha>`. No hosted push (no migration). The owner runs the 11 §6 hosted drill and fills its row. DBT-10 closes on that row.
