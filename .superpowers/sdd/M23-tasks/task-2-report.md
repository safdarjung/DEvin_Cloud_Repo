Packet: M23-T2 Migration 0096 part 1 — tables, RLS, guards, agent_runs FK

Files changed:
- supabase/migrations/20261028000096_workflows.sql (new)
- tests/db/workflows-rls.test.ts (new)
- src/lib/db/types.ts (regen)
- tests/security/rls-expectations.ts (added workflows/workflow_runs rows)

Behavior implemented: `workflows`/`workflow_runs` tables, checks, uniques,
indexes exactly per rulings; `app.guard_workflow_write` (status/version/
next_run_at state machine, cron-fires check); `app.guard_workflow_run_update`
(no-bypass terminal/identity/transition guard); RLS owner/principal/admin
read, owner/principal write on `workflows`, read-only RLS on `workflow_runs`;
grants per rulings; `agent_runs_workflow_run_fk` + partial unique
`agent_runs_workflow_agent_key`. Found already drafted from an interrupted
run; verified against rulings line-by-line (no changes needed) and ran it
through the full accept gate.

Tests run:
- `pnpm db:reset` → applied 0096 cleanly, seed complete (full scale).
- `pnpm db:types` → regenerated, raw.
- `pnpm test:db tests/db/workflows-rls.test.ts` → 12/12 passed.
- `pnpm test:security tests/security/rls-generated.test.ts` → 851/851 passed.
- `pnpm test:security tests/security/grants.test.ts` → 859/860 passed; 1
  pre-existing failure, unrelated to this task (07 §4 public-RPC list order
  mismatch between `issue_library_loan`/`issue_certificate`, a file this
  packet does not touch — looks like leftover from the X02 certificates
  merge noted in the lane's recent commits).
- `pnpm lint` → 0 errors (8 warnings, all in untouched
  tests/unit/mastery-schemas.test.ts).
- `pnpm typecheck` → clean.

Tests not run and why: none skipped from the packet's ACCEPT list.

Limitations / honesty label: none (no UI, no honesty-badge surface).

Security / integration risks: none found. `app.guard_workflow_write` is
`security definer` with `search_path=''` and execute revoked from public
(lesson 4/5); `app.guard_workflow_run_update` has no bypass, matching 0095's
agent-run guard.

Follow-ups: pre-existing `grants.test.ts` ordering failure (see above) —
not this task's file; flag for whichever lane owns 07 §4 / X02.

New dependencies (justification): none.

Assumptions made: treated the pre-existing tree state as a valid completed
draft of this task rather than redoing it, since it matched every ruling
line for line; only verification work (db:reset/types/tests/lint/typecheck)
was needed.
