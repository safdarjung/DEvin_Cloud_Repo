# Task 7 Report: MOD-T7 Retrofit: academics, timetable, question bank

**Packet:** T7 "Retrofit: academics, timetable, question bank (+ assignment pages)"

**Files changed:**
- src/modules/academics/setup.actions.ts (4 defs, module: "academic_structure")
- src/modules/academics/assignments.actions.ts (3 defs, module: "assignments")
- src/modules/academics/submissions.actions.ts (2 defs, module: "assignments")
- src/modules/academics/query-defs.ts (8 defs, 5x "assignments", 3x "academic_structure")
- src/modules/academics/curriculum.actions.ts (4 defs, 1x "academic_structure", 3x "lesson_plans")
- src/modules/academics/curriculum.query-defs.ts (3 defs, 1x "academic_structure", 2x "lesson_plans")
- src/modules/timetable/actions.ts (5 defs, module: "timetable")
- src/modules/timetable/query-defs.ts (10 defs, 7x "timetable", 3x "substitution")
- src/modules/timetable/substitution.actions.ts (2 defs, module: "substitution")
- src/modules/question-bank/actions.ts (3 defs, module: "question_bank")
- src/modules/question-bank/query-defs.ts (1 def, module: "question_bank")
- src/app/(tenant)/[institution]/assignments/page.tsx (added requireModule call)
- src/app/(tenant)/[institution]/assignments/new/page.tsx (added requireModule call)
- src/app/(tenant)/[institution]/assignments/[id]/page.tsx (added requireModule call)
- src/app/(tenant)/[institution]/assignments/units/[unitId]/page.tsx (added requireModule call)
- src/app/(tenant)/[institution]/portal/assignments/page.tsx (added requireModule call)

**Behavior implemented:**
Added `module:` field to 43 defineAction/defineQuery definitions in academics, timetable, and question-bank modules per MOD key map. Added `requireModule(ctx, "assignments")` calls to all 5 assignment page routes to gate the assignments feature.

**Tests run:**
- `pnpm test tests/unit/action-names-unique.test.ts` → PASS (4 tests)
- `pnpm test tests/unit/nav-routes.test.ts` → PASS (1 test)
- `pnpm lint` → PASS (no errors)

**Tests not run and why:**
- DB tests: not in task scope, no DB changes in T7
- `pnpm test:security` / `pnpm test:e2e`: not in acceptance criteria

**Limitations / honesty label:**
None. All definitions retrofitted; all pages gated.

**Security / integration risks:**
None. Module field is optional in options until T13 makes it required; gate logic already present from T2.

**Follow-ups:**
Typecheck reports one unrelated error in tests/db/module-enabled-sql.test.ts (T12 file; Record<string, unknown> JSONValue mismatch) — not touched by this task.

**New dependencies:**
None.

**Assumptions made:**
- Module key mappings per MOD-tasks.md key map (lines 20–56) are authoritative.
- Pages require `requireModule(ctx, "assignments")` gate (task T7 rulings).
- Import consolidation OK for @/lib/auth/require.
