Packet: X05-T1 Module key `whatsapp` + migration 0089
Files changed: tests/db/whatsapp-channel-sql.test.ts (fixed one case; others pre-existed from interrupted run, verified correct)
Behavior implemented: 0089 widens delivery_attempts/notification_preferences channel checks to add 'whatsapp' (constraint names via pg_constraint, not hardcoded); upserts app.module_catalog whatsapp row. catalog.ts: MODULES.whatsapp (after sms), MODULE_KEYS/OPTIONAL_MODULE_KEYS updated.
Fix: "admin client" delivery_attempts insert case used PostgREST clientAs("admin") — no insert policy exists on that table (service-role/job-runner writes only), got 42501. Rewrote to direct `sql` insert, matching tests/db/notifications.test.ts convention.
Tests run: pnpm db:reset (ok, reseeded) → pnpm test:db tests/db/whatsapp-channel-sql.test.ts tests/db/module-enabled-sql.test.ts (12 passed) → pnpm test tests/unit/modules-catalog.test.ts (28 passed) → pnpm test:security tests/security/grants.test.ts tests/security/module-gate.test.ts (238 passed) → pnpm lint (clean) → pnpm typecheck (clean for my files)
Tests not run and why: none skipped
Limitations / honesty label: none new; rule 7 inherited via existing <SimulatedBadge /> (M17-T4), out of scope here
Security / integration risks: none — no new RLS/grants/definers; db:types diff is zero as expected (check constraints not in generated types)
Follow-ups: none
New dependencies (justification): none
Assumptions made: "admin client" in task text = direct db-superuser sql client (matches existing delivery_attempts test pattern), not PostgREST admin role, since no insert policy exists on that table
Typecheck note (not my files): src/modules/library/schemas.ts has 4 pre-existing TS2322 errors from a concurrent agent's in-progress edit — ignored per brief
