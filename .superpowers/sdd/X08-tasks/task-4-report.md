Packet: X08-T4 PTM + survey Zod schemas
Files changed: src/modules/ptm/schemas.ts, tests/unit/ptm-schemas.test.ts
Behavior implemented: Zod schemas for PTM events, slots, bookings, surveys with discriminated unions (single/multi/text, school/role/grade/section audiences), time validation, slot count bounds (1–60), booking cutoff before event start (IST refine), survey constraints (1–10 questions, 2–6 distinct options, ≤200 char prompts, ≤500 char text). Exports: PTM_SLOT_MINUTES [5,10,15,20,30], SURVEY_QUESTION_TYPES, SURVEY_MAX_QUESTIONS=10, SURVEY_MIN_ANON_RESPONSES=3; 18 schemas (PtmEventCreate, Publish, SlotsAdd, SlotRemove, Book, Cancel, EventsQuery, Schedule, ForStudent; SurveyQuestion, Create, Close, Respond, Results, List, MySurveys) + inferred *Input types. All .strict(). Relative .ts imports for seed compatibility.
Tests run: `pnpm test tests/unit/ptm-schemas.test.ts` → Test Files 1 passed (1), Tests 44 passed (44)
Lint/typecheck: clean
Limitations / honesty label: none (schema validation only, no UI/seed/action layer)
Security / integration risks: none (pure validation; T5/T7 actions consume schemas for input gating)
Follow-ups: none (T1 + T4 done; T2/T3 migration ready)
New dependencies (justification): none
Assumptions made: IST-only cutoff refine (+05:30 hardcoded), `Date()` parsing ISO with offset, slot count = (minutes) / slotMinutes
