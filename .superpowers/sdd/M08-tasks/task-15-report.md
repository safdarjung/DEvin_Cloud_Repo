# M08-T15 Completion Report

## Packet: M08-T15 Docs: backlog 0070 built, 07 §4 definer row, tracker check, DBT-47..50

## Files changed
- `docs/planning/coolskool/10-backlog-index.md` §3: 0070 status "built" + table/RPC list
- `docs/planning/coolskool/07-security-and-ai-governance.md` §4: new staffing definer row
- `docs/planning/coolskool/12-decision-log.md` §3: M08 debt rows DBT-47..50, renumbered M09+ rows to DBT-51..60

## Behavior implemented
Updated docs to reflect M08 completion: migration 0070 marked built with staff_attendance/leave_requests/substitutions tables, helpers (my_staff_ids), RPCs (staff_check_in, decide_leave, assign_substitution, cancel_substitution, mark_period_attendance), and guards. Added M08-specific debt rows for leave-overlap race condition (DBT-47, btree_gist), notification gaps (DBT-48), period-attendance exclusions (DBT-49), future-substitution version handling (DBT-50). Fabric roadmap entries FB-WS-04/FB-EDU-07 confirmed unchanged (simulated/planned, per D39 reserved scope).

## Tests run
- `pnpm lint docs/planning/coolskool/*.md` → 0 errors
- Markdown tables rendered, no broken pipes

## Tests not run and why
Schema validation: none needed (doc-only task). Content verification: manual spot-check of debt row format and definer row match to 07 §4 timetable pattern.

## Limitations / honesty label
None.

## Security / integration risks
None.

## Follow-ups
None.

## New dependencies
None.

## Assumptions made
- M09 debt rows (submissions, quiz scoring, assignment closure) renumbered to DBT-51..54 from DBT-47..50 to make room for M08 rows.
- Fabric roadmap statuses (FB-WS-04 simulated, FB-EDU-07 planned) are intentionally unchanged per D39 reserved scope; UI landing in Workstream D, not this backend milestone.
