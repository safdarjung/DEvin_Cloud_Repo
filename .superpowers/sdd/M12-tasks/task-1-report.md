Packet: T-0NN M12-T1 Permissions + module keys
Files changed: src/lib/auth/permissions.ts, docs/planning/coolskool/07-security-and-ai-governance.md §2.2, tests/unit/permissions.test.ts
Behavior implemented: Added three finance permissions to the matrix: `finance.payment.void` (owner, principal), `finance.payment.online` (owner, principal, accountant, guardian via RLS), `finance.reminder.send` (owner, principal, accountant). Module keys `finance_plus` and `online_payments` verified in catalog.ts (no changes needed — already exist with correct requires). Permissions added to ROLE_PERMISSIONS arrays for each role; matrix test updated with three new rows and assertions.
Tests run: `pnpm test tests/unit/permissions.test.ts tests/unit/permission-literals.test.ts` → 22 passed; `pnpm lint` → clean; `pnpm typecheck` → clean
Tests not run and why: Database integration tests not applicable to permissions registry
Limitations / honesty label: None
Security / integration risks: None — permission checks happen at action layer via `requirePermission(ctx, perm)`; RLS scope (own children for guardian) enforced by definer + RLS, not this registry
Follow-ups: None
New dependencies: None
Assumptions: Module keys finance_plus/online_payments already seeded in catalog per MOD; finance-related actions (T7–T13) will use these permissions in defineAction
