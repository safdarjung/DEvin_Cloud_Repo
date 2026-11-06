# Task 13: X01-T13 Docs

Packet: X01-T13 "Docs"

## Files Changed

- `docs/planning/coolskool/03-feature-matrix.md` — added F-COM-07 (diary), F-ATT-06 (student leave)
- `docs/planning/coolskool/10-backlog-index.md` — marked 0085 as built (2026-11-05)
- `docs/planning/coolskool/07-security-and-ai-governance.md` — updated §4 row to include diary definer trigger + updated title from "student leave" to "student leave + diary"
- `docs/planning/coolskool/12-decision-log.md` — added 5 debt rows (DBT-71…75): leave overlap race, pre-mark horizon, approved-leave immutability, diary posting scope, teacher notification gap

## Behavior Implemented

Two new feature matrix rows (one in §C Communications, one in §D Academics/Attendance) document the X01 scope. Migration 0085 status updated. Security definer row consolidated to cover both student-leave and diary modules. Five anticipated future improvements documented as debt for Phase 2+.

## Tests Run

- `pnpm lint docs/planning/coolskool/*.md` — no markdown linting configured; ESLint skip
- Manual verification: grep for new feature IDs, migration status, security row title, debt entry IDs

## Limitations / Honesty Label

None. Documentation only, no code changes.

## Security / Integration Risks

None. This packet closes documentation gaps for the finished X01 implementation.

## Follow-ups

Debt rows DBT-71…75 are ready for Phase 2 refinement and implementation tracking.

## New Dependencies

None.

## Assumptions Made

- Next free feature IDs: F-COM-07, F-ATT-06 (confirmed by reading existing matrix)
- Debt row IDs: DBT-71…75 (confirmed by reading existing register)
- Date format: consistent with existing entries (e.g., "built 2026-11-05")
