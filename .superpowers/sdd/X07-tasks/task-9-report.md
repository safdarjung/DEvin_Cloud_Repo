Packet: T-009 Seed section `visitors` (X07-T9)

Files changed: `scripts/seed/sections/visitors.ts` (new); `scripts/seed/index.ts` (registered last); `tests/db/seed-visitors.test.ts` (new). `tests/db/seed-determinism.test.ts` not touched — it has no generic table list, only per-domain fingerprint fns.

Behavior: 25 visitor_entries (5/day, 2026-10-26..30, 09:00-15:00 IST, all checked out; 3/day host staff (principal/teacher.vi-a/admin), 2/day meeting_with Office/Accounts; 13/25 with id_type+last4; fictional names, phones 97000000NN). 3 pickup_persons (Aarav: Ramesh Sharma grandparent + Suresh Yadav driver; Ananya: Ramesh Sharma). 2 gate_passes (Ananya exited 2026-10-29, collector Priya Sharma/guardian.one, decided by admin; VI-A roll 8 pending, collector = that student's primary guardian). No open pass for Aarav. Inserted trusted (service-role bypass) as already-decided/-exited rows; collector_name/relation left unset — trigger fills pre-insert. Module `visitors` already on via `allModulesOn()` (asserted, not edited).

Tests run: `pnpm typecheck` clean; `pnpm lint` clean; `DEMO_RESET_ALLOWED=true pnpm demo:reset` ok (visitors: 28ms, 0 errors); `pnpm test:db tests/db/seed-visitors.test.ts tests/db/seed-determinism.test.ts` → 2 files, 7 tests passed (240s, incl. 2 full reseeds).

Tests not run: T10 HTTP acceptance — out of scope, depends on this seed.

Limitations / honesty: none new.

Security / integration risks: none; trusted-path inserts only, matches rulings exactly.

Follow-ups: T10 acceptance; T11 docs.

New deps: none.

Assumptions: front desk = admin login for all checked_in_by/checked_out_by/requested_by/decided_by/exit_marked_by (admin role = front desk per rulings); host rotation is a fixed 5-slot pattern (principal/teacher.vi-a/admin + Office/Accounts), not all 5 office roles; VI-A roll-8 student's generic guardian has no login, so admin is requested_by on their behalf.
