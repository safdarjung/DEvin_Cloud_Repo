# T-002 — Supabase local dev + env + type generation + CI workflow

| Field | Value |
|---|---|
| Lane / Day | Lead / Day 1 |
| Size | 0.5 agent-days |
| Critical path | yes |
| Review | code-reviewer |
| Feature ids | F-IDN-01, F-PLT-05 |
| Depends on | T-001 (merged) |
| Migration | — |

## Business outcome
Every agent and CI run can boot an identical local Supabase, apply migrations, regenerate types, and run the DB/security suites without manual steps.

## Current repo state (verify before starting)
- T-001 scaffold present: `test -f package.json && grep '"db:start"' package.json`.
- Docker running: `docker info >/dev/null && echo ok`.
- Supabase CLI not yet a dependency: `grep -c '"supabase"' package.json` → 0.

## Spec sections to read (only these)
- `CLAUDE.md`: Commands, Folder conventions (`supabase/`, `src/lib/db/types.ts`).
- `11-operations.md §1` (env names), `§2` (ports, `api.schemas`).
- `12-decision-log.md` D3, D23 and §2 rows "Supabase CLI", "Supabase CI".
- `08-testing-and-acceptance.md §1` (what CI must run).

## Files to inspect first
- `package.json` scripts stubs from T-001; `.env.example`; `vitest.config.mts`.

## Expected changes
- `pnpm add -D supabase`; `pnpm supabase init` → `supabase/config.toml`, `supabase/seed.sql` (leave empty; TS seed is T-012).
- `supabase/config.toml`: `[api] schemas = ["public","storage","graphql_public"]` (never `app`), `[auth] enable_signup = false`, `[auth.email] enable_confirmations = false`, site_url `http://localhost:3000`.
- Scripts: `db:start` → `supabase start`; `db:stop` → `supabase stop`; `db:reset` → `supabase db reset && pnpm db:types && pnpm seed`; `db:types` → `supabase gen types typescript --local > src/lib/db/types.ts`; `db:migration:new` → `supabase migration new`.
- `src/lib/db/types.ts` generated (empty schema now) and committed; `src/lib/db/index.ts` exporting `Database`, `Tables<T>` helpers.
- `.env.example`: confirm `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_DB_URL` comments state the local defaults printed by `supabase start`.
- `.github/workflows/ci.yml`: on push/PR → checkout, pnpm 11 + Node 22, `pnpm install --frozen-lockfile`, `supabase/setup-cli@v3`, `supabase start`, write local keys into env, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:db`, `pnpm test:security`, `pnpm build`.
- `.github/workflows/secrets.yml`: `gitleaks/gitleaks-action` on push/PR (C-91).
- `README.md`: "Local setup" block mirroring `11 §2` (link, do not restate details).

## Must not modify
- `docs/**`, `CLAUDE.md`, `src/app/**`.

## Permissions / nav / migration numbers needed from the lead
- None.

## Security and data-integrity requirements
- Keys printed by `supabase start` go only into `.env.local` (git-ignored) and CI env; never into committed files or logs.
- `app` schema must not be in `api.schemas` (D4, `05 §5`).

## Acceptance criteria
1. `pnpm db:start` boots; API on 54321, DB on 54322, Studio on 54323.
2. `pnpm db:types` writes `src/lib/db/types.ts` without error; file committed.
3. `pnpm db:reset` succeeds (seed stub may print "not implemented" and exit 0 for now — adjust the stub to exit 0 until T-012).
4. CI workflow passes on an empty suite (push to a branch and observe, or `act` locally if available; otherwise report "not run").
5. `config.toml` does not expose `app`; signup disabled; confirmations off.
6. Record which key names the installed CLI prints (legacy anon/service_role vs publishable/secret) under D23 in the completion report (the lead copies it to `12`).

## Tests (write failing tests first) and exact commands
- `tests/db/connection.test.ts` — connects with `SUPABASE_DB_URL`, `select 1`, and asserts `app` is not in `config.toml` schemas (reads the file).
- Commands: `pnpm db:start`, `pnpm db:types`, `pnpm test:db -- tests/db/connection.test.ts`.

## Deliverables
- Supabase config, scripts, generated types, CI + secret-scan workflows, README setup block, completion report.

## Assumptions and risks
- `gen types` flag spelling is unverified (`12 §2`); use `pnpm supabase gen types --help` and record the exact command.
- Local CLI may print both key families; map both to the env names in `11 §1`.
- Docker memory on the laptop: if `supabase start` fails, report rather than tune Docker.

## Completion report
Use the format in `CLAUDE.md`.
