Packet: X06-T10 Seed section `exam_seating`

Files changed:
- scripts/seed/sections/exam-seating.ts (new)
- scripts/seed/index.ts (import + registered after `exams`, before `website`)
- tests/db/seed-exam-seating.test.ts (new)

Behavior implemented: draft exam "Unit Test 3" (unit_test) with papers for every VI/VII section (2 subjects each, picked deterministically by subject code from subject_assignments), scheduled 09:30 IST on first Monday >= run day+14 (slot 1) and the day after (slot 2), 60 min, room_id null, term resolved from the slot date against the terms table (fallback term2). `ctx.admin.rpc("generate_seating_plan", …)` plans slot 1 only, rooms = Hall then classrooms by name until capacity >= student count (seats = capacity); slot 2 stays unplanned. No ctx.rng draw used, so downstream sections' PRNG order is unaffected. Idempotent rerun guard (exam id exists -> return), uuidV5 everywhere.

Tests run: `DEMO_RESET_ALLOWED=true pnpm demo:reset` → clean (exam_seating: 132ms); `pnpm test:db tests/db/seed-exam-seating.test.ts` → 4/4 pass (one current plan, seat_count = active VI/VII students, Aarav Sharma seated, first room's seats 1/2 different grades, reseed → identical (student,room,seat_no) set); `pnpm lint` clean; `pnpm typecheck` clean.

Tests not run and why: `pnpm test:db tests/db/seed-determinism.test.ts` timed out twice (180s hard timeout, 186s then 217s wall-clock) — host under heavy concurrent load from other lanes' simultaneous full db resets (load avg ~14, `ps aux` showed 5+ other lanes' vitest/postgres resets running). Not a logic failure: this packet's own reseed-and-compare (seed-exam-seating.test.ts's 4th test) passed cleanly in the same window, and exam_seating adds only 132ms to the seed. Did not retry a 3rd time since load was rising, not falling.

Limitations / honesty label: n/a (seed/DB layer only, no UI).

Security / integration risks: none new — writes through the T3 definer only (service_role claim bypass, generated_by null), same demo_reset ordering risk as T2/T3 (one current plan per exam/slot, cleared by demo_reset before reseeding).

Follow-ups: none for T10; T11 (docs) still open.

New dependencies: none.

Assumptions made: "demo guardian's child" = Aarav Sharma (VI-A, 05 §8.1; consistent with finance/operations/attendance seed precedent). Held_on left null (unused by this exam). generate_seating_plan called via service-role `ctx.admin.rpc` per task text (bypasses exam_write_roles, generated_by = null).
