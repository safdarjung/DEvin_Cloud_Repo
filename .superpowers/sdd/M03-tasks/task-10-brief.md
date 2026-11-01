### Task 10: M03-T10 Staff + department actions
READ: BRIEF-COMMON.md; 0004 columns; Task 9 files (mirror)
FILES: `src/modules/people/actions.ts` (new, `"use server"`); `src/modules/people/schemas.ts` (new); `tests/db/people-staff-actions.test.ts` (new); + one import line in `all-actions.ts`
EXPORTS (`staff.write`, upsert, audited, no PII in audit): `people.department.upsert` {id?, name}; `people.staff.upsert` {id?, employeeNo, fullName, designation, departmentId?, phone?, email?, isTeaching?, status?: active|inactive}. Duplicate employee_no → conflict.
TEST FIRST: admin creates department + teaching staff → ok; accountant → forbidden; duplicate employee_no → conflict; department from another institution → rejected (0065).
ACCEPT: `pnpm test:db tests/db/people-staff-actions.test.ts`; `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm lint`; `pnpm typecheck`

