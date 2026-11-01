Packet: T-016 Seed attendance (60 days)

Files changed:
- `scripts/seed/sections/attendance.ts` — implemented (was a stub)
- `scripts/seed/sections/academics.ts` — class-teacher assignment bug fix (lead ruling 1)
- `scripts/seed/index.ts` — `assertCounts` extended with `attendance_sessions`/`attendance_records`
- `tests/db/seed-attendance.test.ts` — new
- `tests/db/seed-people-academics.test.ts` — added one assertion (no staff is class teacher of >1 section)

Behavior implemented:
- 60 school days (Mon–Fri + 2nd/4th Saturday, from 2026-07-01, skipping the documented holidays) computed once, deterministically, with no wall-clock. In practice the 60th day lands 2026-09-15 (before any of the configured holidays), so the holiday-skip and Saturday logic is implemented per spec but not exercised by this run's actual 60-day window.
- Per section (72 at full scale / 25 at `SEED_SCALE=small`) × day: one `attendance_sessions` row inserted directly as `status: 'submitted'` with `marked_by` = that section's class teacher (queried once from `class_sections` — no RPC call, so no jobs are enqueued), then one `attendance_records` row per student drawn via the seeded PRNG at 92/6/1/1 (P/A/L/OL).
- Named students (Aarav 92%, Ananya 96%, Ishaan 88%, 05 §8.1) are overridden with a fixed (non-PRNG) absent-day-index pattern per student id, hit within ±1%.
- Every section is guaranteed ≥1 absence on the last seeded day (AC2) by force-flipping a non-overridden student if the draw produced none.
- One `attendance_corrections` row per 2,000 records inserted (deterministic counter), with `old_status`/`new_status` always distinct.
- All three tables inserted via `insertBatch(..., 5000)`. Section + session/record/correction ids are UUID v5 from natural keys (`section:<key>`, `session:<key>:<date>`, `record:<sessionId>:<studentId>`), so reruns are idempotent and identical.
- Class-teacher fix: unnamed sections now draw from a pool excluding the 3 named demo teachers, via their own cursor (not shared with the subject-teacher cursor) — eliminates the modulo-wraparound collision that let one staff member become class teacher of two sections (was I-A and VI-A both landing on the "VI-A Class Teacher" staff row).

Tests run:
- `pnpm vitest run --project db tests/db/seed-attendance.test.ts tests/db/seed-people-academics.test.ts tests/db/seed-determinism.test.ts` → 21/21 passed
- `pnpm test:db` → 240/241 passed. The 1 failure (`tests/db/attendance-schema.test.ts` — "HIGH fix: attendance.read is scoped") is a pre-existing T-015 file I don't own; it times out at exactly vitest's 5000ms default on 7–8 sequential `signInWithPassword` calls, reproduced in isolation both inside and outside the full run, unrelated to any file I touched. Flagging for the lead/T-015 owner rather than fixing (out of packet scope).
- `pnpm test` (unit) → 305/305 passed
- `pnpm lint` → clean on touched files (3 pre-existing warnings in T-019-adjacent stub files `admissions.ts`/`exams.ts`/`finance.ts`, not mine)
- `pnpm typecheck` → clean
- `SEED_SCALE=small pnpm demo:reset` → counts scaled correctly: 25 sections, 1,050 students, 1,500 attendance_sessions, 63,000 attendance_records
- `pnpm demo:reset` (full scale, restored after the small-scale run) → counts exact: attendance_sessions 4,320, attendance_records 181,440
- `pnpm test:e2e e2e/j06-attendance.spec.ts` → 3/3 passed (its own comment documented the class-teacher bug I fixed; it already scoped around it, so the fix only tightens correctness, didn't break it)

Timing: `pnpm db:reset` wall time 54s (well under the 3-minute budget). Attendance section alone: ~16.5s at full scale, ~5.6s at small scale.

Counts (full scale, from the printed seed summary):
students 3024, guardians 2515, staff 106, class_sections 72, enrolments 3024, attendance_sessions 4320, attendance_records 181440.

Absence rate: global 5.5–6.5% band asserted and passing (binomial std at n≈181k keeps the draw within ~0.1% of the 6% target, far inside the band).

Named-student percentages (asserted within ±1%, scoped by grade/section/roll_no — not by name, since the random roster has incidental full-name collisions elsewhere in 3,024 students):
- Aarav Sharma (VI-A roll 7): target 92%, actual 91.67% (5/60 absent)
- Ananya Sharma (X-A roll 12): target 96%, actual 96.67% (2/60 absent)
- Ishaan Mehta (VIII-B roll 3): target 88%, actual 88.33% (7/60 absent)

Determinism: session/record/correction ids are pure UUID v5 functions of natural keys, verified against the documented formula in the test and implicitly covered by `tests/db/seed-determinism.test.ts`'s full reset+reseed rerun (admission_no fingerprint unchanged). No duplicate (class_section_id, date) or (session_id, student_id) pairs.

Limitations / honesty label: none — attendance history is real seeded data, no AI/simulated channel involved. Today's live VI-A session is intentionally not seeded (left for J-06 at the UI layer, exercised by the e2e spec's "mark everyone and submit" path).

Security / integration risks: seed writes bypass `submit_attendance`/RLS entirely via the service-role client, as instructed, so zero `notify.attendance_absence` jobs are enqueued for 60 days of history (asserted). No new RLS surface touched; migrations untouched.

Follow-ups:
- `tests/db/attendance-schema.test.ts`'s "attendance.read is scoped" test needs a timeout bump or fewer sequential sign-ins (pre-existing, not a T-016 regression) — debt candidate for its owner.
- The 60-day window as computed never actually reaches the documented Aug/Oct holidays; if a future packet changes the start date or day count, the holiday-skip path should get a direct unit test (currently only reachable in principle, not exercised by this run's 60 days).

New dependencies (justification): none.

Assumptions made:
- "Active enrolment" for `attendance_records` generation = each section's roster from `SeedContext.studentsBySection` (all enrolments are `status: 'active'` at seed time, confirmed via academics.ts — no filtering needed).
- Class-section id and `class_teacher_id` are not threaded through `SeedContext` (per 09 §4's "sections only read earlier sections' outputs via SeedContext" convention, but no such field exists yet); followed the codebase's existing convention of re-deriving ids via the same UUID v5 formula (`section:<key>`) rather than a DB read, and did one small read-only query against `class_sections` for `class_teacher_id` (not derivable from a formula) rather than extending `SeedContext`'s shape, since that would have required editing `academics.ts` beyond the one authorized fix.
- Correction `reason` text is a single fixed string (not varied) — "a few deterministic corrections with reasons" didn't require varied wording.
