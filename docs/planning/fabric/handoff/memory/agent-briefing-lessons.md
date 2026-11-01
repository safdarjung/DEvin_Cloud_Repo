---
name: agent-briefing-lessons
description: Defects security reviews kept finding in Sonnet packet work (2026-10-29); brief implementation agents with these up front
metadata:
  node_type: memory
  type: project
  originSessionId: 389f81ff-0381-4199-9607-cbb7bd4a769d
  modified: 2026-10-29T10:44:26.731Z
---

Recurring defects found by security reviews of T-013…T-037 (2026-10-29). Put them in every implementation-agent brief:

1. RLS SELECT must match `07 §2.2` matrix, not the packets' coarse "class S = all staff" (T-014 leak; DBT-17 tracks older tables).
2. Writes must bind every user-supplied FK to the same institution/scope in `with check`; qualify columns inside policy subqueries (`table.col`).
3. `app` schema is not exposed over PostgREST: anything an action/route calls needs a `public` definer wrapper (0012 jobs, 0013 audit). Never give users a generic enqueue/update path whose payload a service-role handler later executes (T-037 HIGH) — build payloads server-side in SQL.
4. Never leave `SERVICE_ROLE_CALLER` set process-wide in the Next server; never use the superuser `SUPABASE_DB_URL` in `src/` (T-035, T-037).
5. Redaction/sanitizing must handle spaced/dashed Indian phone and Aadhaar formats (T-035 CRITICAL).
6. Agents ran `npx oxfmt` (unreviewed package) 3× and once reformatted all of `src/lib/db/types.ts`. Now hard-blocked: project `.claude/settings.json` denies npx/pnpx/pnpm dlx/bunx/yarn dlx (owner-approved 2026-10-29). `types.ts` stays raw `pnpm db:types` output.
7. Public/anon RPCs: grant to `service_role` only and let the server route (honeypot, server-computed ip_hash) be the sole caller — anon-callable definers bypass route-level abuse controls (T-026).
8. Role helpers (`app.finance_roles`, `app.exam_roles`, …) can be broader than a specific matrix row — T-030 CRITICAL let admin write money. Compare helper vs every row; add narrower helpers (`finance_write_roles`).
9. Versioned/immutable data (marks, results): guard triggers must check the parent's state (exam status) and that a supersede target matches the same entity (paper+student+institution) — T-017 CRITICAL let a teacher rewrite published marks.
10. RLS performance: never call SECURITY DEFINER helpers per row in policies (`app.has_role(institution_id,…)` etc.) — at demo scale (181k attendance rows) teacher/guardian queries hit 30s timeouts. Use row-independent array helpers as initPlans: `col = any((select app.my_*()))` (P-01, migration 0020) — BUT keep institution correlation inside helpers (gs.institution_id = m.institution_id); P-01 first draft leaked cross-tenant guardian data. Add a perf test on seeded data for any new big table.
11. State machines: guard privileged status transitions with a trigger + GUC set only inside the definer (`app.allow_enrol`, `app.allow_publish`).
12. Plan gaps found: no packet created `src/lib/audit.ts` (lead added via D27); T-015 submit needs a `public.submit_attendance` RPC (migration 0014) to enqueue absence jobs safely.

**Why:** each of these reached review in at least one packet; briefing up front is cheaper than review→fix loops.
**How to apply:** include in Agent prompts for migration/action packets; keep the parallel-agent DB fence (one DB owner; others run only their own db test file). See [[coolskool-project]].

13. Single-file test runs: `pnpm test:db tests/db/x.test.ts` — NO `--` (with `--` vitest runs the whole 52-file db project, ~7 min). Same for `pnpm test`.
