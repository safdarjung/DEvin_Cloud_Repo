Packet: M10-T5 Seed section curriculum (lesson plans + coverage, X-A Maths demo contract)
Files changed: scripts/seed/sections/curriculum.ts (new), scripts/seed/index.ts (registered after timetable), tests/db/seed-curriculum.test.ts (new)
Behavior implemented: new seed section, run after timetable. Per current-year subject_assignments row, one lesson_plan per curriculum unit (planned_on = 2026-07-01 + (seq-1)*42d) and a coverage row for seq <= k, k in {1,2,3} drawn from ctx.rng per (section,subject) — draw always happens, overridden to 2 for X-A Mathematics so other draws' PRNG position is unaffected. created_by/marked_by = principal, except X-A Maths = teacher.x-a. Ids deterministic (uuidV5, namespace "curriculum").
Tests run: `DEMO_RESET_ALLOWED=true pnpm demo:reset` (pass, counts clean) → `pnpm test:db tests/db/seed-curriculum.test.ts` 4/4 pass (coverage per section, X-A Maths units 1-2 covered/unit 3 planned-not-covered, unit-grade/subject match, reseed id determinism) → `pnpm test:db tests/db/seed-determinism.test.ts` 1/1 pass (unaffected) → `pnpm lint` + `pnpm typecheck` clean on touched files.
Tests not run and why: none — full packet test set ran.
Limitations / honesty label: none — real seed data, no AI, no channel.
Security / integration risks: none — seed-only, uses existing service-role admin client; no RLS/schema change (T1 already landed 0072).
Follow-ups: none.
New dependencies (justification): none
Assumptions made: "current-year subject_assignments" = class_sections.academic_year_id = ctx.academicYearId (single demo year; query filters explicitly rather than relying on there being only one row).
