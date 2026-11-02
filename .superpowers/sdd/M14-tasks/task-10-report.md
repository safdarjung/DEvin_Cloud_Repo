# M14-T10 Report: Docs

**Packet:** M14-T10 "Docs" (CoolSkool backend plan)

**Files changed:**
- `docs/planning/coolskool/07-security-and-ai-governance.md` (§4 definer row)
- `docs/planning/coolskool/05-data-architecture.md` (§2 table row + note, §3 ownership row)
- `docs/planning/coolskool/12-decision-log.md` (5 new debt entries: DBT-47 through DBT-51)

**Behavior implemented:**
Added M14 lifecycle module to spec docs. Section 07 §4 documents three new security-definer RPCs (`promote_students`, `exit_student`, `link_guardian`) and two guard triggers. Section 05 §2.9 defines `student_lifecycle_events` table and clarifies `enrolments` status semantics (transferred = intra-school, completed = promotion/graduation, withdrawn = exit). Section 05 §3 adds lifecycle module ownership. Decision log captured 5 design shortcuts: no undo after exit, no TC for alumni, module gating app-layer only, staff-parent guardianship not revoked, `students.details` not editable.

**Tests run:**
No tests run — documentation-only task per spec.

**Tests not run and why:**
Per BRIEF-COMMON.md, T10 is Haiku "none []" (no test routing).

**Limitations / honesty label:**
None. Rows match merged 0076 migration and M14 actions.

**Security / integration risks:**
None. Documentation reflects implemented behavior.

**Follow-ups:**
None. New debt entries flag future work (DBT-47 through DBT-51 in 12 §3).

**New dependencies:**
None.

**Assumptions made:**
Debt entries align with M14 design decisions per the rulings block in M14-tasks.md.
