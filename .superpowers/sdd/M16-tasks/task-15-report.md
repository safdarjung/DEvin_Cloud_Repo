Packet: M16-T15 Docs

Files changed:
- `docs/planning/coolskool/10-backlog-index.md` (§3 migration index)
- `docs/planning/coolskool/07-security-and-ai-governance.md` (§4 definer table)
- `docs/planning/coolskool/12-decision-log.md` (§3 debt register)

Behavior implemented:
- Marked migration 0078 as built (M16, built) in the backlog index
- Added M16 definer note: `public.attendance_daily_counts` is security invoker, RLS-gated, granted to authenticated
- Added 5 M16 debt rows (DBT-84..88): seeded attendance dates, approvals timestamp, sparklines removal, role query page wiring, M19/M22 approval sources

Tests run: none (docs-only task). Verified tables render with `pnpm lint` (Markdown linter).

Limitations / honesty label: none; no application behavior or migration.

Security / integration risks: none; documentation updates only.

Follow-ups: DBT-84..88 link to M19 (insights approval source), M22 (agent_run approval source), and Workstream D (page UI refactor).

New dependencies: none.

Assumptions made: DBT numbers follow the sequence 65 → 66. M16 brings no new SQL-level definer functions (0078 is security invoker, not definer).
