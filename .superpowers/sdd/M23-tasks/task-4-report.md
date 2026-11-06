Packet: M23-T4 Migration 0096 part 3 — `workflow_metric`

Files changed:
- supabase/migrations/20261028000096_workflows.sql (appended part 3)
- tests/db/workflows-metrics.test.ts (new)
- src/lib/db/types.ts (regen, raw)

Behavior implemented: `public.workflow_metric(p_institution_id, p_metric,
p_entity_id, p_as_of) returns int`, plpgsql, stable security invoker,
search_path '', service_role only. 6-metric closed set per rulings table;
institution filter is the only filter (entity of another institution ->
0); unknown metric or null entity on the 2 subject metrics ->
validation_failed.

Tests run:
- `pnpm db:reset` → applied cleanly, seed complete (full scale).
- `pnpm db:types` → regenerated, raw (workflow_metric entry present).
- `pnpm test:db tests/db/workflows-metrics.test.ts` → 11/11 passed.
- `pnpm test:security tests/security/grants.test.ts` → 9/9 passed (no
  change needed: workflow_metric is invoker, service_role-only, not in
  any of that file's authenticated/definer lists).
- `pnpm lint` → 0 errors (8 pre-existing warnings, untouched
  tests/unit/mastery-schemas.test.ts).
- `pnpm typecheck` → clean.

Tests not run and why: none skipped from the packet's ACCEPT list.

Limitations / honesty label: none (no UI, no honesty-badge surface).

Security / integration risks: none found. Function revokes
public/anon/authenticated, grants service_role only; no dynamic SQL, no
app.* GUC bypass pattern (not needed — invoker, no trusted-caller branch).

Follow-ups: none new.

New dependencies (justification): none.

Assumptions made: test institutions have no `settings.locale.timezone`
key, so the function's own `coalesce(..., 'Asia/Kolkata')` fallback is
exercised directly (same as other metric/report RPCs' tests). Generated
`workflow_metric` RPC arg types are non-nullable (no SQL default), so
tests passing a null `p_entity_id` cast it (`null as unknown as string`)
to satisfy `tsc` while still sending SQL NULL at runtime — same
codegen limitation as `public.record_audit_event`'s optional `p_entity_id`
elsewhere, just without a DB-side default here.
