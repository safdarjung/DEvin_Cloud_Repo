Packet: M19-T22 Docs
Files changed: docs/planning/coolskool/07-security-and-ai-governance.md · 05-data-architecture.md · 06-workflows-and-contracts.md · 12-decision-log.md · 03-feature-matrix.md · 10-backlog-index.md
Behavior implemented: Updated CoolSkool documentation for M19 insights engine. §4 security (definers, helpers, service-role invokers for insights), §5 AI governance (insight_explain data flow, anonymised projection). Data dict: 2.12 insights tables (insights, insight_actions, briefings columns, RLS, constraints). Ownership: insights module owns three tables, reads from academics/attendance/finance/admissions. Workflows: insights.detect job (deterministic detection, state machine, 8 detectors). Debt: 9 rows (DBT-89..97) recorded findings from T21 acceptance (admissions dwell proxied, insights never expire, explanation provenance gap, 20-per-signal cap, seeded-tenant 0-candidate domains, fixture consistency, M07 timetable truncation, briefings M25-only, no insight notifications). Feature matrix: F-INT-00 insights row (limited, detection running). Backlog: 0054 marked built (M19, 2026-11-05), 0092 claimed→built.
Tests run: `pnpm lint` → clean (no eslint errors).
Tests not run and why: Task 22 is docs-only; no code/migration tests needed.
Limitations / honesty label: Task spec references "docs/planning/fabric/03-roadmap-and-tracker.md: the M19 row" but that file contains only Fabric (FB-*) feature rows, not CoolSkool (M-*) milestone rows; file structure incompatible with M19 tracking. Updated equivalent CoolSkool backlog instead.
Security / integration risks: none. Documentation updates only; no code changes.
Follow-ups: none identified.
New dependencies: none.
Assumptions made: T22 "fabric roadmap" reference was a spec anomaly; equivalent CoolSkool backlog (10-backlog-index.md) is the authoritative M19 status tracker.
