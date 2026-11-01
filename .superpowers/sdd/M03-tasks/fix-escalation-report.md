# M03 fix: tests/security/escalation.test.ts C-03 registry drift

## Change
- Replaced 10 per-module action imports with single `import "@/app/api/v1/actions/all-actions";` (manifest already existed, already lists all 12 modules incl. `academics/setup.actions` and `people/actions`). `vi.mock("@/lib/supabase/server", ...)` kept before it.
- Added 13 FIXTURES entries: core.member.invite, core.member.revokeInvite, core.member.setRole, core.member.setStatus, core.academicYear.upsert, core.term.upsert, core.institution.updateSettings, academics.grade.upsert, academics.section.upsert, academics.subject.upsert, academics.subjectAssignment.set, people.department.upsert, people.staff.upsert. Permissions read from each `defineAction` call; inputs built from the real Zod schemas (`src/modules/core/schemas.ts`, `src/modules/academics/setup.schemas.ts`, `src/modules/people/schemas.ts`), ids via `U()`.

## Tests run
- `pnpm test:security tests/security/escalation.test.ts` (no `--`) → 552 passed, 1 file, first try, no source changes needed.
- `pnpm test:security` → 1237 passed, 18 files.
- `pnpm lint` → clean.
- `pnpm typecheck` → clean (`next typegen && tsc --noEmit`, types generated, no errors).

## Concerns
None. No fixture required a source change; no state-changing git; no DB reset/seed/migration run.
