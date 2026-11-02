# M25 — Briefings + AI timetable suggestions

Source: `07-master-plan-v1-v2.md` §3 M25, D43 (deterministic first; the LLM writes only the headline text). Migration: **none** — M25 writes M19's `briefings` table (migration 0092 per `10-backlog-index.md` §3, where M25 is recorded as "no migration"). No new deps, permission keys, `ErrorCode`s, job types, pages or nav items. Module keys (MOD, D45): **`ai_briefings`** (AI, default on) on `briefing.generate`, `briefings.today` and the existing `/api/ai/dashboard-briefing` gate (MOD-T10); **`timetable`** (Academics, default on) on `timetable.suggest`. Owning modules: `src/modules/insights` (owns `briefings`, M19) for all briefing code; `src/modules/timetable` for the suggestion engine. **Prereqs merged:** MOD; M11 (`exams.schedule`; `institutionTimeZone` + `localParts` in `src/modules/exams/schedule-conflicts.ts`); M13 (`calendar.forRole`); M16 (`dashboard.attendanceTrend|finance|admissions|operations`, `core.approvals.pending`); M19 (`briefings` table with service_role insert/update grants, `insight.read`, `insights.priorityActions`, `insights.riskIndicators`). Replaces fixture `DailyBrief` (`dailyBrief()` in `src/modules/fabric/demo/command.ts`) for staff roles through `briefings.today`. Guardian and student keep the fixture (they have no brief role). Row types are unchanged except the T1 CONTRACT additions.

