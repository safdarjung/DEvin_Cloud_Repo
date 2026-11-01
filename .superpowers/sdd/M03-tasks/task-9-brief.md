### Task 9: M03-T9 Grades, sections, subjects, subject assignments actions
READ: BRIEF-COMMON.md; `src/modules/academics/assignments.actions.ts` (style); 0005 columns
FILES: `src/modules/academics/setup.actions.ts` (new, `"use server"`); `src/modules/academics/setup.schemas.ts` (new); `tests/db/academics-setup-actions.test.ts` (new); + one import line in `src/app/api/v1/actions/all-actions.ts`
EXPORTS (all `academics.manage`, upsert semantics as Task 8, audited): `academics.grade.upsert` {id?, name, level}; `academics.section.upsert` {id?, gradeId, academicYearId, name, capacity?, classTeacherId?}; `academics.subject.upsert` {id?, name, code?}; `academics.subjectAssignment.set` {classSectionId, subjectId, teacherId} (insert or reactivate; duplicate → conflict). Columns exactly as 0005 (read it; do not invent).
TEST FIRST: admin creates grade → section → subject → assignment; teacher → forbidden; section with another institution's grade → forbidden/validation (0065); duplicate subject assignment → conflict.
ACCEPT: `pnpm test:db tests/db/academics-setup-actions.test.ts`; `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm lint`; `pnpm typecheck`

