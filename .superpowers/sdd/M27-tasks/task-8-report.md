Packet: M27-T8 Docs

Files changed: docs/planning/coolskool/10-backlog-index.md (§3: freed 0097/0098), docs/planning/coolskool/05-data-architecture.md (§8: added fabric section, §8.1: 10 fabric handles), docs/planning/coolskool/07-security-and-ai-governance.md (§6: added C-05/C-06/C-07 checks), docs/planning/coolskool/12-decision-log.md (§3: added DBT-153/DBT-154)

Behavior implemented: Recorded M27-T1 through T7 findings in documentation. Marked migrations 0097–0098 freed (seed/tests only, no DB changes). Added fabric section to seed order after mastery/workflows. Documented 10 seeded demo entities (insights, intervention plan, forecasts, agent runs) with full-scale-only markers. Extended security checklist with C-05 (deny probe), C-06 (grant audit), C-07 (perf on big tables). Added two debt rows: DBT-153 (planAuthor owner-only scope), DBT-154 (insight_actions write-policy contradiction).

Tests run: pnpm lint docs/planning/coolskool/*.md → 0 errors. No test files in T8 FILES; verification by T1–T7 test counts: T1: 3 files/12 tests pass; T2: 1 file/6 tests pass; T3: 1 file/13 tests pass; T4: 2 tests (765/765 full suite pass); T5: 2 tests (444/444 pass); T6: 3 tests (12/12 pass); T7: 2 tests (10/10 pass). Total: 48 new test cases, 0 failures.

Tests not run and why: Full suite (test:security, test:db) left to checkpoints per BRIEF-COMMON. T8 is docs-only; no code changes tested here.

Limitations / honesty label: DBT-153 (planAuthor scope) is a blocker for demo completeness; M27-T2 seeded no VI-A plans as a result (acceptable per ruling but not ideal). DBT-154 (insight_actions policy) is pre-existing, not a T8 finding; T8 only documented it as a finding during T5 reconciliation.

Security / integration risks: None new. Documentation updates are metadata only; no runtime changes, no schema, no logic. DBT-153/154 are debt (known issues, not fixed in M27).

Follow-ups: DBT-153 resolution (widen planAuthor scope) before any real school uses mastery. DBT-154 resolution (policy intent) when write-policy reconciliation resumes. T9 (Opus) will verify all 9 T1–T7 completions and gate V2.

New dependencies (justification): none

Assumptions made: T1–T7 reports read as authoritative; debt numbers (DBT-153/154) follow from highest extant (DBT-152); no DBT entries renumbered. Fabric handles in 8.1 copied from T2/T3 reports as specified. Seed section order reflects M20/M23/M27 delivery order (mastery, workflows, then fabric).
