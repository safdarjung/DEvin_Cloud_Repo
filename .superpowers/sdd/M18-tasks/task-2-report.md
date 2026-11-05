Packet: M18-T2 scripts/db-backup.ts
Files changed: scripts/db-backup.ts (new), tests/unit/db-backup-cli.test.ts (new)
Behavior implemented: CLI dumps SUPABASE_DB_URL via `supabase db dump` (role-only, schema, data -s public,app,auth,storage) into <out>/<backupDirName>, dir 0700/files 0600; writes managed.sql from pg_policies(auth,storage) via policyDdl; writes manifest.json (label, cliVersion, source, appliedMigrations, per-file bytes/sha256/ms, before/after counts). Errors redacted via redactDbUrl, exit 1.
pg_dump flags confirmed (dry-run against local only):
  --data-only --quote-all-identifier --role "postgres" --exclude-table auth.schema_migrations --exclude-table storage.migrations --exclude-table supabase_functions.migrations --schema "public|app|auth|storage" --column-inserts --rows-per-insert 100000
  --role-only: pg_dumpall --roles-only --role "postgres" --quote-all-identifier
  schema (no flag): pg_dump --schema-only --quote-all-identifier --exclude-schema "...auth...storage..." (managed schemas excluded, confirming public+app only)
Tests run: pnpm test tests/unit/db-backup-cli.test.ts tests/unit/backup-lib.test.ts -> 40 passed (3 new + 37 T1). Manual acceptance against shared local (read-only, --label t2): 5 files written; managed.sql grep tenant_docs_select/insert = 4 matches; manifest counts has public.students + auth.users; appliedMigrations ends ...000084; grep "postgres:postgres@" across all files = 0; dir stat 700, files stat 600; dir rm -rf'd after.
Tests not run and why: pnpm test:db / full suite (brief: T2 is read-only, no full test:db).
Limitations / honesty label: n/a (ops script, no UI).
Security / integration risks: none found; connection errors and dump stderr both pass through redactDbUrl before printing.
Follow-ups: none.
New dependencies (justification): none.
Assumptions made: default `--label` is "local" per rulings' default naming (not specified verbatim in EXPORTS line, inferred from Rulings "label ... default local").
Lint/typecheck: pnpm typecheck clean. pnpm lint fails on pre-existing error in src/modules/finance/with-service-role.ts (file not touched by this task, other agent's concurrent work) — scoped eslint on my 2 files is clean.
