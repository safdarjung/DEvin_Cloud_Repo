Packet: T-09/T-10 M03-T9 academics setup actions + M03-T10 people setup actions

Files changed:
- src/modules/academics/setup.schemas.ts (new)
- src/modules/academics/setup.actions.ts (new)
- tests/db/academics-setup-actions.test.ts (new)
- src/modules/people/schemas.ts (new)
- src/modules/people/actions.ts (new)
- tests/db/people-staff-actions.test.ts (new)
- src/app/api/v1/actions/all-actions.ts (+2 import lines)

Behavior implemented:
- academics.grade.upsert / academics.section.upsert / academics.subject.upsert / academics.subjectAssignment.set — all `academics.manage`, upsert = update when `id` given (`.eq("institution_id", ctx.institution.id)`, hidden row -> not_found) else insert, audited. `subjectAssignment.set` is insert-only (no `id`, identity = (classSectionId, subjectId) per 0005's unique constraint); added app-level institution-membership checks on class_section_id/subject_id/teacher_id before insert because subject_assignments' RLS (0005) was NOT extended by 0065 (only terms/class_sections/staff/curriculum_units were) — mirrors assignments.actions.ts's loadSection/assertSubjectInInstitution precedent to close the same lesson-2 hole for this new write path.
- people.department.upsert / people.staff.upsert — both `staff.write`, same upsert semantics, audited with no PII (phone/email never in the audit row — only designation/isTeaching/status).

DEVIATION FROM BRIEF (read first, flagged per pre-code-protocol "record a default"): Task-9's EXPORTS line said `grade.upsert {id?, name, level}` and `subject.upsert {id?, name, code?}`. The actual 0005 columns (confirmed against the migration AND tests/helpers/factories.ts's existing createGrade/createSubject, which already use these names) are:
  - grades: code (not null, unique per institution), display_name (not null), sort_key (not null), grade_group (not null) — no "level" column exists anywhere in the schema.
  - subjects: code (not null, unique per institution), name (not null), kind (not null, check in scholastic/co_scholastic/skill/language, no default) — brief's "code?" (optional) is wrong; it's required and not-null with no generator.
  Followed the brief's own stronger instruction ("Columns exactly as 0005; do not invent") and matched the existing factory helpers exactly: GradeUpsertSchema = {id?, code, displayName, sortKey, gradeGroup}; SubjectUpsertSchema = {id?, code, name, kind}. class_sections and subject_assignments and the people module's departments/staff all matched the brief's shorthand exactly — no deviation there.

Tests run:
- `pnpm test:db tests/db/academics-setup-actions.test.ts` -> 4 passed (admin grade->section->subject->assignment ok; teacher forbidden; cross-institution grade on section -> rejected; duplicate subject assignment -> conflict)
- `pnpm test:db tests/db/people-staff-actions.test.ts` -> 4 passed (admin creates department + teaching staff; accountant forbidden; duplicate employee_no -> conflict; cross-institution department -> rejected)
- `pnpm test tests/unit/action-names-unique.test.ts` -> 4 passed
- `pnpm lint` -> clean
- `pnpm typecheck` -> clean

Tests not run and why: full `pnpm test:db` / `pnpm test:security` suites not run — brief restricts non-DB-owner packets to their own db test file only (BRIEF-COMMON lesson, "non-owners: ... run only own db test file"). `tests/security/escalation.test.ts` also imports a hardcoded module list for C-03 coverage and was not updated to add `@/modules/academics/setup.actions` / `@/modules/people/actions` — not named in either brief's FILES list, so left untouched; logged as a follow-up below.

RED/GREEN note: implementation and tests were written together in one pass rather than as a strict separate RED-then-confirm-fail-then-GREEN cycle — I did not capture a standalone failing run before the handlers existed. Column shapes were cross-checked against the migration and the existing factory helpers before writing, and the first real test run (shown above) passed on all 8 cases with no fix-up needed. Flagging this honestly rather than claiming a RED log that wasn't captured.

Limitations / honesty label: no UI; not user-facing simulated/limited surfaces — no SimulatedBadge/LimitedBadge applicable.

Security / integration risks:
- subject_assignments' RLS insert/update policies (0005) still only check role, not that class_section_id/subject_id/teacher_id belong to the caller's institution — 0065 (M03-T3) did not extend to this table. Mitigated at the app layer for the new `academics.subjectAssignment.set` action only; any OTHER future write path to subject_assignments (direct RLS insert, another action) would still be exposed. Real fix is a migration (out of scope here — no migrations allowed this packet).
- Cross-institution class_sections/staff inserts surface as `internal` (not `forbidden`) because 0065's RLS violations aren't `code:`-prefixed SQL exceptions that mapSqlError recognizes — asserted as-is per brief instruction, not patched.

Follow-ups (for 12-decision-log.md §Debt):
- Add `@/modules/academics/setup.actions` and `@/modules/people/actions` to tests/security/escalation.test.ts's import list so C-03 escalation coverage includes these 6 new actions.
- Consider a future migration extending 0065-style FK-institution binding to subject_assignments (currently only app-layer-guarded, for this one action).

New dependencies (justification): none.

Assumptions made:
- `subjectAssignment.set`'s "insert or reactivate" wording in the brief doesn't match 0005 (no status/soft-delete column on subject_assignments) — implemented as insert-only with conflict on duplicate (class_section_id, subject_id), matching the brief's own test case exactly.
- staff.status enum restricted to active|inactive at the Zod layer per brief, though the DB column itself has no CHECK constraint (default 'active', free text).
- grade/section/subject field names resolved to match 0005 + tests/helpers/factories.ts exactly (see DEVIATION note above) rather than the brief's shorthand EXPORTS line.
