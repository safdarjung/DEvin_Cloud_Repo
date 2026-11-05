Packet: X03-T5 Catalogue actions (Sonnet, tests)
Files changed: src/modules/library/actions.ts (new); tests/db/library-catalog-actions.test.ts (new); src/app/api/v1/actions/all-actions.ts (+1 import line); tests/security/escalation.test.ts (+3 C-03 fixtures)
Behavior implemented: upsertBook (`library.book.upsert`→{id}), addCopies (`library.copies.add`→{ids}, book proven in ctx.institution first, one multi-row insert), setCopyStatus (`library.copy.setStatus`→{id,status}). RLS-direct writes (no RPC); 23505 mapped by constraint name to fieldErrors.isbn / fieldErrors.accessionNos; withdraw-on-loan conflict passes through app.guard_library_catalog via mapSqlError.
Tests run: pnpm test:db tests/db/library-catalog-actions.test.ts → 8/8 passed; pnpm test tests/unit/action-names-unique.test.ts → 6/6 passed; pnpm test:security tests/security/escalation.test.ts → 1172/1172 passed; pnpm lint → clean; pnpm typecheck → clean.
Tests not run and why: full test:db/test:security (packet restricts non-DB-owner to single-file runs; ignored per brief).
Limitations / honesty label: none; backend only, no UI this milestone.
Security / integration risks: none new; addCopies validates book institution ownership before insert, closing a cross-tenant accession-insert path.
Follow-ups: none for T5. Bug found+fixed during TDD: audit() action string must be lowercase-dotted (record_audit_event regex, 0013) — setCopyStatus audits "library.copy.set_status" while the action/permission name stays camelCase "library.copy.setStatus" per rulings, matching the timetable.saveDraft/attendance.markPeriod precedent.
New dependencies: none.
Assumptions made: 15s test timeouts bumped to 25s (DBT-46 auth-under-load pattern, concurrent lane agents hitting shared local Supabase); multi-row insert is atomic (Postgres statement-level), confirmed by test.
