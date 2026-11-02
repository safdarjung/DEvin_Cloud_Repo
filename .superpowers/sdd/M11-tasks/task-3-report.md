# M11-T3 Report: Question Bank Zod Schemas

**Packet:** M11-T3 Question bank Zod schemas (Haiku)

**Files changed:**
- `src/modules/question-bank/schemas.ts` (new, 186 lines)
- `tests/unit/question-bank-schemas.test.ts` (new, 374 lines)

**Behavior implemented:**
Created question bank schemas with enum types (QuestionType, Difficulty), base object, and four schema variants (Create, Update, Archive, List). Validation enforces MCQ ⇔ options (2–6 unique), answer in options, true_false answer ∈ {true, false}, body/answer/options trimmed and length-bounded, marks > 0 ≤ 100 with 0.01 precision, strict mode.

**Tests run:**
- `pnpm test tests/unit/question-bank-schemas.test.ts` → 40 passed ✓
- `pnpm lint` (schemas + test) → clean ✓
- Typecheck: no errors in question-bank files; unrelated errors in facilities/calendar/permissions from concurrent tasks

**Test coverage:**
All edge cases covered: valid short_answer/mcq/true_false/long_answer, mcq without options, answer not in options, duplicate options, true_false with invalid answer, options on non-mcq, body > 4000, marks outside bounds, precision, trim, optional/nullable fields, unknown keys, array bounds (2–6 for mcq), option text bounds (1–500), answer bounds (1–4000).

**Limitations / honesty label:**
None. Task is complete per spec.

**Security / integration risks:**
None. Pure Zod schemas, no I/O or side effects.

**Follow-ups:**
M11-T4 (actions) depends on these schemas; T8 (queries) uses QuestionBankItem shape not defined here (will be in queries.ts).

**New dependencies:**
None.

**Assumptions made:**
- QuestionCreateSchema and QuestionUpdateSchema share the same validation rules via superRefine (DRY approach, maintains consistency).
- Relative `.ts` imports used for seed-script compatibility (matches timetable pattern).
- Answer field is always a string (never null or number) per ruling: "mcq answer ∈ options" (strings), "true_false answer ∈ {true, false}" (strings).

**Checkpoint commit:**
abdc598 — feat(question-bank): M11-T3 Zod schemas for question bank
