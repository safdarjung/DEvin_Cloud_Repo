# M19 — Insights engine

Source: `07-master-plan-v1-v2.md` §3 M19, D43 (deterministic intelligence first). Migration `0092` (claimed; one file `supabase/migrations/20261028000092_insights.sql`, written T2 → T3 → T4 → T5 → T6, each appending one part). Module key **`insights`** (catalog default off, D45; already in MOD's catalog and in `app.module_enabled`, so no catalog or 0084 change). New owning module `src/modules/insights` (owns `insights`, `insight_actions`, `briefings`). The job `insights.detect` lives in `src/modules/jobs/handlers`. No new deps. **Prereqs merged:** M07–M18, MOD, V1-GATE. Specifically: M12 0074 (`payment_reversals`), M13 0075 (`assets`, `maintenance_requests`), M15 (runner sweep port `enqueueDueReports`, the precedent for T15), M16 (`src/modules/core/approvals.queries.ts`). Replaces these fixtures, with row types unchanged except the T1 CONTRACT additions:
- `Insight` + `InsightAction`: `insights()` / `insightActions()` in `src/modules/fabric/demo/insights.ts`.
- `PriorityAction` + `RiskIndicator`: `priorityActions()` / `riskIndicators()` in `src/modules/fabric/demo/command.ts`.
- `demoInsights` for staff roles: `AIInsightCardProps[]` in `src/modules/core/demo/fixtures.ts`. Student and guardian keep the fixture, because 07 §2 gives them no insight access.

No pages are swapped (that is Workstream D). Not built here: the `briefings` writer and query (M25), seed rows (M27 section `fabric`), `DailyBrief`, `ForecastCard`.

Rulings:
- **0092 runs after 0091; plain SQL fine.** Runs after timetable (0069), the submission columns (0071), `payment_reversals` (0074), `assets`/`maintenance_requests` (0075) and `app.module_enabled` (0084). Functions may use any prior table and feature (including plpgsql late binding). Each part runs `pnpm db:reset` from empty.
- **Tables.** Every table has `institution_id → institutions not null`, `created_at`/`updated_at` with the `app.set_updated_at()` trigger, and RLS on.
  - **`insights`** columns:
    - `id`; `signal` text, checked against the 11 keys in the signals table; `detector_version` int ≥ 1; `dedupe_key` text, 1–200 chars.
    - `domain`, `kind`, `severity`: each checked against its union in `src/modules/fabric/types.ts` (`InsightDomain`, `InsightKind`, `InsightSeverity`).
    - `title` 1–120; `pattern` 1–300; `evidence` jsonb array of 1–8 elements; `sources text[]` with cardinality ≤ 8, default `'{}'`.
    - `date_from` ≤ `date_to` (dates); `confidence numeric(3,2)` between 0 and 1; `factors` jsonb array of ≤ 5, default `'[]'`.
    - `reviewer_role` checked in (owner, principal, admin, admissions, accountant, exam_controller); `recommended_actions text[]` with cardinality ≤ 3, default `'{}'`; `approval_required` bool, default false.
    - `status` default `'new'`, checked in (new, reviewing, actioned, resolved, dismissed).
    - `entity_type` null, checked in (section, student, staff, route, fee_structure, department); `entity_id uuid` null; check `(entity_type is null) = (entity_id is null)`.
    - `entity_label` ≤ 60 null, with a check that it is null when `entity_type in ('student','staff')`. Person names are never copied (CLAUDE.md one-owner rule).
    - `class_section_id → class_sections` null: the section scope of section and student insights, used by teacher RLS.
    - Explanation columns: `explanation` jsonb null; `explained_at` null; `explained_by → profiles` null; `explanation_provider` null, checked in (local, cloud); `explanation_model` ≤ 100 null.
    - Review columns: `reviewer_id → profiles` null; `decided_by → profiles` null; `decided_at` null; `decision_note` ≤ 500 null.
    - Constraints: unique `insights_dedupe_key (institution_id, dedupe_key)`. Partial unique `insights_open_key (institution_id, signal, entity_type, entity_id) nulls not distinct where status in ('new','reviewing','actioned')`, so a persisting problem keeps its first row. Indexes `(institution_id, status, created_at desc)` and `(class_section_id)`.
  - **`insight_actions`** is append-only (02-architecture §4). Columns: `id`; `insight_id → insights not null`; `supersedes_id → insight_actions` null, with partial unique `where supersedes_id is not null` (one successor per row); `action` 1–200; `owner` 1–80; `rationale` 1–500; `expected_outcome` 1–300; `actual_outcome` ≤ 500 null; `decided_at timestamptz not null default now()`; `measured_at` null; `status` in (planned, done, measured). Check `status <> 'measured' or (actual_outcome is not null and measured_at is not null)`. `created_by → profiles not null`; index `(insight_id)`. The **current** row is the one no other row supersedes.
  - **`briefings`** is table-only here; M25 writes and reads it. Columns: `id`; `role` checked in (owner, principal, admin, admissions, accountant, exam_controller, teacher); `brief_date` date; `headline` 1–200; `items` jsonb array of ≤ 10 (`DailyBrief.items`); `sources` jsonb array of ≤ 20 (`{query, params}`); `provider` null, checked in (local, cloud), where null means rules only (M25 maps it to `generated_by`). Unique `(institution_id, role, brief_date)`.
- **RLS** (07 §2.2, lessons 1/7). None of the three tables has an INSERT, UPDATE or DELETE policy: only the service-role job and the definers below write (lesson 3).
  - `insights` SELECT is the OR of these branches:
    - `institution_id = any((select app.my_institution_ids(array['owner','principal','admin'])))`
    - `(domain = 'admissions' and institution_id = any((select app.my_institution_ids(array['admissions']))))`
    - the same for `finance` with `array['accountant']`
    - the same for `academics` with `array['exam_controller']`
    - `(domain in ('attendance','academics') and class_section_id = any((select app.my_taught_section_ids())))`
  - So the `staff` and `operations` domains are visible to owner/principal/admin only, and guardians/students see nothing.
  - `insight_actions` SELECT = `exists (select 1 from public.insights i where i.id = insight_actions.insight_id and i.institution_id = insight_actions.institution_id)`. It inherits the `insights` RLS.
  - `briefings` SELECT: owner/principal/admin see all. Every other staff role sees rows whose `role` is its own. Write one branch per role with a literal array (no per-row helper argument).
- **Permissions.**
  - `insight.read` = owner, principal, admin, admissions, accountant, exam_controller, teacher. RLS scopes the rows.
  - `insight.review` = owner, principal, admin, admissions, accountant, exam_controller.
- **Review rights and visibility helpers** (plpgsql, `stable security definer`, `search_path=''`; for the definers only, never used in policies (lesson 7); execute revoked from public, anon, authenticated):
  - `app.can_review_insight(p_institution_id uuid, p_domain text)`: owner/principal/admin for any domain; admissions → `admissions`; accountant → `finance`; exam_controller → `academics`.
  - `app.user_can_review_insight(p_user_id uuid, p_institution_id uuid, p_domain text)`: the same rule for another user's active membership.
  - `app.insight_visible(p_institution_id uuid, p_domain text, p_class_section_id uuid)`: review rights OR the teacher branch of the SELECT policy.
- **State machine.** Only `public.decide_insight(p_insight_id uuid, p_action text, p_note text default null, p_reviewer_id uuid default null) returns public.insights` and `public.record_insight_action` change `status`. Both are definers. No other writer exists, because there is no UPDATE policy.

  | action | from | to | rules |
  |---|---|---|---|
  | `review` | new, reviewing | reviewing | `reviewer_id = coalesce(p_reviewer_id, caller)`. The reviewer must pass `app.user_can_review_insight`, else `code:validation_failed`. Reassigning while already `reviewing` needs owner/principal/admin. |
  | `resolve` | new, reviewing, actioned | resolved | `p_note` 5–500 (`validation_failed`); sets `decided_by/at`, `decision_note` |
  | `dismiss` | new, reviewing | dismissed | `p_note` 5–500; sets `decided_*` |
  | (record action) | new, reviewing, actioned | actioned | see `record_insight_action` |

  Error rules:
  - Caller not signed in → `code:unauthenticated`.
  - Row missing or not visible to the caller → `code:not_found`.
  - Visible, but the caller has no review right → `code:forbidden`.
  - `resolve`/`dismiss` on an `approval_required` row by anyone other than owner/principal → `code:forbidden`.
  - Any other transition → `code:invalid_state`. An unknown action → `code:validation_failed`.

  `decide_insight` audits `insight.reviewing|resolved|dismissed` with `{status}` before and after only.
- **`public.record_insight_action(p_insight_id uuid, p_action text, p_owner text, p_rationale text, p_expected_outcome text, p_status text default 'planned', p_actual_outcome text default null, p_supersedes_id uuid default null) returns public.insight_actions`** (definer). Steps:
  1. The caller needs review rights on the insight; errors are as above.
  2. The insight must be `new|reviewing|actioned`. One exception: a superseding row with `p_status='measured'` is also allowed on `resolved`. Otherwise `invalid_state`.
  3. `p_supersedes_id`, when given, must be the current row of the same insight (else `invalid_state`). Status may only move forward: planned → done → measured, or stay the same. Going back → `invalid_state`.
  4. Text lengths and the `measured` rule are checked (`validation_failed`). For `measured`, `measured_at = now()`.
  5. It inserts with `institution_id` taken from the insight and `created_by` = caller.
  6. It moves `new|reviewing` → `actioned` and audits `insight.action_recorded` (ids only).
- **AI boundary** (D43, rule 6):
  - Detection, severity, confidence, status and reviewer are deterministic.
  - The LLM writes only `explanation = { what ≤500, why ≤500, next_steps: 1–3 strings × ≤200 }`. It goes through `runStructured` (feature `insight_explain`, `maxOutputTokens: 1024`, lesson 9) and then `public.set_insight_explanation(p_insight_id uuid, p_explanation jsonb, p_provider text, p_model text) returns public.insights`.
  - `set_insight_explanation` is a definer and checks the following:
    - Not visible → `not_found`.
    - Status not `new|reviewing|actioned` → `invalid_state`.
    - Bad shape, provider not in (local, cloud), or model not 1–100 chars → `validation_failed`.
    - It writes only `explanation`, `explained_at`, `explained_by`, `explanation_provider` and `explanation_model`, never `status`.
    - It audits `insight.explained` with ids and provider.
  - The prompt carries only `toExplainInput(row)`: domain, kind, severity, title, pattern, evidence, date range, confidence, recommended_actions, entity_type. It never carries ids or names. Detectors never read names; titles use section labels like `8-A` and subject names.
  - The data block sits between nonce markers (pattern: `src/modules/ai/prompts/remark.ts`).
  - Before it reads anything, the action checks `ai.generate`. Under the existing 07 §2 AI grant, accountant and exam_controller get `forbidden`.
  - Debt: anyone who can see the row can write the explanation through the RPC. Its provenance is not bound to the gateway.
- **Detection pipeline.**
  - **Sweep** `public.enqueue_insight_detection() returns int` (plpgsql definer, `search_path=''`, execute to service_role only). For each institution with `app.module_enabled(id, 'insights')`:
    - `tz = coalesce(settings->'locale'->>'timezone', 'Asia/Kolkata')`
    - `as_of = (now() at time zone tz)::date - 1`
    - `app.enqueue_job(id, 'insights.detect', jsonb_build_object('as_of', as_of), 'insights.detect:' || id || ':' || to_char(as_of, 'YYYYMMDD'))`

    It returns the number of new jobs. The runner calls it once per tick before it claims (T15). That gives one run per institution per local day; the first tick after local midnight is the "nightly" run. The payload is built in SQL (lesson 3).
  - **Handler** `insights.detect`. Payload `{ as_of: "YYYY-MM-DD" }`, validated by a strict Zod schema in the handler file. Steps:
    1. Read `institutions.settings` with `admin`. If the `insights` module is off, return (lesson 11).
    2. For each entry of `DETECTORS`, in order: skip it when its `module` is off; otherwise run `run()`, then `capPerSignal(…, 20)`, then `record_insights`.
    3. If a detector throws, catch it, log `[<cid>] insights detector <key> failed` (no payloads or rows), and continue with the others.
    4. After the loop, if any detector failed, throw `detectors failed: <keys>`. The runner retries; reruns are no-ops thanks to the dedupe keys.

    `JOB_MODULES["insights.detect"] = "insights"`.
  - **Writer** `public.record_insights(p_institution_id uuid, p_rows jsonb) returns int` (plpgsql **invoker**, execute to service_role only):
    - Inserts from `jsonb_to_recordset(p_rows)`.
    - Skips rows whose `class_section_id` is not null and not in the institution.
    - Uses `on conflict do nothing` with no target, so it covers both unique indexes.
    - Forces `institution_id = p_institution_id` and `status = 'new'`, and leaves the explanation, review and decision columns null.
    - Returns the inserted count. Evidence is frozen at first insert.
  - **Detector** = one file, `src/modules/insights/detectors/<key>.ts`. It exports a pure `detect…()` and a `Detector` object. `run()` calls exactly one source RPC with the service-role client. It pages with `.range()` in 1000s until a short page (`max_rows = 1000`), then calls `detect…()`.
  - **Sources** are plpgsql `stable security invoker` functions, execute to service_role only. The institution filter in the body is the only filter (M15 precedent). Timezone as in the sweep. They aggregate and prefilter in SQL.
  - Detectors never reuse M07's TS queries. Those use the cookie client and read `timetable_slots` without `.range()`, so they truncate at 1000 rows on the demo tenant (about 3,400 slots). This is a found bug; T22 records it as a debt row.
  - Files that `pnpm jobs:run` loads (the handler, `detectors/*`, `signals.ts`, the module catalog) use relative `.ts` value imports. `import type` may use `@/`.
  - **Common:**
    - `asOf` is the payload date, a completed local day, as `YYYY-MM-DD`.
    - `isoWeekKey(asOf)` is the ISO-8601 week, e.g. `2026-W44`.
    - `dedupe_key = <signal>:<entity_type|school>:<entity_id|->:<window>`.
    - `confidence(x)` clamps to [0.05, 0.95] at 2 dp. Percentages have 1 dp.
    - Money comes from SQL as whole rupees `bigint`. There is never float money (lesson 8); evidence is display only.
    - `factors: []`: the rules state no hypotheses; the explanation carries the why.
    - `approval_required = severity = 'critical' or SIGNALS[signal].approvalRequired`.
    - Cap: 20 per signal per run, ordered by severity desc, then confidence desc, then `dedupe_key` asc.
    - `recommended_actions`: 1–2 fixed plain strings per signal, ≤ 160 chars, no numbers or names. The implementer writes them.
    - Each signal's `why` is one plain sentence of ≤ 160 chars.
    - **Never tune a threshold to make seed data fire.**

Signals:

| signal | detector file / module | domain | kind | reviewer_role | entity | window | sources |
|---|---|---|---|---|---|---|---|
| `attendance.section_drop` | attendance / `attendance` | attendance | diagnostic | principal | section | ISO week | attendance_sessions, attendance_records |
| `attendance.student_drop` | attendance / `attendance` | attendance | diagnostic | principal | student | ISO week | same |
| `academics.marks_decline` | marks / `exams` | academics | diagnostic | exam_controller | student | latest exam id | marks, exam_papers, exams |
| `academics.missing_work` | submissions / `assignments` | academics | descriptive | principal | student | ISO week | assignments, assignment_submissions |
| `academics.awaiting_review` | submissions / `assignments` | academics | descriptive | principal | section | ISO week | assignment_submissions |
| `finance.overdue_growth` | fees / `fees` | finance | descriptive | accountant | — | ISO week | invoices, payments, payment_reversals |
| `finance.concession_spike` | fees / `fees` | finance | diagnostic | principal, `approvalRequired` | — | ISO week | concessions |
| `admissions.stage_dwell` | admissions / `admissions` | admissions | diagnostic | admissions | — | ISO week | enquiries, applications |
| `staff.workload` | workload / `timetable` | staff | descriptive | principal | staff | version id | timetable_slots |
| `operations.room_capacity` | timetable-conflicts / `timetable` | operations | descriptive | admin | section | version id | timetable_slots, rooms, enrolments |
| `operations.room_pressure` | resource-shortage / `timetable` | operations | diagnostic | admin | — | version id | timetable_slots, rooms, periods, maintenance_requests |

Detectors (version 1 each; `section_label = grades.code || '-' || class_sections.name`; "local date" means `(ts at time zone tz)::date`):
- **attendance** — source `public.insight_src_attendance(p_institution_id uuid, p_as_of date, p_student_max_recent_pct numeric)`.
  - Returns `(level text, class_section_id uuid, section_label text, student_id uuid, recent_days int, base_days int, recent_present numeric, recent_denominator numeric, base_present numeric, base_denominator numeric)`.
  - Windows: recent R = `[as_of-6, as_of]`; baseline B = `[as_of-34, as_of-7]`. Daily sessions only (`period_id is null`).
  - Weights are exactly as in 0009 `app.term_attendance_percentage`: the `counts_present` weight, counted only where `in_denominator`.
  - `level='section'`: one row per session section; `student_id` null; `*_days` = distinct session dates. Every section with any record in R∪B is returned.
  - `level='student'`: one row per student over that student's records. Section comes from the student's active enrolment. Returned only when `recent_denominator >= 3` and `100*recent_present/recent_denominator <= p_student_max_recent_pct`. TS passes 75.
  - Rates: `rate = pct(present, denominator)`; `drop = base − recent`.
  - `section_drop`:
    - Fires when recent_days ≥ 3, base_days ≥ 10, drop ≥ 5 and recent < 90.
    - Severity: critical if drop ≥ 15, warning if ≥ 10, else watch.
    - Confidence `0.4 + 0.03·drop + 0.05·min(recent_days,6)`.
    - Title `Attendance drop in <label>`. Pattern `Attendance in <label> fell from <B>% to <R>% in the 7 days to <asOf>.`
    - Evidence: `Last 7 days` %, `Previous 4 weeks` %, `Drop` pts, `School days (last 7)`.
  - `student_drop`:
    - Fires when recent_denominator ≥ 3, base_denominator ≥ 8, recent ≤ 75 and drop ≥ 20.
    - Severity: warning if recent ≤ 50, else watch.
    - Confidence `0.35 + 0.01·drop + 0.05·min(recent_denominator,6)`.
    - Title `Attendance drop: a student in <label>`. Pattern `A student's attendance fell from <B>% to <R>% in the 7 days to <asOf>.`
    - `entity_label` null; `class_section_id` set.
  - Both signals: `date_from = as_of-34`, `date_to = as_of`.
- **marks** — source `public.insight_src_marks(p_institution_id uuid, p_as_of date, p_min_drop_pts numeric)`.
  - Returns `(student_id, class_section_id, section_label, subject_id, subject_name, prev_exam_id, prev_pct numeric, last_exam_id, last_pct numeric, last_published_on date)`.
  - Per (student, subject), it uses current marks (`superseded_by is null`, `not is_absent`) on papers of exams with `status='published'` whose local `published_at` falls in `[as_of-365, as_of]`. `pct = round(100*marks_obtained/max_marks, 2)`.
  - It takes the two latest exams by `published_at` (tie: exam id). The section is the latest paper's.
  - A row is returned only when `last_published_on >= as_of-30` and `prev_pct - last_pct >= p_min_drop_pts`. TS passes 15.
  - TS groups the rows by student: n = the number of rows; worst = the largest drop.
  - Severity: warning if worst ≥ 30 or n ≥ 3, else watch.
  - Confidence `0.5 + 0.1·min(n,3) + 0.01·(worst−15)`.
  - Window = the `last_exam_id` of the row with the latest `last_published_on` (tie: smallest id).
  - Evidence: for the top 3 subjects by drop, `<Subject> latest` % and `<Subject> change` as negative pts; then `Subjects declined`.
  - Title `Marks decline: a student in <label>`. Pattern `<n> subject(s) fell 15+ points between the last two exams; largest: <Subject> <prev>% → <last>%.`
  - `date_from = as_of-365`.
- **submissions** — source `public.insight_src_submissions(p_institution_id uuid, p_as_of date)`.
  - Returns `(level text, class_section_id, section_label, student_id uuid, due_count int, missing_count int, awaiting_count int, oldest_awaiting_days int)`.
  - `level='student'`: assignments with `status in ('published','closed')` whose local `due_at` date falls in `[as_of-27, as_of]`, crossed with the students actively enrolled in the assignment's section. Missing = no `assignment_submissions` row. Only students with `missing_count >= 3` are returned.
  - `level='section'`: submissions with `status='submitted'` whose local `submitted_at` date is ≤ `as_of-7`, grouped by the assignment's section. Only sections with `awaiting_count >= 5` are returned. `oldest_awaiting_days = as_of − min(local submitted date)`.
  - `missing_work`:
    - Fires when missing ≥ 3 and missing/due ≥ 0.5.
    - Severity: warning if missing ≥ 5, else watch.
    - Confidence `0.4 + 0.1·min(missing,5)`.
    - Evidence `Missing (4 weeks)`, `Due (4 weeks)`. Title `Missing work: a student in <label>`.
  - `awaiting_review`:
    - Fires for every returned section.
    - Severity: warning if awaiting ≥ 15 or oldest ≥ 14, else watch.
    - Confidence 0.9.
    - Evidence `Awaiting feedback`, `Oldest (days)`. Title `Submissions awaiting feedback in <label>`.
- **fees** — source `public.insight_src_fees(p_institution_id uuid, p_as_of date)`.
  - Returns one row: `(overdue_now bigint, overdue_then bigint, overdue_count_now int, overdue_count_then int, concessions_recent int, concessions_base int, concessions_flagged int)`.
  - An invoice's outstanding amount at local date d = `total − Σ payments.amount` (local `received_at` ≤ d) `+ Σ payment_reversals.amount` (local reversal `created_at` ≤ d, of those same payments).
  - Overdue at d = invoices with `status <> 'cancelled'`, `due_on < d`, local `created_at` ≤ d, and outstanding > 0. `overdue_*` = the rounded sum in rupees.
  - "now" is d = as_of; "then" is d = as_of−28.
  - Concessions are bucketed by local `created_at`: recent `[as_of-27, as_of]`; base `[as_of-111, as_of-28]`. Flagged = recent concessions with `kind in ('hardship','other')`.
  - `overdue_growth`:
    - growth = now − then; growth% = 100 when then = 0, else 100·growth/then.
    - Fires when growth ≥ 25000 and growth% ≥ 25.
    - Severity: critical if growth% ≥ 100, warning if ≥ 50, else watch.
    - Confidence `(count_now ≥ 10 ? 0.7 : 0.5) + (growth% ≥ 50 ? 0.15 : 0)`.
    - Evidence `Overdue now` INR, `Overdue 4 weeks ago` INR, `Growth` %, `Overdue invoices`. Title `Overdue fees rising`.
  - `concession_spike`:
    - base28 = max(1, base/3).
    - Fires when recent ≥ 5 and recent ≥ 2·base28.
    - Severity: warning if recent ≥ 3·base28, else watch.
    - Confidence `0.6 + (2·flagged ≥ recent ? 0.1 : 0)`.
    - Evidence `Concessions (4 weeks)`, `Usual per 4 weeks` (1 dp), `Hardship/other`. Title `Unusual number of fee concessions`.
- **admissions** — source `public.insight_src_admissions(p_institution_id uuid, p_as_of date)`.
  - Returns `(stage text, open_count int, over_2 int, over_7 int, over_14 int)`.
  - Stages: `enquiry.new|contacted|visit_scheduled|application_sent` and `application.submitted|under_review|interaction_scheduled`. Only stages with ≥ 1 open row (local `created_at` ≤ as_of) are returned.
  - dwell = `as_of − local updated_at date`. This is a proxy, because there is no stage history (debt).
  - Thresholds in days: new 2, contacted 7, visit_scheduled 14, application_sent 14, submitted 7, under_review 7, interaction_scheduled 14. A stage's stale count = `over_<t>`.
  - Fires when stale ≥ 5 and stale ≥ 0.25·open.
  - Severity: warning if stale ≥ 20 or stale(enquiry.new) ≥ 10, else watch.
  - Confidence 0.75.
  - Evidence: the top 4 stages by stale count as `<Stage> waiting > <t> days`, then `Open items`. Title `Admissions follow-ups are stalling`.
- **workload** — source `public.insight_src_workload(p_institution_id uuid, p_as_of date)`.
  - Returns `(version_id uuid, staff_id uuid, periods_week int)`: the slot count per teacher in the `published` version whose academic year has `starts_on <= as_of <= ends_on`.
  - max = `settings.timetable.max_periods_week` when it is a number, else 36 (M07).
  - Fires when periods_week > max.
  - Severity: warning if periods_week ≥ max+4, else watch.
  - Confidence 0.95. Entity staff, label null.
  - Evidence `Periods per week`, `Limit`. Title `Teacher timetable above the weekly limit`.
- **timetable-conflicts** — source `public.insight_src_room_capacity(p_institution_id uuid, p_as_of date)`.
  - Returns `(version_id, class_section_id, section_label, strength int, smallest_capacity int, slots_over int)`.
  - Same version as workload. strength = the section's active enrolments. Counts slots whose room capacity < strength; only sections with ≥ 1 such slot are returned.
  - Fires for every returned row.
  - Severity: warning if strength − smallest ≥ 10 or slots_over ≥ 12, else watch.
  - Confidence 0.95.
  - Evidence `Section strength`, `Smallest room capacity`, `Periods in too-small rooms`. Title `Rooms too small for <label>`.
  - Double-booking cannot happen (0069 constraints). Teacher overload is covered by `staff.workload`.
- **resource-shortage** — source `public.insight_src_rooms(p_institution_id uuid, p_as_of date)`.
  - Returns `(version_id, room_id, room_name, periods_used int, periods_total int, open_maintenance int)`, one row per room. Empty when there is no version.
  - total = 6 × non-break periods. open_maintenance = `maintenance_requests` with `status in ('open','in_progress')` whose `asset_id → assets.room_id` is the room.
  - Skip when total = 0.
  - Rooms in use = rooms with periods_used ≥ 1. A room is "hot" when used/total ≥ 0.9.
  - Fires when hot ≥ 2 and hot ≥ 0.2·rooms in use.
  - Severity: warning if hot ≥ 0.4·rooms in use or any hot room has open_maintenance ≥ 1, else watch.
  - Confidence 0.9.
  - Evidence `Rooms ≥ 90% booked`, `Rooms in use`, `Open repairs in busy rooms`, then the top 3 hot rooms as `<room name> booked` %. Title `Teaching rooms close to full`.
- **Names.**
  - Actions, all `module: "insights"`:
    - `insight.review`, `insight.action`, `insight.resolve`, `insight.dismiss` (permission `insight.review`) in `src/modules/insights/actions.ts`.
    - `insight.explain` (permission `insight.read`, plus the `ai.generate` pre-check) in `explain.actions.ts`.
    - Audit is written only by the RPCs.
  - Queries in `src/modules/insights/query-defs.ts`, all `module: "insights"`, permission `insight.read`: `insights.list`, `insights.actions`, `insights.priorityActions`, `insights.riskIndicators`, `insights.cards`.
  - Job `insights.detect`.
- **`Insight` mapping:**
  - Columns map 1:1.
  - `entity_ref` = `entity_type ? { type, id: entity_id, label } : null`. `label` = `entity_label`; for student/staff, the name read under the caller's RLS (`first_name || ' ' || last_name`, or `full_name`); if the caller cannot read it, `"Student"` / `"Staff member"`.
  - The T1 CONTRACT adds the optional fields `signal`, `detector_version` and `explanation: { what, why, next_steps, provider, model, explained_at } | null`.
  - `InsightAction` maps 1:1. Only current rows are returned; `supersedes_id` and `created_by` are omitted.
- **Derived** (pure functions in `src/modules/insights/derived.ts`). "Open" = `new|reviewing|actioned`. Default order = severity rank desc, then confidence desc, then `created_at` asc.
  - `PriorityAction`: at most 8 rows, from `new|reviewing` insights only.
    - `id` = the insight id; `title` = the insight title; `why = explanation.why ?? pattern`.
    - `href = /<slug>/fabric/insights?id=<id>`.
    - `owner` = the role label: Owner, Principal, Admin, Admissions, Accountant, Exam controller.
    - `due` = created date + SLA: critical 1 day, warning 3, watch 7, info 14.
    - `severity` = the insight severity.
  - `RiskIndicator`: at most 6 rows, one per domain that has ≥ 1 open insight.
    - `id = risk:<domain>`; `label = <Domain>: <n> open`.
    - `level` = the highest open severity.
    - `trend` compares insights created in the last 7 days with the 7 days before, in that domain and any status: `up`, `down` or `flat`.
    - `insight_id` = the first open insight in the default order.
    - Sorted by level desc, then n desc.
  - Cards: `insights.cards {limit 1–6, default 3}` returns `AIInsightCardProps`:
    - `detected = pattern`; `whyItMatters = explanation.why ?? SIGNALS[signal].why`.
    - `evidence` = strings `"<label>: <value><unit>"`.
    - `suggestedAction = { label: "Review insight", href }`; `requiresApproval = approval_required`.
    - `confidence`: high ≥ 0.75, medium ≥ 0.5, else low.
- **Approvals** (one new row in the M16 table): kind `insight`. Rows = visible insights with `status in ('new','reviewing') and approval_required`, each mapped to `{ id, kind: "insight", title: "Insight: <title>", requestedBy: "Insights engine", age, href }`. `age` uses the M16 format, computed from `created_at`. Permission `insight.review`, module `insights`. The block goes after the recheck block, oldest first.
- **Honesty.** Insights are real detections, so they get no badge. The explanation is an AI draft: rows expose `explanation.provider`, and the UI badge is Workstream D's job. In 03-feature-matrix, insights are `built, limited` (v1 rules).

Routing: T1 haiku none [] ; T2 sonnet exclusive [] ; T3 sonnet exclusive [2] ; T4 sonnet exclusive [3] ; T5 sonnet exclusive [4] ; T6 sonnet exclusive [5] ; T7 sonnet none [] ; T8 opus none [4,7] ; T9 opus none [4,7] ; T10 opus none [5,7] ; T11 opus none [6,7] ; T12 sonnet none [6,7] ; T13 haiku none [] ; T14 sonnet tests [2,8,9,10,11,12] ; T15 sonnet none [6] ; T16 sonnet tests [1,3,13] ; T17 sonnet tests [1,3,13] ; T18 sonnet tests [1,2,13] ; T19 sonnet tests [7,18] ; T20 sonnet tests [18] ; T21 sonnet tests [14,15,16,17,18,19,20] ; T22 haiku none [21]

Cross-cutting rules:
- Every new action needs a manifest import (`src/app/api/v1/actions/all-actions.ts`) and a C-03 fixture.
- Every new query needs a `query-defs.ts` entry, an `all-queries.ts` line, and a smoke sample in `tests/db/api-query-route.test.ts`.
- Every definition sets `module: "insights"`. `tests/security/module-gate.test.ts` covers the new names automatically.
- Each migration task appends its part to the one file, runs `pnpm db:reset` from empty, and regenerates `src/lib/db/types.ts`. If `tests/security/grants.test.ts` or `rls-expectations.ts` list objects, it updates their expectations and says so.

---

### Task 1: M19-T1 Permissions + CONTRACT fields (Haiku)
READ: BRIEF-COMMON.md; rulings (Permissions, `Insight` mapping); `src/lib/auth/permissions.ts`; `tests/unit/permissions.test.ts`
FILES: `src/lib/auth/permissions.ts`; `tests/unit/permissions.test.ts`; `docs/planning/coolskool/07-security-and-ai-governance.md` §2.2 (two rows); `src/modules/fabric/types.ts` + `docs/planning/fabric/05-data-contracts.md` §0054 (CONTRACT, additive)
MIGRATION: none
EXPORTS:
- Permissions `insight.read` and `insight.review`, with the role grants from the rulings.
- `export interface InsightExplanation { what: string; why: string; next_steps: string[]; provider: "local" | "cloud"; model: string; explained_at: ISODate }`.
- `Insight` gains `signal?: string; detector_version?: number; explanation?: InsightExplanation | null`.

Fixtures stay valid.
TEST FIRST: teacher has `insight.read` but not `insight.review`; accountant has both; guardian and student have neither; the snapshot matches 07 §2.2.
ACCEPT: `pnpm test tests/unit/permissions.test.ts tests/unit/fabric-fixtures`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 2: M19-T2 Migration 0092 part 1 — tables, RLS, `record_insights` (Sonnet, DB owner)
READ: BRIEF-COMMON.md; rulings (Tables, RLS, Writer); `supabase/migrations/20261028000069_timetable.sql` (RLS style); `…0020_rls_performance.sql` (helpers)
FILES: `supabase/migrations/20261028000092_insights.sql` (new, part 1); `tests/db/insights-rls.test.ts` (new); `src/lib/db/types.ts` (regen); `tests/security/rls-expectations.ts` (3 tables)
MIGRATION: `20261028000092_insights.sql` (claimed)
EXPORTS: `insights`, `insight_actions`, `briefings` with every column, check, index and policy from the rulings; `public.record_insights`, execute revoked from public/anon/authenticated and granted to service_role.
TEST FIRST:
- `record_insights` (service role): 2 rows → 2; the same payload again → 0; a new dedupe_key for the same open (signal, entity) → 0; after the first row is set `dismissed` (service role) → 1; a row whose `class_section_id` belongs to B → skipped.
- RLS: principal sees all rows. Accountant sees only `finance`, admissions only `admissions`, exam_controller only `academics`. Teacher sees attendance/academics rows of taught sections only (no staff/operations rows, no other sections). Guardian and student see none. B's principal sees none of A's.
- Direct PostgREST insert/update/delete on all three tables by principal is denied.
- `record_insights` called by an authenticated user → permission denied.
- `insight_actions` is visible exactly when its parent is. On `briefings`, a teacher sees only `role='teacher'` rows.
- Checks: `entity_label` with entity_type `student` → rejected; 9 evidence items → rejected.
ACCEPT: `pnpm db:reset`; `pnpm test:db tests/db/insights-rls.test.ts`; `pnpm test:security`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 3: M19-T3 Migration 0092 part 2 — review helpers, `decide_insight`, `record_insight_action`, `set_insight_explanation` (Sonnet, DB owner)
READ: BRIEF-COMMON.md (lessons 3–5, 10); rulings (Review rights, State machine, `record_insight_action`, AI boundary); `…0070_staffing.sql` (`decide_leave` definer + audit pattern)
FILES: the 0092 file (append part 2); `tests/db/insights-rpcs.test.ts` (new); `src/lib/db/types.ts` (regen)
MIGRATION: 0092 part 2
EXPORTS: `app.can_review_insight`, `app.user_can_review_insight`, `app.insight_visible`; `public.decide_insight`, `public.record_insight_action`, `public.set_insight_explanation`. All plpgsql, `security definer`, `search_path=''`. `public.*` is executable by authenticated only; `app.*` is revoked.
TEST FIRST:
- `decide_insight`:
  - Principal: review → `reviewing` with reviewer = self.
  - Accountant: reviews a finance insight; on an attendance insight → forbidden.
  - Teacher (visible row) → forbidden. Another institution's member → not_found.
  - Review naming a teacher as reviewer → validation_failed.
  - Dismiss from `actioned` → invalid_state. Note shorter than 5 → validation_failed.
  - `approval_required` resolve: admin → forbidden; principal → ok.
- `record_insight_action`:
  - planned → done → measured by superseding; going back → invalid_state; superseding a superseded row → invalid_state.
  - The first action moves `reviewing` → `actioned`.
  - `measured` on a `resolved` insight → ok; a new action on a `dismissed` insight → invalid_state.
- `set_insight_explanation`:
  - Changes only the five explanation columns; status is unchanged.
  - `next_steps` with 4 items → validation_failed; dismissed → invalid_state; not visible → not_found.
- Audit rows hold no note or explanation text.
ACCEPT: `pnpm db:reset`; `pnpm test:db tests/db/insights-rpcs.test.ts tests/db/insights-rls.test.ts`; `pnpm test:security tests/security/grants.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 4: M19-T4 Migration 0092 part 3 — sources attendance, marks, submissions (Sonnet, DB owner)
READ: BRIEF-COMMON.md; rulings (Sources, detectors attendance/marks/submissions); `…0009_exams.sql` (`app.term_attendance_percentage`, ~line 790); `…0071_assignment_submissions.sql`
FILES: the 0092 file (append part 3); `tests/helpers/insight-fixtures.ts` (new); `tests/db/insight-sources-academic.test.ts` (new); `src/lib/db/types.ts` (regen)
MIGRATION: 0092 part 3
EXPORTS:
- `public.insight_src_attendance`, `public.insight_src_marks`, `public.insight_src_submissions`, exactly as in Detectors: plpgsql, `stable security invoker`, `search_path=''`, execute to service_role only.
- Helpers (admin client, explicit `created_at`/`updated_at` on INSERT, because the `set_updated_at` trigger overwrites them on UPDATE): `plantAttendance(admin, inst, asOf, spec)`, `plantMarks(…)`, `plantSubmissions(…)`, each returning the ids it made.
TEST FIRST:
- Attendance: section and student rows have exact weighted sums for P/A records in R and B; a student above 75% is not returned; period sessions and institution B's records are ignored.
- Marks: two published exams → one row with exact pct; absent and superseded marks are ignored; a draft exam is ignored; a last exam older than 30 days → no row.
- Submissions: missing counts within the 28-day window (closed counted, draft not); a section with 5 stale `submitted` rows is returned and `graded` rows are not.
- An authenticated caller → permission denied.
ACCEPT: `pnpm db:reset`; `pnpm test:db tests/db/insight-sources-academic.test.ts`; `pnpm test:security tests/security/grants.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 5: M19-T5 Migration 0092 part 4 — sources fees, admissions (Sonnet, DB owner)
READ: BRIEF-COMMON.md; rulings (detectors fees/admissions); `…0008_finance.sql` (invoices, payments, concessions); `…0074_*.sql` (`payment_reversals`); `…0007_admissions.sql`
FILES: the 0092 file (append part 4); `tests/helpers/insight-fixtures.ts` (add `plantFees`, `plantAdmissions`); `tests/db/insight-sources-office.test.ts` (new); `src/lib/db/types.ts` (regen)
MIGRATION: 0092 part 4
EXPORTS: `public.insight_src_fees`, `public.insight_src_admissions`, per Detectors.
TEST FIRST:
- Fees:
  - An invoice due before "then" and paid after "then" counts in `overdue_then` but not in `overdue_now`.
  - A reversal restores the outstanding amount. A cancelled invoice is ignored.
  - Rupees are rounded whole. Concessions fall into the recent/base windows by local date; `flagged` counts hardship/other.
- Admissions: `over_2/7/14` per stage from planted `updated_at`; closed/converted/enrolled rows are not returned; institution B is ignored.
- An authenticated caller → permission denied.
ACCEPT: `pnpm db:reset`; `pnpm test:db tests/db/insight-sources-office.test.ts`; `pnpm test:security tests/security/grants.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 6: M19-T6 Migration 0092 part 5 — timetable sources + sweep (Sonnet, DB owner)
READ: BRIEF-COMMON.md; rulings (Sweep, detectors workload/timetable-conflicts/resource-shortage); `…0069_timetable.sql`; `…0075_*.sql` (assets, maintenance_requests); `…0003_platform.sql` (`app.enqueue_job`); M15's `enqueue_due_reports` (0077)
FILES: the 0092 file (append part 5); `tests/helpers/insight-fixtures.ts` (add `plantTimetable`); `tests/db/insight-sources-timetable.test.ts` (new); `src/lib/db/types.ts` (regen)
MIGRATION: 0092 part 5
EXPORTS: `public.insight_src_workload`, `public.insight_src_room_capacity`, `public.insight_src_rooms` (per Detectors); `public.enqueue_insight_detection` (per Sweep).
TEST FIRST:
- Workload counts slots per teacher in the published version of the year containing `as_of`; a draft version is ignored; no published version → empty.
- Room-capacity row: strength 40 in a 30-seat room.
- Rooms: `periods_total = 6 ×` non-break periods; `open_maintenance` counts via `assets.room_id`.
- Sweep with insights on → one `insights.detect` job with `payload.as_of` = local yesterday and key `insights.detect:<id>:<YYYYMMDD>`; a second call → 0; insights off → no job.
- An authenticated caller → permission denied.
ACCEPT: `pnpm db:reset`; `pnpm test:db tests/db/insight-sources-timetable.test.ts`; `pnpm test:security tests/security/grants.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 7: M19-T7 Signal catalog + candidate contract (Sonnet)
READ: BRIEF-COMMON.md; rulings (Common, Signals table); `src/modules/fabric/types.ts` (Insight unions); `src/lib/modules/catalog.ts`
FILES: `src/modules/insights/signals.ts` (new; `import type` only, no value imports); `tests/unit/insights-signals.test.ts` (new)
MIGRATION: none
EXPORTS:
- `type SignalKey` (11); `SIGNALS` (`as const satisfies Record<SignalKey, { domain; kind; reviewerRole; approvalRequired?: true; why: string }>`, values per the Signals table).
- `type DetectorKey` (`attendance|marks|submissions|fees|admissions|workload|timetable-conflicts|resource-shortage`).
- `interface InsightCandidate`: the snake_case `record_insights` row (signal, detector_version, dedupe_key, domain, kind, severity, title, pattern, evidence, sources, date_from, date_to, confidence, factors, reviewer_role, recommended_actions, approval_required, entity_type, entity_id, entity_label, class_section_id).
- `makeCandidate(signal, version, fields & { window: string }): InsightCandidate`. It fills domain, kind, reviewer_role, `factors: []`, `dedupe_key` and `approval_required`, and slices title to 120 and pattern to 300.
- `isoWeekKey(asOf)`; `addDays(asOf, n)` (UTC date math); `confidence(x)`; `pct(num, den): number | null`; `SEVERITY_RANK`; `capPerSignal(c, max = 20)`.
- `interface DetectorInput { institutionId; asOf; settings: Record<string, unknown> }`; `interface Detector { key: DetectorKey; module: ModuleKey; version: number; run(admin: SupabaseClient<Database>, input: DetectorInput): Promise<InsightCandidate[]> }`.
TEST FIRST: `isoWeekKey("2026-11-01")` = `2026-W44` and `("2027-01-01")` = `2026-W53`; confidence clamps 1.2 → 0.95 and 0 → 0.05; a critical candidate → `approval_required`, and `finance.concession_spike` → always; the dedupe_key format; the cap keeps 20 per signal in rule order and is deterministic; `pct(1, 0)` → null.
ACCEPT: `pnpm test tests/unit/insights-signals.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 8: M19-T8 Detector: attendance (Opus)
READ: BRIEF-COMMON.md; rulings (Detector, Common, attendance); T7 `signals.ts`; T4 source signature in `src/lib/db/types.ts`
FILES: `src/modules/insights/detectors/attendance.ts` (new, relative `.ts` value imports); `tests/unit/insights-detector-attendance.test.ts` (new)
MIGRATION: none
EXPORTS: `interface AttendanceSourceRow`; `detectAttendance(rows: AttendanceSourceRow[], asOf: string): InsightCandidate[]`; `attendanceDetector: Detector` (key `attendance`, module `attendance`, version 1, rpc `insight_src_attendance` with `p_student_max_recent_pct: 75`, paged).
TEST FIRST:
- Section base 92% → recent 80% over 5 days → `section_drop` warning, confidence 0.95, evidence values to 1 dp.
- Drop 4 → none; recent_days 2 → none.
- Student 95 → 60 (5 marked) → `student_drop` watch; 40 → warning; base_denominator 7 → none.
- The dedupe_key uses the ISO week. Student candidates have `entity_label` null, and their title holds the section label but no UUID.
ACCEPT: `pnpm test tests/unit/insights-detector-attendance.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 9: M19-T9 Detectors: marks + submissions (Opus)
READ: BRIEF-COMMON.md; rulings (marks, submissions); T7; T4 source signatures
FILES: `src/modules/insights/detectors/marks.ts`, `src/modules/insights/detectors/submissions.ts` (new); `tests/unit/insights-detector-academics.test.ts` (new)
MIGRATION: none
EXPORTS: `detectMarks(rows, asOf)`, `marksDetector` (module `exams`, `p_min_drop_pts: 15`); `detectSubmissions(rows, asOf)`, `submissionsDetector` (module `assignments`).
TEST FIRST:
- Marks: one subject −16 → watch; −31 → warning; 3 subjects → warning; evidence lists the top 3 subjects plus a count, 7 items max.
- The window is the latest exam by `last_published_on`, with a deterministic tie.
- Submissions: missing 3/4 → `missing_work` watch; 3/7 → none; missing 5 → warning; a section with 15 awaiting → `awaiting_review` warning.
ACCEPT: `pnpm test tests/unit/insights-detector-academics.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 10: M19-T10 Detectors: fees + admissions (Opus)
READ: BRIEF-COMMON.md; rulings (fees, admissions); T7; T5 source signatures
FILES: `src/modules/insights/detectors/fees.ts`, `src/modules/insights/detectors/admissions.ts` (new); `tests/unit/insights-detector-office.test.ts` (new)
MIGRATION: none
EXPORTS: `detectFees(row | null, asOf)`, `feesDetector` (module `fees`); `ADMISSION_STAGE_THRESHOLDS`, `detectAdmissions(rows, asOf)`, `admissionsDetector` (module `admissions`).
TEST FIRST:
- Overdue 100,000 → 160,000 → warning (60%).
- Then 0 → now 30,000 → critical with `approval_required`.
- Growth 20,000 → none.
- Concessions 6 vs base 6 → spike watch with approval_required; 4 → none.
- Admissions: 6 stale of 12 open → watch; 10 stale new enquiries → warning; 4 stale → none.
- Null fee row → [].
ACCEPT: `pnpm test tests/unit/insights-detector-office.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 11: M19-T11 Detectors: workload + timetable conflicts (Opus)
READ: BRIEF-COMMON.md; rulings (workload, timetable-conflicts); T7; T6 source signatures
FILES: `src/modules/insights/detectors/workload.ts`, `src/modules/insights/detectors/timetable-conflicts.ts` (new); `tests/unit/insights-detector-timetable.test.ts` (new)
MIGRATION: none
EXPORTS: `detectWorkload(rows, asOf, maxPeriods)`, `workloadDetector` (module `timetable`; max from settings, default 36); `detectRoomCapacity(rows, asOf)`, `timetableConflictsDetector` (module `timetable`).
TEST FIRST: 37 periods with max 36 → watch; 40 → warning; 36 → none; a settings value of `"x"` → falls back to 36; strength 42 in a 30-seat room → warning; 3 short seats in 2 slots → watch; the window = version id.
ACCEPT: `pnpm test tests/unit/insights-detector-timetable.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 12: M19-T12 Detector: resource shortage (Sonnet)
READ: BRIEF-COMMON.md; rulings (resource-shortage); T7; T6 source signature
FILES: `src/modules/insights/detectors/resource-shortage.ts` (new); `tests/unit/insights-detector-rooms.test.ts` (new)
MIGRATION: none
EXPORTS: `detectRoomPressure(rows, asOf)`, `resourceShortageDetector` (module `timetable`).
TEST FIRST: 2 of 10 used rooms hot → watch; 4 of 10 → warning; a hot room with open repairs → warning; 1 hot → none; `periods_total` 0 → none; unused rooms are excluded from the denominator.
ACCEPT: `pnpm test tests/unit/insights-detector-rooms.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 13: M19-T13 Insight Zod schemas (Haiku)
READ: BRIEF-COMMON.md; rulings (Names, AI boundary); `src/modules/timetable/schemas.ts` (pattern)
FILES: `src/modules/insights/schemas.ts` (new); `tests/unit/insights-schemas.test.ts` (new)
MIGRATION: none
EXPORTS (all `.strict()`):
- `InsightIdSchema {insightId uuid}`; `ReviewInsightSchema {insightId, reviewerId?: uuid}`; `CloseInsightSchema {insightId, note trimmed 5–500}`.
- `RecordInsightActionSchema {insightId, supersedesId?, action 1–200, owner 1–80, rationale 1–500, expectedOutcome 1–300, status planned|done|measured (default planned), actualOutcome? 1–500}`, refined so that `measured` requires `actualOutcome`.
- `ListInsightsSchema {status?: InsightStatus[] 1–5 (default new, reviewing, actioned), domain?: InsightDomain, limit int 1–200 (default 50)}`; `InsightCardsSchema {limit int 1–6 (default 3)}`.
- `InsightExplanationSchema {what 1–500, why 1–500, next_steps string 1–200 [1–3]}`; plus the inferred types.
TEST FIRST: valid inputs parse; note of 4 chars → rejected; `measured` without an outcome → rejected; `next_steps` of 4 → rejected; unknown key → rejected; defaults applied.
ACCEPT: `pnpm test tests/unit/insights-schemas.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 14: M19-T14 Job `insights.detect` + detector registry
READ: BRIEF-COMMON.md (lesson 11); rulings (Handler, Writer); `src/modules/jobs/{types,registry}.ts`, `handlers/index.ts`, `handlers/notify.announcement.ts` (style); T4 `tests/helpers/insight-fixtures.ts`
FILES: `src/modules/insights/detectors/index.ts` (new); `src/modules/jobs/handlers/insights.detect.ts` (new); `tests/db/insights-detect-job.test.ts` (new); + registries `src/modules/jobs/types.ts` (`JobType`), `registry.ts` (`JOB_REGISTRY` + `JOB_MODULES` row), `handlers/index.ts`
MIGRATION: none
EXPORTS: `DETECTORS: readonly Detector[]` (the 8, in file order of the Signals table); `insightsDetect: JobHandler`; `recordInsights(admin, institutionId, candidates): Promise<number>` (rpc `record_insights`, throws on error).
TEST FIRST (fixture institution, `plantAttendance` student drop):
- The handler with `as_of` → one `attendance.student_drop` row: status `new`, detector_version 1, confidence in [0,1], evidence non-empty.
- A rerun → no new row.
- `insights` off → zero rows.
- `exams` off → `marksDetector.run` not called (spy).
- `vi.spyOn(marksDetector, "run")` rejecting → the attendance row is still written, and the handler throws `detectors failed: marks`.
- A bad payload → throws before any rpc.
ACCEPT: `pnpm test:db tests/db/insights-detect-job.test.ts`; `pnpm test tests/unit/jobs-runner.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 15: M19-T15 Runner sweep port `enqueueDueInsights`
READ: BRIEF-COMMON.md; rulings (Sweep); `src/modules/jobs/runner.ts` (M15 `enqueueDueReports`); `tests/unit/jobs-runner.test.ts`
FILES: `src/modules/jobs/runner.ts`; `tests/unit/jobs-runner.test.ts`
MIGRATION: none
EXPORTS: `RunnerPorts.enqueueDueInsights(): Promise<number>`, implemented in `createRunnerPorts` as `admin.rpc("enqueue_insight_detection")` and throwing on error. `runOnceCore` calls it once before the claim loop, right after the reports sweep, in its own try/catch; on error it logs `[<cid>] insights sweep failed` and continues. `RunOnceSummary` is unchanged.
TEST FIRST: called exactly once per `runOnceCore`, before the first `claimJob`; a rejection → jobs are still claimed and the reports sweep still runs; the real port calls the rpc; `fakePorts` gains `enqueueDueInsights: vi.fn(async () => 0)`.
ACCEPT: `pnpm test tests/unit/jobs-runner.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 16: M19-T16 Actions review / action / resolve / dismiss
READ: BRIEF-COMMON.md (lesson 13); rulings (State machine, Names); T3 RPCs; T13 schemas; `src/modules/people/leave.actions.ts` (RPC + mapSqlError style)
FILES: `src/modules/insights/actions.ts` (`"use server"`, new); `tests/db/insight-actions.test.ts` (new); + manifest line + 4 C-03 fixtures
MIGRATION: none
EXPORTS:
- `reviewInsight` (`insight.review`) → `decide_insight('review', null, reviewerId)` → `{ id, status }`.
- `recordInsightAction` (`insight.action`) → `record_insight_action` → `{ id, insightId, status }`.
- `resolveInsight` (`insight.resolve`) and `dismissInsight` (`insight.dismiss`) → `decide_insight` with the note → `{ id, status }`.
- All: permission `insight.review`, module `insights`, errors via `mapSqlError`, no TS audit (the RPC audits).
TEST FIRST: principal review → reviewing; accountant on an attendance insight → forbidden; teacher → forbidden (permission); action planned then done (supersedes) → 2 rows, 1 current; dismiss on actioned → invalid_state; **`insights` module off → `forbidden` + `MODULE_DISABLED_MESSAGE`**.
ACCEPT: `pnpm test:db tests/db/insight-actions.test.ts`; `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm test:security tests/security/escalation.test.ts tests/security/module-gate.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 17: M19-T17 `insight.explain` (AI gateway)
READ: BRIEF-COMMON.md (lessons 9, 10); rulings (AI boundary); `src/lib/ai/gateway.ts` (`runStructured`); `src/modules/ai/prompts/remark.ts` (nonce markers); `src/app/api/ai/attendance-insight/route.ts` (anonymised-input discipline); `tests/db/quiz-route.test.ts` (gateway mock)
FILES: `src/modules/insights/explain.ts` (new); `src/modules/insights/explain.actions.ts` (`"use server"`, new); `tests/db/insight-explain.test.ts` (new); + manifest line + C-03 fixture
MIGRATION: none
EXPORTS:
- `explain.ts`:
  - `interface InsightExplainInput`: domain, kind, severity, title, pattern, evidence, date_from, date_to, confidence, recommended_actions, entity_type. No id fields.
  - `toExplainInput(row): InsightExplainInput`.
  - `INSIGHT_EXPLAIN_INSTRUCTIONS`: explain a rule-detected insight; never re-score or change it; possible reasons without blame or diagnosis; 1–3 practical staff steps; no names; JSON only.
  - `buildInsightExplainPrompt(input: InsightExplainInput): string`: nonce-delimited data block.
- `explainInsight` (`insight.explain`, permission `insight.read`, module `insights`) runs these steps:
  1. No `ai.generate` → `forbidden`.
  2. Read the row with the user client; not found → `not_found`. Not open → `invalid_state`.
  3. Call `runStructured({ feature: "insight_explain", schema: InsightExplanationSchema, maxOutputTokens: 1024 })`. If it is not ok, pass the result through.
  4. Call rpc `set_insight_explanation` with provider and model.
  5. Return `{ insightId, explanation, provider, model, fallback }`.
TEST FIRST (gateway mocked):
- Principal explains → explanation stored, `status` still `new`, provider/model stored.
- The captured prompt contains no UUID (regex), none of the fixture student's first or last name, and both nonce markers.
- `ai_unavailable` → passed through, row unchanged.
- Dismissed insight → `invalid_state` and no gateway call.
- Accountant → `forbidden` and no gateway call.
- Teacher on another section's insight → `not_found`.
ACCEPT: `pnpm test:db tests/db/insight-explain.test.ts`; `pnpm test:security tests/security/escalation.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 18: M19-T18 Queries `insights.list`, `insights.actions`
READ: BRIEF-COMMON.md; rulings (`Insight` mapping); T1 CONTRACT; `src/modules/timetable/queries.ts` + `query-defs.ts` (pattern)
FILES: `src/modules/insights/queries.ts` (new); `src/modules/insights/query-defs.ts` (new); `tests/db/insight-queries.test.ts` (new); + `all-queries.ts` line + smoke samples (`{}`, `{ insightId: <uuid> }`)
MIGRATION: none
EXPORTS:
- `listInsights(ctx, input: ListInsightsInput): Promise<Insight[]>`: user client, filters, `created_at desc`, limit, and person labels resolved in one batched read per entity type.
- `listInsightActions(ctx, insightId): Promise<InsightAction[]>`: current rows only, `decided_at` asc.
- Defs `insights.list` (`ListInsightsSchema`) and `insights.actions` (`InsightIdSchema`).
TEST FIRST: principal gets every open row, with keys equal to the `Insight` keys plus the optional ones; teacher gets only own-section rows; accountant only finance; a student entity label = the name for the principal; a superseded action is hidden; guardian → forbidden.
ACCEPT: `pnpm test:db tests/db/insight-queries.test.ts tests/db/api-query-route.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: `Insight` (`insights()`), `InsightAction` (`insightActions()`)

### Task 19: M19-T19 Derived queries: priority actions, risk indicators, cards
READ: BRIEF-COMMON.md; rulings (Derived); `src/modules/fabric/types.ts` (`PriorityAction`, `RiskIndicator`); `src/components/widgets/ai-insight-card.tsx`; T7 `SIGNALS`
FILES: `src/modules/insights/derived.ts` (new); `src/modules/insights/query-defs.ts` (3 defs); `tests/unit/insights-derived.test.ts` (new); + smoke samples (`{}` ×3)
MIGRATION: none
EXPORTS:
- Pure mappers: `toPriorityActions(rows, slug, now)`, `toRiskIndicators(open, recent: { domain; created_at }[], now)`, `toInsightCards(rows, slug, limit)`.
- Async functions: `priorityActions(ctx)`, `riskIndicators(ctx)` (the open list plus one RLS select of `domain, created_at` for the last 14 days), `insightCards(ctx, input)`.
- Defs `insights.priorityActions` (`{}` strict), `insights.riskIndicators` (`{}` strict), `insights.cards` (`InsightCardsSchema`).
TEST FIRST: critical sorts before warning and higher confidence first; max 8, actioned excluded; `due` = created + SLA; one risk per domain with level = max and trend up/down/flat from planted dates; cards use `explanation.why` when present, else `SIGNALS` why; confidence buckets at 0.75/0.5; href format.
ACCEPT: `pnpm test tests/unit/insights-derived.test.ts`; `pnpm test:db tests/db/api-query-route.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: `PriorityAction` (`priorityActions()`), `RiskIndicator` (`riskIndicators()`), `demoInsights` (staff roles)

### Task 20: M19-T20 Approvals branch `insight`
READ: BRIEF-COMMON.md; rulings (Approvals); M16 rulings table; `src/modules/core/approvals.queries.ts`; T18 `listInsights`
FILES: `src/modules/core/approvals.queries.ts`; `tests/db/approvals-pending.test.ts` (add cases)
MIGRATION: none
EXPORTS: a `pendingApprovals` branch that runs only when `insight.review` AND `isModuleEnabled(ctx, "insights")`. It reads `listInsights(ctx, { status: ["new","reviewing"], limit: 200 })`, keeps `approval_required` rows, and maps them per the rulings; the block goes after the rechecks, oldest first.
TEST FIRST: principal with a critical open insight → one `insight` row after the recheck rows; `insights` off → no insight rows; accountant → finance approval rows only; teacher → none.
ACCEPT: `pnpm test:db tests/db/approvals-pending.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 21: M19-T21 Acceptance over HTTP + seeded tenant
READ: BRIEF-COMMON.md; rulings; `tests/db/timetable-acceptance.test.ts` (HTTP pattern); `tests/helpers/insight-fixtures.ts`
FILES: `tests/db/insights-acceptance.test.ts` (new)
MIGRATION: none
TEST:
- Setup: fixture institution A with every `plant*` helper, using `asOf` = local yesterday (the sweep's own rule).
- Run 1: real `runOnceCore` with `createRunnerPorts(admin)` → at least 1 insight in each of `attendance`, `academics`, `finance`, `admissions`, `operations`, `staff`. Every row has evidence, confidence 0–1, `detector_version` 1 and status `new`.
- Run 2: a second `runOnceCore` → no new job and no new rows.
- Over HTTP:
  - Principal `POST /api/v1/actions/insight.review` → 200 `reviewing`; then `insight.dismiss` with a note → 200.
  - Teacher `GET /api/v1/query/insights.list` → only taught-section attendance/academics rows.
  - Guardian → 403.
- Institution B with `insights` off: the sweep enqueues nothing, and `insights.list` → 403 with `MODULE_DISABLED_MESSAGE`.
- Seeded tenant, read-only: each detector's `run(admin, { institutionId: demo, asOf: "2026-10-28", settings })` with no write.
  - Assert ≥ 1 attendance candidate.
  - Print the per-domain counts into the report.
  - A domain with 0 becomes an M27 seed-planting debt row. **Never change thresholds to make it fire.**
ACCEPT: `pnpm test:db tests/db/insights-acceptance.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 22: M19-T22 Docs (Haiku)
FILES (Edit only):
- `docs/planning/coolskool/07-security-and-ai-governance.md`:
  - §4 definers: `public.decide_insight`, `public.record_insight_action`, `public.set_insight_explanation`, and `public.enqueue_insight_detection` (service_role, called by the runner, checks `app.module_enabled`).
  - §4 helpers: `app.can_review_insight`, `app.user_can_review_insight`, `app.insight_visible`.
  - §4 service-role invokers: `public.record_insights` and the 8 `public.insight_src_*` functions; the institution filter is their only filter.
  - §5: `insight_explain` data flow (anonymised projection, explanation only, never status).
- `05-data-architecture.md`: §2 rows for the 3 tables; §3 ownership `insights | insights, insight_actions, briefings`.
- `06-workflows-and-contracts.md`: §7 job `insights.detect` (payload `{as_of}`, nightly via the runner sweep); the insight state machine.
- `12-decision-log.md` §3 debt rows:
  - admissions dwell is proxied by `updated_at`;
  - open insights never auto-expire, and their evidence is frozen at first detection;
  - explanation text is writable through the RPC without provenance;
  - the 20-per-signal cap;
  - seeded-tenant domains with 0 candidates (from the T21 report) → M27;
  - students and guardians keep `demoInsights`;
  - M07 `timetableConflicts`/`timetableTeacherWorkload`/`timetableRoomUtilisation` read `timetable_slots` without `.range()` and truncate at 1000 rows (found bug);
  - `briefings` stays unused until M25;
  - no notification when an insight is raised.
- `03-feature-matrix.md`: insights → built, limited.
- `docs/planning/fabric/03-roadmap-and-tracker.md`: the M19 row.
- `10-backlog-index.md` §3: 0054 claimed → built.

ACCEPT: `pnpm lint`
REPLACES FIXTURE: none

---

Controller after T22:
- Security review (Sonnet) on the 0054 diff, T16, T17 and T14.
- Full gate. `pnpm db:reset` + `pnpm seed` clean.
- Commit/push.
- Hosted push of 0054, owner-run: `pnpm exec supabase db push --linked --include-all`.
- `DONE M19 <sha>`.
