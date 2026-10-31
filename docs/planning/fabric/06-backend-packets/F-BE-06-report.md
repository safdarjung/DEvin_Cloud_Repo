# F-BE-06 Report: Learning Fixtures

Packet: F-BE-06 learning
Files: src/modules/fabric/demo/learning.ts, tests/unit/fabric-fixtures/learning.test.ts
Behavior: masteryCells (120 cells; 6 sections × 5 subjects × 4 CBSE topics; mastery 35–95%, ~12% weak spots); curriculumCoverage (30 rows); assessmentPlan (12 assessments, ±45d dates, mixed kinds/status).
Tests run: pnpm test -- tests/unit/fabric-fixtures/learning.test.ts → 14 pass (same seed determinism, counts, mastery within 0–100, weak spots, coverage ratio).
Limitations: lint clean; agents.ts syntax error in repo blocks full typecheck (unrelated to packet).
Assumptions: use first 6 sections + first 5 subjects from prng exports; ~12% weak-spot chance per cell.
