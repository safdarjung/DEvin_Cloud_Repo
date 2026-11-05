Packet: M23-T3 Migration 0096 part 2 — run lifecycle definers

Files changed:
- supabase/migrations/20261028000096_workflows.sql (appended part 2)
- tests/db/workflows-lifecycle.test.ts (new)
- src/lib/db/types.ts (regen)
- tests/security/grants.test.ts (appended decide_workflow_run/start_workflow_run to PUBLIC_AUTHENTICATED)

Behavior implemented: `app.create_workflow_run` (shared core, revoked from
everyone); `public.emit_workflow_event` (3-key closed set, module-off = 0);
`public.enqueue_due_workflows` (schedule sweep + 6h reaper, mirrors 0077);
`public.start_workflow_run` / `public.decide_workflow_run` (not_found vs
forbidden split per ruling, audit rows, job enqueue). All per rulings
verbatim.

Tests run:
- `pnpm db:reset` → applied cleanly, seed complete (full scale).
- `pnpm db:types` → regenerated, raw.
- `pnpm test:db tests/db/workflows-lifecycle.test.ts tests/db/workflows-rls.test.ts` → 32/32 passed.
- `pnpm test:security tests/security/grants.test.ts` → 9/9 passed (the
  pre-existing issue_certificate/issue_library_loan ordering failure T2
  flagged was fixed by another lane agent concurrently; re-ran after
  appending my two entries — all green).
- `pnpm lint` → 0 errors (8 warnings, all pre-existing in untouched
  tests/unit/mastery-schemas.test.ts).
- `pnpm typecheck` → clean.

Tests not run and why: none skipped from the packet's ACCEPT list.

Limitations / honesty label: none (no UI, no honesty-badge surface).

Security / integration risks: none found. All 4 public definers revoke
from public+anon (service-role-only ones also revoke authenticated);
app.create_workflow_run revoked from everyone, callable only by same-owner
definers. decide_workflow_run uses one `select ... for update` so a second
concurrent decision blocks then re-reads a non-awaiting status.

Follow-ups: none new.

New dependencies (justification): none.

Assumptions made: decide_workflow_run/start_workflow_run permission checks
use a single locking select (like 0070's decide_leave) rather than the
ruling's literal two-select phrasing — same observable concurrency
behavior, consistent codebase style.
