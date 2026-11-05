Packet: M25-T3 Timetable fill engine fill_v1 + schema
Files changed: src/modules/timetable/suggest.ts (new) · src/modules/timetable/schemas.ts (Edit: SuggestFillSchema + SuggestFillInput appended) · tests/unit/timetable-suggest.test.ts (new)
Behavior implemented: pure deterministic `suggestFill(input)` per rulings steps 1–7: cells Mon–Sat × non-break periods by seq; per-section targets floor/mod by subject name→id; occupancy (section/teacher/room busy, load, dayCount, count) from all version slots; homeRoom (most slots; ties name→id); sections by label numeric localeCompare (then id); pick largest deficit → lower load → subject name → id; room = home when free else `roomId` omitted; stop at limit; `unfilled` = empty in-scope cells − emitted.
Exports: SUGGEST_ENGINE_VERSION=1, MAX_SAME_SUBJECT_PER_DAY=2, SuggestInput, TimetableSuggestion (Pick<InsightAction,…> & {status:"planned"; slot: SlotInput}), suggestFill; SuggestFillSchema {versionId, classSectionIds? 1–100, limit int 1–200 default 200} strict, SuggestFillInput (= z.infer, limit: number). Relative .ts imports; `import type` for fabric/types.ts + SlotInput.
Tests run: RED first (module missing). `vitest run --project unit tests/unit/timetable-suggest.test.ts tests/unit/timetable-schemas.test.ts` → 2 files, 70 passed (suggest 20: 14 engine + 6 schema; schemas 50). Mutation spot-check: disabling teacher-busy, room-busy, same-subject cap, max-load, load tie-break each fails ≥1 test.
`pnpm typecheck` → clean. `pnpm lint` → 0 errors; 8 warnings all in tests/unit/mastery-schemas.test.ts (not this packet).
Tests not run and why: none of the packet's. Note: `pnpm test` runs tests/setup/global.ts which probes SUPABASE_DB_URL (`select 1`); lane has no stack, so unit tests ran via a scratch wrapper config (same config, globalSetup removed, SERVICE_ROLE_CALLER=test). No DB command run.
Limitations / honesty label: engine only; no UI, no write. Not wired yet — T8 builds `timetable.suggest` on it.
Security / integration risks: none (pure, no I/O). T8 must pass `slots` = every slot of the version (paged .range 1000s), `sections` = in-scope only, `periods` = non-break, `assignments` = active teachers only.
Follow-ups: T8 query `timetable.suggest`.
New dependencies (justification): none
Assumptions made:
- `truncated` = true only when a further feasible suggestion existed after `limit` was reached (limit hit with nothing left → false).
- Texts cut to M19 limits (200/500/300) as 199/499/299 chars + "…" (items rule); `owner` = "Timetable manager".
- homeRoom counts only slot rooms present in `rooms` (no name → no room text); section label ties broken by id; periods ties by id.
- Name ordering uses localeCompare("en"); id tie-breaks use code-unit compare.
