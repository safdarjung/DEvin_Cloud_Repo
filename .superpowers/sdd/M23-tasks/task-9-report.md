Packet: M23-T9 Seeded workflow templates
Files changed: src/modules/workflows/templates.ts, tests/unit/workflows-templates.test.ts
Behavior implemented: 5 seeded workflow templates (absence_follow_up, assignment_reminder, exam_reminder, fee_reminder, admissions_follow_up) with event/schedule triggers, condition steps, notify nodes, approval and agent nodes per spec. All templates parse via parseGraph; triggers extract correct event/cron configs; message lengths ≤ 200 chars; only fee_reminder has approval+fee_defaulters; only admissions_follow_up has agent (admissions slug).
Tests run: `pnpm test tests/unit/workflows-templates.test.ts` → 22/22 PASS
Tests not run and why: None; all required tests pass.
Limitations / honesty label: None; templates are deterministic, static fixtures with no simulation or limited features.
Security / integration risks: None; templates are schema-validated read-only exports used only for seeding.
Follow-ups: None; task complete.
New dependencies: None
Assumptions made: Templates.ts must use relative `.ts` imports; WORKFLOW_TEMPLATES is readonly const array transcribed exactly from rulings.
