### Task 8: M03-T8 Academic year, term, institution settings actions
READ: BRIEF-COMMON.md; `src/modules/core/{actions,schemas}.ts`; `tests/unit/institution-settings.test.ts`
FILES: `src/modules/core/actions.ts` (edit); `src/modules/core/schemas.ts` (edit); `tests/db/core-setup-actions.test.ts` (new)
EXPORTS: `core.academicYear.upsert` {id?, name, startsOn, endsOn, isCurrent?} (`academics.manage`; making one current clears the previous current in the same handler — the partial unique index forbids two); `core.term.upsert` {id?, academicYearId, name, startsOn, endsOn} (`academics.manage`); `core.institution.updateSettings` {name?, timezone?, settings patch validated by the existing settings schema} (`institution.settings.manage`). Upsert = update when `id` given (hidden row → not_found) else insert. Audit each. No deletes (YAGNI; FK history).
TEST FIRST: admin creates next year + term → ok; term outside its year → validation_failed (trigger `app.validate_term_dates`); switching current year leaves exactly one current; accountant → forbidden; settings update round-trips timezone.
ACCEPT: `pnpm test:db tests/db/core-setup-actions.test.ts`; `pnpm lint`; `pnpm typecheck`

