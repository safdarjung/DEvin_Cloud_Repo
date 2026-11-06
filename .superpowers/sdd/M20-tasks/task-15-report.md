Packet: T15 M20-T15 Docs
Files changed: docs/planning/coolskool/07-security-and-ai-governance.md, docs/planning/coolskool/05-data-architecture.md, docs/planning/coolskool/12-decision-log.md
Behavior implemented: Added M20 mastery AI governance note to 07 §5 (deterministic detection, no student names in evidence/pattern); updated 05 §3 ownership matrix with mastery module (owns mastery_snapshots, intervention rows) and exams note (unit_ids added in M20); added 9 debt rows DBT-125–DBT-133 covering equal attribution, no recency weighting, no recompute action, no plan reassignment, trend from results only, detector never auto-resolves, closed plans immutable, no AI-drafted plans, non-stable snapshot IDs.
Tests run: `pnpm lint` → 0 errors in documentation; 11 warnings in other files (not touched by this packet)
Tests not run and why: none (docs only, per ACCEPT)
Limitations / honesty label: none (documentation only)
Security / integration risks: none (documentation only)
Follow-ups: DBT-125–DBT-133 are open debt rows for future phases
New dependencies (justification): none
Assumptions made: mastery module RLS reuses X07's `app.my_class_teacher_student_ids()` (0090), not redefined in M20 (0093); migration 0093 owner confirms M19 contract column names before T6 executes
