# T10 Docs — M25 Briefings & Timetable Suggestions

Packet: M25-T10 (Docs)
Files changed: 
- docs/planning/coolskool/12-decision-log.md (added D48, DBT-134..144)
- docs/planning/coolskool/05-data-architecture.md (ownership: insights writes briefings)
- docs/planning/coolskool/06-workflows-and-contracts.md (§7 note: no job briefing.generate)
- docs/planning/coolskool/03-feature-matrix.md (added F-INT-06, F-INT-07)
- docs/planning/coolskool/07-security-and-ai-governance.md (M25 service-role caller, §5 dashboard_briefing flow)
- docs/planning/coolskool/10-backlog-index.md (M25 marked built)

Behavior implemented: 
- D48 decision: briefings in-request, not job; timetable.suggest read-only query
- DBT-134..144: debt rows on frozen briefs, role-wide teacher briefs, rule-headline-only for accountant/exam_controller, no model column, gateway-only call, etc.
- Security row for briefings.service-role.ts caller in §4
- Dashboard briefing flow description in §5 AI governance
- Feature matrix rows for daily briefings (F-INT-06, limited) and timetable suggestions (F-INT-07, limited)
- Ownership matrix updated for insights writing briefings via service-role
- M25 backlog entry marked built

Tests run: pnpm lint (no errors)
Tests not run: N/A (docs-only task, no code changes)

Limitations / honesty label: 
- Briefings frozen after first generation (no refresh button yet — DBT-126 debt)
- Timetable suggestions ephemeral (stored as insight_actions is DBT-132 debt)

Security / integration risks: None (docs only)
Follow-ups: DBT-126 (refresh briefings), DBT-132 (store suggestions), Module gating edge cases (other tasks ship the code)

New dependencies: None
Assumptions made: D48 mirrors D46's in-request pattern; M25 is complete once T4–T9 are merged and this doc finishes
