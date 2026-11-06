Packet: M23-T20 Seed section `workflows`
Files changed: scripts/seed/sections/workflows.ts (new), scripts/seed/index.ts (registered after finance, before exams), tests/db/seed-workflows.test.ts (new)
Behavior implemented: seeds the 5 WORKFLOW_TEMPLATES (T9) as `active` workflows of the demo tenant via the service-role admin client (trusted by the write guard), id = uuidV5("workflows", "workflow:<key>"), version 1, trigger columns from triggerColumns(parseGraph(...)), created_by = demo principal. No runs/jobs written.
Tests run: TDD red first (ran test before seeding workflows — failed, 0 rows). `DEMO_RESET_ALLOWED=true pnpm demo:reset` → workflows section 41ms, 0 errors. `pnpm test:db tests/db/seed-workflows.test.ts` → 6 passed, 0 failed (incl. reset+reseed id-determinism check). `pnpm test:db tests/db/seed-determinism.test.ts` → 1 passed (unaffected). `pnpm lint` → 0 errors (8 pre-existing warnings in tests/unit/mastery-schemas.test.ts, not mine). `pnpm typecheck` → clean.
Tests not run and why: none skipped; full ACCEPT line covered.
Limitations / honesty label: none; deterministic seed data, no simulated/limited feature.
Security / integration risks: none — insert-only, no new privilege surface; relies on already-merged 0096 guards (T2–T4) to set next_run_at/status.
Follow-ups: none.
New dependencies (justification): none.
Assumptions made: `created_by` = ctx.userIdByLogin["principal"] (auth user id = profiles.id), matching existing precedent in staffing.ts/timetable.ts.
