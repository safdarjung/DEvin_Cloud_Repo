Packet: M19-T5 Migration 0092 part 4 — sources fees, admissions
Files changed: none (blocked before any edit — root cause confirmed first)
Behavior implemented: none.
Tests run: none — blocked before TDD start.
Tests not run and why: `insight-sources-office.test.ts` was never written; the fees source cannot be built or tested without its required table.
Limitations / honesty label: n/a.
Security / integration risks: none introduced.
Root cause: `insight_src_fees` must read `payment_reversals` (ruling: "+ Σ payment_reversals.amount"), owned by M12 migration 0074 (`finance_plus`). That migration is **absent from lane-d**: no `supabase/migrations/*0074*` file on disk, and `to_regclass('public.payment_reversals')` on the lane's own running DB (`supabase_db_coolschool_d`) returns null. `assets`/`maintenance_requests` (M13, 0075) and `module_enabled` (0084, MOD) are present, so lane-d has M08–M11, M13, M14, M17, MOD but not M12 — even though docs/planning/coolskool/10-backlog-index.md (already synced into this lane) describes 0074 as claimed/built, and other branches (main, lane-b, lane-h) carry it. The packet's "Prereqs merged: M07–M18" does not hold for this specific worktree.
Fixing this needs merging M12 into lane-d (a git state change) or hand-writing `payment_reversals` here (not my task's file, owned by `finance`/M12, would duplicate/conflict with the real 0074 on merge) — both are out of scope under "No git state changes" / "touch only your task FILES".
`insight_src_admissions` has no such blocker (0007 admissions is present) but the task's FILES/ACCEPT bundle both sources in one test file and one migration part; shipping admissions alone would leave an unreviewable half-file for T6 to append after.
Follow-ups: lead/orchestrator must merge M12 (0074 `finance_plus`) into lane-d before T5, and before T6/T10/T21 which also depend on it per M19-tasks.md. Add a debt row if the lane-assignment script should check prereq migrations before dispatching a packet.
New dependencies: none.
Assumptions made: none — root cause checked empirically (file listing + live DB query), not inferred from docs alone.
