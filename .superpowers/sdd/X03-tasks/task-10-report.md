Packet: X03-T10 Docs (Haiku)

Files changed:
- `docs/planning/coolskool/07-security-and-ai-governance.md` (§4 definer row added)
- `docs/planning/coolskool/05-data-architecture.md` (§2.12 library tables, ownership matrix, reserved names updated)
- `docs/planning/coolskool/06-workflows-and-contracts.md` (§4 audit events added)
- `docs/planning/coolskool/12-decision-log.md` (§3 DBT-50/51 debt rows added)
- `docs/planning/coolskool/03-feature-matrix.md` (F-SVC-01 row updated to limited/with test coverage)
- `docs/planning/coolskool/10-backlog-index.md` (§3 migration 0086 marked built)

Behavior implemented: Final documentation pass for X03 library module (T1–T9 completed). All references to library tables, RPCs, audit events, module enablement, and design decisions now match the implementation. Feature matrix shows "limited" backend+API status. Debt register captures skipped features (no student/guardian UI, no holds, no lost-book state, staff fine-exempt, fines non-reversible post-invoice).

Tests run: `pnpm lint` → clean; no code changes, documentation only.

Tests not run and why: No code execution required for documentation edits.

Limitations / honesty label: None; backend-only module, no UI, no simulated/limited label needed beyond task 9's HTTP acceptance test.

Security / integration risks: None; documentation-only changes, no behavioral changes or new code paths.

Follow-ups: Controller to run security review (Sonnet); full gate tests; demo tenant reset with library on, hosted push of 0086; commit/push; X03 complete.

New dependencies: None.

Assumptions made: T1–T9 reports are accurate and facts in this packet match the migration/tests/queries built.
