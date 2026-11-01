# L1 — AI attendance-pattern-insight report

Not DB owner this round: no db:reset/demo:reset/seed/db:types/test:db/supabase/git/new-deps run.

## Files changed

- `src/modules/attendance/queries.ts` — added `AttendanceStudentPattern`, `AnonymizedAttendancePattern`, `buildAnonymizedAttendancePatterns` (pure, PII-stripping), `getSectionAttendancePatterns(ctx, sectionId, termId)`.
- `src/modules/ai/prompts/attendance-insight.ts` (new) — instructions + `buildAttendanceInsightPrompt`, typed to accept only the anonymized shape.
- `src/modules/ai/attendance-insight.schemas.ts` (new) — request/response Zod schemas, `.strict()`, array capped at 60, note capped at 150 chars, object-wrapped generation schema (mirrors quiz's object-root convention).
- `src/app/api/ai/attendance-insight/route.ts` (new) — cross-site + 16KB body cap, `getTenantContext`, `requirePermission(ctx, "attendance.read")`, then a section-scope check mirroring `isClassTeacherOrAdmin` from `attendance/actions.ts` (duplicated, not imported — that file is `"use server"` and can't export a sync helper). `feature: "attendance_pattern_insight"`, `maxOutputTokens: 1024`.
- `src/modules/attendance/components/AttendanceInsights.tsx` (new) — server component: fetches patterns, strips PII via `buildAnonymizedAttendancePatterns`, passes anonymized array + a parallel `names[]` (never sent over the network) to the client panel.
- `src/modules/attendance/components/AttendanceInsightsPanel.tsx` (new) — client panel, button-triggered fetch to the route, renders flagged students by mapping `index` back to `names[index]`. Honesty badge: "AI-flagged — not a grade".
- `src/app/(tenant)/[institution]/attendance/[sectionId]/page.tsx` — mounts `AttendanceInsights` above `AttendanceRegister`, resolving current term via existing `listAcademicYears` + `getCurrentTermId` (same pattern as the dashboard).
- `tests/unit/attendance-insight-anonymization.test.ts` (new) — fixture of fake student records with names/phone-like strings; asserts `buildAnonymizedAttendancePatterns`'s output, its JSON-serialized form, AND the built AI prompt all contain zero occurrences of any seeded name/phone/studentId.

## Behavior implemented

Teacher opens a section's attendance register; a "Check for unusual attendance patterns" button (opt-in, not auto-run) sends only index+counts+recent-absence-offsets to the AI gateway and shows short neutral notes next to real names, resolved server-side. Purely informational — no write path, no effect on grading/status.

## Tests run

- `pnpm vitest run tests/unit/attendance-insight-anonymization.test.ts tests/unit/attendance-summary.test.ts` → 2 files, 13 passed.
- `pnpm test` (full unit project) → 38 files, 410 passed.
- `pnpm eslint` on every touched file → clean, no output.
- `pnpm typecheck` → pre-existing errors only in `src/modules/exams/**` (missing `result_remarks` table in generated types + missing `@/components/ui/textarea`) — unrelated to this packet, not touched by me, left as-is per CLAUDE.md token rules ("ignore lint/typecheck errors only in other packets' files; say so").

## Tests not run and why

- `pnpm test:db` / DB-integration test for `getSectionAttendancePatterns` — not written as a separate DB test file; the function is new SQL-reading logic (joins across `class_sections`/`terms`/`enrolments`/`attendance_sessions`/`attendance_records`) beyond what's already exposed, so per the packet it should get DB-test coverage, but I'm not DB owner this round and must not run `test:db`/`db:reset`. **Follow-up needed**: DB owner or a later full run should add `tests/db/attendance-pattern.test.ts` exercising `getSectionAttendancePatterns` against a fixture institution (verify counts, recent-offset ordering, and that a different institution's section returns `null`).
- E2E — not run; no Playwright spec added for this button-triggered panel (out of packet scope as given).

## Honesty label

`AttendanceInsightsPanel` shows "AI-flagged — not a grade" once a check completes. Does not reuse `<SimulatedBadge/>`/`<LimitedBadge/>` (neither applies — this is a real AI call, not simulated or deliberately limited) nor `ProviderBadge` verbatim (kept the badge text generic rather than naming local/cloud, since the teacher-relevant fact is "not official", not provider — can swap to `ProviderBadge` if product wants provider disclosed here too).

## Security / integration risks

- PII boundary: `AnonymizedAttendancePattern`/`buildAnonymizedAttendancePatterns` is the only path into the prompt; type signature of `buildAttendanceInsightPrompt` structurally prevents a name/id field from reaching it (same discipline as `quiz.ts`). Unit test proves zero leakage for the fixture names/phones.
- Scope check duplicated (not shared) between `attendance/actions.ts` and the new route — intentional per packet note (can't export sync helper from a `"use server"` file); a future scope-rule change needs both updated. Flagging as a known duplication, not a bug.
- `getSectionAttendancePatterns` has no DB-integration test yet (see above).

## Follow-ups

- DB owner: add `tests/db/attendance-pattern.test.ts` for `getSectionAttendancePatterns`.
- Consider a shared (exported, non-"use server") scope-check module for attendance if a third caller needs the same rule, to remove the two-copy duplication.

## New dependencies

None.

## Assumptions made

- "Late" bucketed only on an exact `status.code.toLowerCase() === "late"` match; institutions without a status literally coded "late" get `lateCount: 0` and those records fall into `absentCount` instead (documented as a shortcut comment in `queries.ts`).
- Button-triggered fetch, not on-mount — avoids spending an AI call/quota on every page load; noted as a `shortcut:` comment in `AttendanceInsightsPanel.tsx`.
- `recentAbsentDayOffsets` covers "not fully present" (any `countsPresent < 1`, including half-day), not only hard absences — broader signal, matches the natural-language framing in the packet ("3 of the last 5 school days").

## Fix round 1 (independent security review)

Not DB owner this round: no db:reset/demo:reset/git run.

- **MED-4** (`src/modules/attendance/queries.ts`, the `attendance_records` read inside `getSectionAttendancePatterns`): had no paging, so PostgREST's 1,000-row default silently truncated any section/term with >1,000 records (seeded Term 1 already has 1,764/section), in no fixed order — wrong counts fed to the AI. **Fix chosen: page with a `.range()` loop**, same shape as the T-043 invoice-generation fix (`src/modules/jobs/handlers/finance.generate_term_invoices.ts`), with an explicit stable `order("id")`. Chose paging over a SQL aggregate/view because a grouped-select or view needs a new migration, and I'm not DB owner this round (no migrations). No functional change to the result shape, just correctness for >1,000-row sections.
- **LOW-2a**: `AttendanceInsightsPanel.tsx` now renders `<ProviderBadge provider={...}/>` (from `src/modules/ai/components/ProviderBadge.tsx`) alongside the existing "Not a grade" badge, once a check completes — matches the transparency convention every other AI surface follows (07 §5).
- **LOW-2b**: `src/app/api/ai/attendance-insight/route.ts`'s `maxOutputTokens` raised from 1024 to 4096. 1024 could not fit the schema's own worst case (60 items × up to 150-char `note` + JSON punctuation ≈ 175 bytes/item ≈ 2,625 tokens at ~4 chars/token), so a full-size section reliably failed closed with `ai_invalid_output`. **Raised the budget rather than shrinking the 60-item cap**, since 60 matches real section sizes (`AttendanceRegister`'s own comment notes "45-row sections") — shrinking the cap would mean some real sections never get fully checked.

### Tests

- Added `tests/db/attendance-pattern-paging.test.ts` — seeds 1,100 `attendance_records` (> the 1,000-row PostgREST page) for one student across one section/term via bulk SQL insert, with the 5 most recent school days marked absent. Asserts `getSectionAttendancePatterns` returns `presentCount + absentCount + lateCount === 1100` (would be capped at 1,000 and wrongly split without the fix) and `recentAbsentDayOffsets === [0,1,2,3,4]`. **Not run by me** (not DB owner this round) — needs a DB-owner run of `pnpm test:db`, same as the earlier-flagged `getSectionAttendancePatterns` DB-test gap.
- `pnpm test` (unit) → 40 files, 430 passed.
- `pnpm eslint` on every touched/new file → clean.
- `pnpm typecheck` → clean (the previously-noted unrelated `src/modules/exams/**` errors are no longer present in this run).