Rulings:
- **Generation is in-request, not a job (replaces the plan's job `briefing.generate`).** The action `briefing.generate` and the route generate the brief as the calling user. Why: (1) brief sources are registered queries that need the caller's session and RLS, while the runner holds only the service role, so a job would need a SQL twin of every source plus a migration (M15/M19 precedent); (2) `pnpm jobs:run` loads handlers under plain node, which cannot import `gateway.ts` (`server-only`, `@/`), so a job could never write the AI headline (M22 finding); (3) lazy generation spends reads and AI only for roles that open a brief, and the persisted row makes every later reader that day free. No `JOB_MODULES` row. T10 records the next free D-number.
- **One row per (institution, brief role, local date)** — M19's unique key. Brief role per member role: owner, principal → `principal`; admin → `admin`; accountant → `accountant`; admissions → `admissions`; teacher → `teacher`; exam_controller, guardian, student → none. A caller generates and reads only its own brief role's row. No brief role → `forbidden` "No briefing for this role." on generate, `null` on `briefings.today`. `brief_date` and weekday = institution-local today via M11 `localParts(new Date().toISOString(), institutionTimeZone(ctx.institution.settings))`; never a new timezone helper.
- **Role-uniform sources (security).** Every reader of a row sees what its generator saw. A recipe therefore uses only sources whose result depends on (institution, role), never on the user:
  - Owner and principal hold identical permissions and RLS branches, so they share the `principal` row. Admin's approvals differ, so admin gets its own `admin` row from the same recipe.
  - `core.approvals.pending` rows of kind `agent_run` are per-user (M22 `canDecideRun`) and are never counted.
  - The teacher recipe uses no section-scoped source (attendance, insights, timetable, assignments). It uses only `calendar.forRole` and `exams.schedule` (staff-wide RLS on `academic_calendar_events`, `exams`, `exam_papers`). A teacher's personal items stay on `/today` (debt). T4 proves uniformity with two teachers of different sections.
- **Recipes.** Sources are registered queries called in parallel through `getRegisteredQueries().get(name)!(ctx.institution.slug, params)` after `await import("@/app/api/v1/query/all-queries")` (the M22-T5 pattern), so each source runs its own module gate, Zod and permission as the caller. `in7` = today + 6 days; "Monday" = local weekday 1.

  | brief role | sources (recipe order) |
  |---|---|
  | `principal`, `admin` | `dashboard.attendanceTrend {days: 14}` · `core.approvals.pending {}` · `dashboard.finance {}` · `dashboard.admissions {}` · `dashboard.operations {}` · `insights.priorityActions {}` · Monday only: `dashboard.attendanceTrend {days: 7}`, `insights.riskIndicators {}` |
  | `accountant` | `dashboard.finance {}` · `core.approvals.pending {}` · `insights.priorityActions {}` |
  | `admissions` | `dashboard.admissions {}` · `core.approvals.pending {}` · `insights.priorityActions {}` · `calendar.forRole {from: today, to: in7}` |
  | `teacher` | `calendar.forRole {from: today, to: in7}` · `exams.schedule {from: today, to: in7}` |

  A source is skipped and not cited when its name is missing from the registry, it returns `fail` (permission, module off, error), or it throws. A throw logs `[<cid>] briefing source <name> failed` with no payload. Never substitute another query. When no source succeeds → `dependency_failed` "Briefing sources are unavailable right now." and no row. `sources` = every successful call `{ query, params }`, in recipe order (≤ 20, M19 check).
- **Items** (pure code; each ≤ 200 chars, longer cut to 199 + "…"; never a person's name, an id, or free text other than event, exam and insight titles; no item when its data is null or empty). Order: Monday weekly items, then the daily items below in this order; cap 10 (M19 check).
  - `approvals` — n = rows with kind ≠ `agent_run`; n > 0 → `"<n> item(s) awaiting approval."` ("item" when n = 1), href `/<slug>/dashboard`.
  - `attendance` — points of `{days: 14}`; L = last point, P = up to 7 points before L. Text `"Attendance on <L.label>: <L.value>%"`; when P has ≥ 3 points, Δ = L.value − mean(P) rounded to 1 dp: |Δ| < 0.5 → `", in line with the previous <|P|> school days"`, else `", up|down <|Δ|> pts on the previous <|P|> school days"`; then ".". href `/<slug>/attendance`.
  - `insights` — the first 2 `PriorityAction` rows: `"Review: <title>"`, `insight_id` = id, `href` = its href.
  - `fees` — `collections` with `duePaise > 0`: pct = `Math.floor((collectedPaise * 1000) / duePaise) / 10`; rupees = `Math.floor(paise / 100).toLocaleString("en-IN")` (integer math, lesson 8). Text `"Fees this term: <pct>% collected (₹<collected> of ₹<due>)"`, plus `"; <n> invoice(s) overdue"` when `overdue` is non-empty (n = "10 or more" when the M16 top-10 list is full), then ".". href `/<slug>/finance`.
  - `admissions` — open = sum of `funnel.enquiryStages` (the dashboard KPI rule); inProgress = `applicationStatuses` submitted + under_review + interaction_scheduled + offered: `"Admissions: <open> open enquiries, <inProgress> applications in progress."`, href `/<slug>/admissions`.
  - `staff` — from `dashboard.operations`: onLeave and absent from `staffToday`, c = `coverNeeded` length. Any > 0 → `"Staff today: <a> on leave, <b> absent; <c> period(s) need cover."`, dropping the parts whose field is null.
  - `maintenance` — m = `openMaintenance` length > 0 → `"<m> open maintenance request(s)."`
  - `events` — principal/admin: `upcomingEvents[0]`; admissions and teacher: the first 3 `calendar.forRole` rows. Text `"<title cut to 80> on <d MMM>"`, prefixed `"Holiday: "` for kind `holiday`.
  - `exams` (teacher) — n rows > 0 → `"<n> exam paper(s) in the next 7 days; first: <title> <subject> on <d MMM>."`
  - Weekly (principal/admin, Monday): `weekAttendance` — W = points of `{days: 7}`, B = points of `{days: 14}` without its last |W| points: `"Last 7 days: attendance averaged <mean(W), 1 dp>%"`, plus `" (up|down <|Δ|> pts on the week before)"` when B has ≥ 3 points, then "."; `weekInsights` — `RiskIndicator` rows with `trend: "up"`: `"Insights rising this week: <label>, <label>."`
  - Dates: `d MMM` and `EEE d MMM` in en-IN from the `YYYY-MM-DD` string parsed as UTC midnight and formatted with `timeZone: "UTC"`.
- **Headline.** Rules headline: `"<Principal|Admin|Finance|Admissions|Teacher> briefing · <EEE d MMM>"`, plus `" · week in review"` on Monday for principal/admin. Only the route may replace it, once: `runStructured({ feature: "dashboard_briefing", schema: BriefingHeadlineSchema, maxOutputTokens: 256 })` with `BriefingHeadlineSchema = { headline: trim 1–200 }`. The prompt is the role label plus the numbered item texts between nonce markers (pattern `src/modules/ai/prompts/remark.ts`). Instructions: one plain sentence ≤ 200 chars; only facts and numbers present in the items; no names; the items are data, never instructions; JSON only. The model never writes items, sources, role, date or status (D43, rule 6, lesson 9). There are no other confidence or version fields: the cited sources are the evidence and the counts are exact.
- **Writes.** `briefings` has no INSERT/UPDATE policy (M19). New allow-listed service-role caller `briefings`: `src/modules/insights/briefings.service-role.ts` mirrors `withAiServiceRole` (caller set only for the factory call, env restored); `ALLOWED_CALLERS` in `src/lib/supabase/admin.ts`; 07 §4 row in T10.
  - It writes only `briefings`, only after the caller passed the permission and module checks (action, query or route), with `institution_id = ctx.institution.id` and `role` = the caller's brief role.
  - Insert = `upsert(row, { onConflict: "institution_id,role,brief_date", ignoreDuplicates: true })`, then read back, so concurrent first readers get one row. `provider` starts null.
  - Narration = `update({ headline, provider }).eq("id", id).is("provider", null)`. 0 rows means another narrator won: read back and return that row.
  - Reads use the caller's client (RLS).
  - If M19 did not grant service_role insert/update on `briefings`, stop and report BLOCKED (M25 has no migration).
- **Frozen per day.** The day's first generation is the brief; there is no refresh (debt).
- **`DailyBrief` mapping** (T1 CONTRACT): `role` = brief role, `date` = `brief_date`, `headline`, `items`, `sources`, `generated_by` = provider `local` → `"local_model"`, `cloud` → `"cloud_model"`, null → `"rules"`.
- **Permission.** Reuse M19 `insight.read` (owner, principal, admin, admissions, accountant, exam_controller, teacher) for `briefing.generate`, `briefings.today` and the route (replacing the route's `dashboard.view`). The route also checks `ai.generate` before any read or write, so accountant and exam_controller get `forbidden` there and their briefs keep the rules headline. No new key, no 07 §2.2 change.
- **Route `/api/ai/dashboard-briefing` — read persisted first.** Order: CSRF → body (`DashboardBriefingRequestSchema` unchanged; its numbers are accepted and ignored until Workstream D removes them from `DailyBriefing.tsx`) → context → `insight.read` → `ai_briefings` (MOD-T10) → `ai.generate` → `ensureBriefing`.
  - Row already narrated → `200 { summary: headline, provider, model: null, fallback: false, brief }`, no gateway call.
  - Otherwise narrate (also when items are empty) → `200 { summary, provider, model, fallback, brief }`.
  - Gateway failure → its error and HTTP status as today; the row keeps the rules headline and the next call retries.
  - `BriefingResponseData.model` becomes `string | null` (`briefings` has no model column).
- **Audit.** `briefing.generate` audits only when it created the row: `{ role, date, items: n, sources: n }`, never item text. Narration is recorded by the gateway's usage row; no audit.
- **`timetable.suggest` is a query, never a write.** Read-only (D41), so it cannot touch `timetable_slots`. A human applies chosen proposals with `timetable.saveDraft`, whose DB constraints re-check every slot. Permission `timetable.manage`, module `timetable`. Input `SuggestFillSchema {versionId: uuid, classSectionIds?: uuid[] 1–100, limit?: int 1–200 default 200}` strict. Version missing or invisible → `not_found`; status ≠ `draft` → `invalid_state` "Suggestions apply to draft versions only." Being a registered query, it is also an M24 assistant tool.
- **Proposals are `insight_actions` in shape, not rows.** `TimetableSuggestion = Pick<InsightAction, "action" | "owner" | "rationale" | "expected_outcome"> & { status: "planned"; slot: SlotInput }`: action ≤ 200, owner `"Timetable manager"`, rationale ≤ 500, expected_outcome ≤ 300 — the exact text arguments of M19 `record_insight_action`. Storing them needs a parent insight with a signal for unfilled cells, which needs a migration: debt row, not M25. Output `{ versionId, engineVersion: 1, suggestions, unfilled, truncated }`. No LLM call. No confidence: feasibility is binary and the DB re-checks on apply.
- **Engine `fill_v1`** (pure `suggestFill`, deterministic):
  1. Cells = weekdays 1–6 × non-break periods (by `seq`) for each in-scope section (sections of the version's academic year, filtered by `classSectionIds`). `cellsPerWeek = 6 × periods`.
  2. Per section: its `subject_assignments` whose teacher is active, ordered by subject name, then subject id; k = their count; `target_i = floor(cellsPerWeek / k) + (i < cellsPerWeek mod k ? 1 : 0)`; `count` = the section's existing slots of that subject; `deficit = target − count`.
  3. Occupancy comes from **all** slots of the version (every section), paged with `.range()` in 1000s (M19 found bug: M07 queries truncate at 1000 rows): section, teacher and room busy sets per (weekday, period); `load(teacher)` = the teacher's slots in the version; `dayCount(section, weekday, subject)`.
  4. `homeRoom(section)` = the room with the most slots of that section in the version (ties: room name, then id); none → null.
  5. Visit sections by label `<grade code>-<section name>` (`localeCompare(…, "en", { numeric: true })`), then weekdays 1→6, then periods by `seq`; skip busy cells. Candidates: deficit > 0, teacher free in the cell, `load < maxPeriodsPerWeek(ctx)` (`settings.timetable.max_periods_week`, default 36), `dayCount < 2` (`MAX_SAME_SUBJECT_PER_DAY`). Pick the largest deficit, then the lower load, then subject name, then subject id. Room = homeRoom when free, else none (`roomId` omitted). Emit, then update every counter and busy set (the room set only when a room was chosen).
  6. Stop at `limit` with `truncated = true`. `unfilled` = empty in-scope cells before the pass − suggestions emitted. Cells with no feasible candidate are skipped.
  7. Texts: action `"Add <subject> to <section>, <Mon..Sat> period <seq> (<period name>), with <teacher>[ in <room>]"`; rationale `"<teacher> is free in this period[ and <room> is free]; <subject> has <count> of <target> periods a week in <section>."`; expected_outcome `"<section> <subject>: <count + 1> of <target> periods a week."` Teacher full names are already visible to `timetable.manage` holders.
- **ErrorCode map.** `forbidden` (permission; module off via MOD; no brief role; route without `ai.generate`) · `not_found` (suggest version) · `invalid_state` (suggest on a non-draft) · `validation_failed` (Zod) · `dependency_failed` (no source succeeded) · `internal` (write errors via `mapSqlError`; never raw SQL text) · gateway codes pass through on the route.

Routing: T1 haiku none [] ; T2 sonnet none [1] ; T3 opus none [] ; T4 sonnet tests [2] ; T5 sonnet tests [4] ; T6 haiku none [] ; T7 sonnet tests [4,6] ; T8 sonnet tests [3] ; T9 sonnet tests [5,7,8] ; T10 haiku none [9]

Every new action: manifest import in `src/app/api/v1/actions/all-actions.ts` + C-03 fixture in `tests/security/escalation.test.ts`. Every new query: its `query-defs.ts` (`insights` and `timetable` files are already in `all-queries.ts`) + smoke sample in `tests/db/api-query-route.test.ts`. `tests/security/module-gate.test.ts` covers the new names automatically. Single-file db runs: `pnpm test:db tests/db/x.test.ts` (no `--`). Shared files (`admin.ts`, `allow-list.test.ts`, `eslint.config.mjs`, `all-actions.ts`, `escalation.test.ts`, `api-query-route.test.ts`, `timetable/schemas.ts`, `timetable/query-defs.ts`, `insights/query-defs.ts`): Edit only, never Write — M22 and others edit them concurrently. `timetable/schemas.ts` and `timetable/suggest.ts` keep relative `.ts` imports. Review (Sonnet security) after T4, T5, T7.

---

### Task 1: M25-T1 CONTRACT — `DailyBrief` sources + generator values (Haiku)
READ: BRIEF-COMMON.md; rulings (`DailyBrief` mapping); `src/modules/fabric/types.ts` (`DailyBrief`); `docs/planning/fabric/05-data-contracts.md` §3 "Derived: Command Centre"
FILES: `src/modules/fabric/types.ts` (Edit); `docs/planning/fabric/05-data-contracts.md` (Edit, CONTRACT, additive)
MIGRATION: none
EXPORTS: `export interface BriefingSource { query: string; params: Record<string, unknown> }`; `DailyBrief.generated_by: "fixture" | "local_model" | "rules" | "cloud_model"`; `DailyBrief.sources?: BriefingSource[]`. Same text in the contracts row.
TEST FIRST: none new (type-only, additive); the existing fixture tests prove the fixtures stay valid.
ACCEPT: `pnpm test tests/unit/fabric-fixtures`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 2: M25-T2 Briefing composer — recipes, items, headline (Sonnet)
READ: BRIEF-COMMON.md (lesson 8); rulings (Brief role, Role-uniform sources, Recipes, Items, Headline); T1 types; result types `TrendPoint`, `ApprovalRow`, `FinanceDashboard`, `AdmissionsDashboard`, `OperationsDashboard` (M16), `CalendarEventRow` (M13), `ExamScheduleRow` (M11), `PriorityAction`, `RiskIndicator` (`fabric/types.ts`); `tests/unit/agents-tools.test.ts` (manifest import + server mock pattern)
FILES: `src/modules/insights/briefing-compose.ts` (new; pure, no `server-only`; other modules via `import type` only); `tests/unit/insights-briefing.test.ts` (new)
MIGRATION: none
EXPORTS: `type BriefRole = "principal" | "admin" | "accountant" | "admissions" | "teacher"`; `BRIEF_ROLE: Readonly<Partial<Record<Role, BriefRole>>>`; `BRIEF_ROLE_LABEL: Readonly<Record<BriefRole, string>>`; `briefingSources(role: BriefRole, today: string, weekday: number): BriefingSource[]`; `interface BriefingSourceResult extends BriefingSource { data: unknown }`; `composeBriefing(input: { role: BriefRole; slug: string; today: string; weekday: number; results: readonly BriefingSourceResult[] }): { headline: string; items: DailyBrief["items"]; sources: BriefingSource[] }`.
TEST FIRST:
- Canned principal results → exact item texts, in order: approvals, attendance, 2 insights, fees, admissions, staff, maintenance, events.
- `agent_run` approvals are not counted; 0 → no approvals item.
- Fees 12,345,678 of 20,000,000 paise → `"Fees this term: 61.7% collected (₹1,23,456 of ₹2,00,000)."`.
- Attendance: up, down and "in line" cases; fewer than 3 previous points → no comparison.
- A source missing from `results` → no item and not in `sources`.
- Monday principal: `briefingSources` adds `{days: 7}` and `insights.riskIndicators`; weekly items come first; headline ends `" · week in review"`; never more than 10 items.
- Teacher `briefingSources` = exactly `calendar.forRole` + `exams.schedule` with `from`/`to` = today/today+6.
- Every text ≤ 200 chars and contains no UUID.
- Every recipe query name is registered (`await import` the query manifest under `vi.mock("@/lib/supabase/server", …)`; `getRegisteredQueries()`).
ACCEPT: `pnpm test tests/unit/insights-briefing.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 3: M25-T3 Timetable fill engine `fill_v1` + schema (Opus)
READ: BRIEF-COMMON.md; rulings (`timetable.suggest`, Proposals, Engine `fill_v1`); `src/modules/timetable/schemas.ts` (`SlotInputSchema`); `InsightAction` in `src/modules/fabric/types.ts`; `scripts/seed/sections/timetable.ts` (greedy precedent)
FILES: `src/modules/timetable/suggest.ts` (new; pure; relative `.ts` imports, `import type` for fabric types); `src/modules/timetable/schemas.ts` (Edit: add only); `tests/unit/timetable-suggest.test.ts` (new)
MIGRATION: none
EXPORTS: `SUGGEST_ENGINE_VERSION = 1`; `MAX_SAME_SUBJECT_PER_DAY = 2`; `interface SuggestInput { periods: { id; seq; name }[]; sections: { id; label }[]; assignments: { classSectionId; subjectId; subjectName; teacherId; teacherName }[]; slots: { classSectionId; weekday; periodId; subjectId; teacherId; roomId: string | null }[]; rooms: { id; name }[]; maxPeriodsWeek: number; limit: number }` (`slots` = the whole version, `sections` = in scope only, `periods` = non-break); `TimetableSuggestion`; `suggestFill(input: SuggestInput): { suggestions: TimetableSuggestion[]; unfilled: number; truncated: boolean }`. Schemas: `SuggestFillSchema` + `SuggestFillInput`.
TEST FIRST:
- An empty cell gets the subject with the largest deficit; a teacher busy in another section at that cell is skipped for the next candidate.
- A teacher at `maxPeriodsWeek` is never proposed; a section never gets a third same-subject period in one day.
- The home room is used when free; when busy, `slot.roomId` is absent.
- Across existing slots + suggestions, (teacher, weekday, period) and (room, weekday, period) are unique.
- Same input twice, or with shuffled `assignments`/`slots` order → deep-equal output.
- `limit: 3` → 3 suggestions, `truncated: true`, `unfilled` = empty cells − 3; a section without assignments → its cells counted in `unfilled`.
- Each `slot` parses with `SlotInputSchema`; text lengths within the limits; `status` `planned`.
- `SuggestFillSchema`: `limit: 201` and unknown keys rejected; 101 section ids rejected.
ACCEPT: `pnpm test tests/unit/timetable-suggest.test.ts tests/unit/timetable-schemas.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 4: M25-T4 Briefing service + service-role caller `briefings` (Sonnet)
READ: BRIEF-COMMON.md (lessons 3, 10, 13); rulings (Brief role, Role-uniform sources, Recipes, Writes, Frozen, mapping); T2 composer; `src/lib/ai/usage.ts` (`withAiServiceRole`); `src/lib/supabase/admin.ts`; M22-T7 card (allow-list + eslint precedent); M19 0092 `briefings` DDL and grants; `tests/helpers/insight-fixtures.ts` (M19 plants)
FILES: `src/modules/insights/briefings.service-role.ts` (new); `src/modules/insights/briefings.ts` (new, `server-only`); `tests/db/briefings-service.test.ts` (new); + `"briefings"` in `ALLOWED_CALLERS` and its error message (`src/lib/supabase/admin.ts`), `ADMIN_IMPORT_ALLOWED` (`tests/security/allow-list.test.ts`) and the `no-restricted-imports` override (`eslint.config.mjs`) gain `src/modules/insights/briefings.service-role.ts`
MIGRATION: none
EXPORTS:
- service-role: `briefingsAdmin(): SupabaseClient<Database>`.
- service: `briefRoleFor(ctx): BriefRole | null`; `localToday(ctx): { date: string; weekday: number }`; `buildBriefing(ctx): Promise<ActionResult<{ role: BriefRole; date: string; headline: string; items: DailyBrief["items"]; sources: BriefingSource[] }>>` (runs the sources, composes, writes nothing); `ensureBriefing(ctx): Promise<ActionResult<{ id: string; created: boolean; provider: "local" | "cloud" | null; brief: DailyBrief }>>` (existing row → it; else `buildBriefing` → upsert → read back); `readBriefing(ctx): Promise<DailyBrief | null>`; `setBriefingHeadline(id: string, headline: string, provider: "local" | "cloud"): Promise<boolean>`; `toDailyBrief(row): DailyBrief`.
- Callers check permission and module first; these functions never do.
TEST FIRST (fixture institution with M19 plants; `vi.mock("@/lib/supabase/server", …)`; `callAs`):
- Principal → row role `principal`, `provider` null, ≥ 3 sources, all registered; items contain no fixture person name and no UUID.
- Second call → same id, `created: false`. Owner → the same row. Admin → a separate `admin` row.
- Teacher A, then teacher B of another section → B gets A's row, and `buildBriefing` as B returns the same items and sources.
- Exam_controller → `forbidden`.
- `insights` off → no `insights.*` source; the row still persists.
- `getRegisteredQueries` spied to an empty Map → `dependency_failed`, no row.
- Principal ‖ owner concurrently → one row.
- Faked Monday (`vi.setSystemTime(new Date("2026-11-02T03:30:00Z"))`, Date only) → weekly sources present, headline ends `" · week in review"`.
- `setBriefingHeadline` twice → `true`, then `false`; the row keeps the first headline.
ACCEPT: `pnpm test:db tests/db/briefings-service.test.ts`; `pnpm test:security tests/security/allow-list.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 5: M25-T5 Action `briefing.generate` + query `briefings.today` (Sonnet)
READ: BRIEF-COMMON.md (lessons 10, 13); rulings (Permission, Audit, ErrorCode map); T4 service; `src/modules/timetable/actions.ts` (action style); M19 `src/modules/insights/query-defs.ts`
FILES: `src/modules/insights/briefing.actions.ts` (new, `"use server"`); `src/modules/insights/query-defs.ts` (Edit: one def); `tests/db/briefing-actions.test.ts` (new); + manifest line + C-03 fixture `{}` + smoke sample `briefings.today` `{}`
MIGRATION: none
EXPORTS: `generateBriefing = defineAction({ name: "briefing.generate", module: "ai_briefings", schema: z.object({}).strict(), permission: "insight.read", handler })` → `ensureBriefing`; `fail` → `AppError(code, message)`; audit `briefing.generate` when `created`; returns `DailyBrief`. Query def `briefings.today` (`z.object({}).strict()`, `insight.read`, module `ai_briefings`) → `readBriefing(ctx)` → `DailyBrief | null`.
TEST FIRST:
- Principal generate → `generated_by` `rules`, `sources.length ≥ 3`, one audit row with counts only (no item text).
- Generate again → the same brief and still one audit row.
- `briefings.today` before → `null`; after → equal to the generated brief.
- Teacher → a `teacher` brief. Guardian → `forbidden`. Exam_controller: generate → `forbidden` "No briefing for this role.", today → `null`.
- **`ai_briefings` off → both names `forbidden` with `MODULE_DISABLED_MESSAGE`.**
ACCEPT: `pnpm test:db tests/db/briefing-actions.test.ts tests/db/api-query-route.test.ts`; `pnpm test:security tests/security/escalation.test.ts tests/security/module-gate.test.ts`; `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: `DailyBrief` (`dailyBrief()`, staff roles) via `briefings.today`

### Task 6: M25-T6 Headline prompt + schema (Haiku)
READ: BRIEF-COMMON.md (lesson 9); rulings (Headline); `src/modules/ai/prompts/remark.ts` (nonce markers), `src/modules/ai/prompts/dashboard-briefing.ts`, `src/modules/ai/dashboard-briefing.schemas.ts`
FILES: `src/modules/ai/prompts/dashboard-briefing.ts` (Edit: add); `src/modules/ai/dashboard-briefing.schemas.ts` (Edit: add); `tests/unit/dashboard-briefing-prompt.test.ts` (Edit: add cases)
MIGRATION: none
EXPORTS: `BRIEFING_HEADLINE_INSTRUCTIONS`; `buildBriefingHeadlinePrompt(input: { roleLabel: string; items: readonly string[] }): string` — a fresh nonce per call (the file-local `randomNonce` style of `remark.ts`), markers `` `<<<BRIEFING_ITEMS_START:${nonce}>>>` `` / `` `<<<BRIEFING_ITEMS_END:${nonce}>>>` ``, one numbered line per item, `(no items)` when empty; `BriefingHeadlineSchema = z.object({ headline: z.string().trim().min(1).max(200) }).strict()` + `BriefingHeadlineOutput`. Legacy exports untouched (T7 deletes them).
TEST FIRST: both markers present with the same nonce, and two calls use different nonces; items appear numbered inside the markers; an item containing a fake end marker stays inside the real block; empty items → `(no items)`; the schema rejects 201 chars and extra keys, and trims whitespace.
ACCEPT: `pnpm test tests/unit/dashboard-briefing-prompt.test.ts tests/unit/dashboard-briefing-schema.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 7: M25-T7 Route `/api/ai/dashboard-briefing` reads persisted first (Sonnet)
READ: BRIEF-COMMON.md (lessons 9, 10); rulings (Route, Headline, Writes, Permission); T4 service; T6 exports; `src/app/api/ai/dashboard-briefing/route.ts`; `tests/db/quiz-route.test.ts` (gateway mock + request pattern); `tests/unit/ai-route-modules.test.ts` (MOD-T10)
FILES: `src/app/api/ai/dashboard-briefing/route.ts` (Edit); `tests/db/dashboard-briefing-route.test.ts` (new); deletions only: the legacy `DASHBOARD_BRIEFING_INSTRUCTIONS` + `buildDashboardBriefingPrompt` (prompt file), `DashboardBriefingOutputSchema` + its type (schemas file) and their cases in `tests/unit/dashboard-briefing-prompt.test.ts` / `-schema.test.ts`; `tests/unit/ai-route-modules.test.ts` mocks only if the new flow needs them (say so)
MIGRATION: none
EXPORTS: route behaviour per the rulings; `BriefingResponseData = { summary: string; provider: "local" | "cloud"; model: string | null; fallback: boolean; brief: DailyBrief }`.
TEST FIRST (`runStructured` mocked):
- Principal → 200, `summary` = the mocked headline, row `provider` `local`, `brief.generated_by` `local_model`. The captured prompt has both nonce markers, no UUID and no fixture person name.
- Owner next → 200 with the same summary and `model: null`; the gateway is not called again.
- Mocked `ai_unavailable` → 502; the row exists with the rules headline; a later call narrates it.
- Accountant → 403 and no `briefings` row created. Teacher → 200 with the teacher brief. Guardian → 403. Cross-site → 403.
ACCEPT: `pnpm test:db tests/db/dashboard-briefing-route.test.ts`; `pnpm test tests/unit/ai-route-modules.test.ts tests/unit/dashboard-briefing-prompt.test.ts tests/unit/dashboard-briefing-schema.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 8: M25-T8 Query `timetable.suggest` (Sonnet)
READ: BRIEF-COMMON.md; rulings (`timetable.suggest`, Engine `fill_v1` steps 1–4); T3 engine + schema; `src/modules/timetable/queries.ts` (`maxPeriodsPerWeek`, section label, version lookup) + `query-defs.ts`; `supabase/migrations/20261028000004_people.sql` (staff active column); `tests/db/timetable-queries.test.ts` (fixture pattern)
FILES: `src/modules/timetable/suggest.queries.ts` (new); `src/modules/timetable/query-defs.ts` (Edit: one def); `tests/db/timetable-suggest.test.ts` (new); + `export` on `maxPeriodsPerWeek` in `queries.ts` (one word) + smoke sample `{ versionId: UUID }`
MIGRATION: none
EXPORTS: `suggestTimetableFill(ctx, input: SuggestFillInput): Promise<{ versionId: string; engineVersion: 1; suggestions: TimetableSuggestion[]; unfilled: number; truncated: boolean }>` — user client; loads the version (`not_found` / `invalid_state`), non-break periods, the year's sections (+ `classSectionIds` filter), their assignments with subject names and active teachers' full names, rooms, and every slot of the version paged with `.range()` in 1000s; calls `suggestFill`. Def `timetable.suggest` (`SuggestFillSchema`, `timetable.manage`, module `timetable`).
TEST FIRST:
- Admin builds rooms, 3 teaching periods + 1 break, a draft, 2 sections and assignments, saves some slots → suggestions fill the empty cells. Saving every suggested `slot` through `timetable.saveDraft` succeeds (no conflict), and `unfilled` equals the cells still empty.
- The suggest call leaves the `timetable_slots` count unchanged.
- Published version → `invalid_state`; unknown id → `not_found`; teacher → `forbidden`.
- Paging: a draft with 1,007 slots (21 sections × 4 subjects, one teacher per section-subject, 8 teaching periods, 2 per subject per day, bulk-inserted with the service role, one cell removed) → exactly 1 suggestion, for the removed cell.
ACCEPT: `pnpm test:db tests/db/timetable-suggest.test.ts tests/db/api-query-route.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 9: M25-T9 Acceptance over HTTP + seeded tenant (Sonnet)
READ: BRIEF-COMMON.md; rulings; `tests/db/timetable-acceptance.test.ts` (route + bearer pattern); `tests/helpers/insight-fixtures.ts`; T4–T8 tests
FILES: `tests/db/briefings-acceptance.test.ts` (new)
MIGRATION: none
TEST:
- Principal `POST /api/v1/actions/briefing.generate` → 200 with ≥ 3 sources. **The briefing row links ≥ 3 queries**: for every source, the principal's `POST /api/v1/query/<query>` with its params → 200.
- Owner generate → the same brief; one row.
- `briefings.today`: principal → equal brief; teacher before generating → `null`; teacher generate → role `teacher`, sources ⊆ {`calendar.forRole`, `exams.schedule`}. Guardian → 403 on both names.
- `core.module.set {key: "ai_briefings", enabled: false}` → both names 403 `forbidden` with `MODULE_DISABLED_MESSAGE`, and the route → `ai_unavailable`; re-enable.
- Admin builds a draft → `timetable.suggest` → 200, non-empty. **The `timetable_slots` count is unchanged by the suggest call.** `timetable.saveDraft` with every `slot` → 200; suggest again → no proposal for a filled cell. Teacher `timetable.suggest` → 403.
- Seeded tenant, read-only: `buildBriefing` as the demo principal (no write) → ≥ 3 successful sources and ≥ 3 items; print the item texts into the report.
ACCEPT: `pnpm test:db tests/db/briefings-acceptance.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 10: M25-T10 Docs (Haiku)
FILES (Edit only):
- `docs/planning/coolskool/12-decision-log.md`:
  - Next free D-number: "M25 briefings generate in-request as the caller (`briefing.generate`, `/api/ai/dashboard-briefing`), not as job `briefing.generate`" with the three reasons from the rulings, and "timetable suggestions come from a read-only query in `insight_action` shape and are never stored".
  - Next free DBT rows: no brief exists for a role and day until someone of that role opens one (no nightly job, no push); a brief is frozen at its first generation; the teacher brief is role-wide (calendar + exam schedule) and personal items stay on `/today` (per-user briefs need a `user_id` column); `agent_run` approvals are never counted in briefs; accountant briefs keep the rules headline (no `ai.generate`); `briefings` has no model column, so stored narrations return `model: null`; guardian and student keep the `dailyBrief()` fixture; suggestions are not stored as `insight_actions` rows (needs an unfilled-cells insight signal, i.e. a migration); `fill_v1` targets an even split of teaching cells across a section's subjects (no per-subject weekly quota column), max 2 same-subject periods a day, home room = most-used room; Monday weekly items cover only attendance and insight trends.
- `docs/planning/coolskool/07-security-and-ai-governance.md`: §4 row `src/modules/insights/briefings.service-role.ts` (M25): caller `briefings`; writes only `briefings` (upsert by the unique key, conditional headline update) after the caller's permission + module checks; `institution_id` from ctx; no definer. §5: the `dashboard_briefing` flow now sends only code-written item texts (counts, percentages, event/exam/insight titles; no names, no ids) between nonce markers and stores only the headline.
- `docs/planning/coolskool/05-data-architecture.md` §3: the `briefings` writer is `src/modules/insights/briefings.ts` (in-request).
- `docs/planning/coolskool/06-workflows-and-contracts.md` §7: no job `briefing.generate` (see the D-number).
- `docs/planning/coolskool/03-feature-matrix.md`: briefings → built, limited (rules + AI headline); timetable suggestions → built, limited (rule-based; applied through `timetable.saveDraft`).
- `docs/planning/fabric/03-roadmap-and-tracker.md`: the M25 rows; honesty labels: the headline keeps `ProviderBadge` + "AI-written summary"; suggestions get `<LimitedBadge>` "Rule-based — review before saving" (Workstream D).
- `docs/planning/coolskool/10-backlog-index.md` §3: M25 "no migration" → built.

ACCEPT: `pnpm lint`
REPLACES FIXTURE: none

---

Controller after T10: Sonnet security review on the T4, T5, T7 and T8 diffs (service-role writes, role uniformity, prompt content, suggest read path); full gate; `pnpm db:reset` + `pnpm seed` clean; commit/push; no hosted push (no migration); `DONE M25 <sha>`.
