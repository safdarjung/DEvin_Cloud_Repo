# 07 — Master plan: CoolSkool V1 complete → V2 intelligent (backend/API first)

Status: approved direction 2026-10-31 (owner answers §0). Author: Fable (lead). Consumers: **Opus** (picks one milestone, splits it into Sonnet tasks), **Sonnet** (executes one task at a time), owner (demo).

This plan is the only document Opus needs besides root `CLAUDE.md`, `.superpowers/sdd/10-backlog-index/BRIEF-COMMON.md`, and the spec sections each milestone links. It does not restate those.

## 0. Owner decisions this plan is built on (2026-10-31)

| Decision | Choice |
|---|---|
| Scope | Reach **V2 feature-complete** (roadmap V1 + V2) with backend + HTTP APIs for everything. UI/UX deferred to one final integration pass (shadcn + optionally `cult-ui`). |
| API surface | **One dispatcher route over the action registry** (`/api/v1/actions/[name]`) plus a query registry (`/api/v1/query/[name]`). No per-resource REST. |
| UI track | Chayank's `F-UI-01..16` continues **in parallel** on fixtures. Backend builds real queries behind the same names/types in `src/modules/fabric/types.ts`; UI swaps fixture→query in the final pass. |
| Channels | No provider keys yet. Build a channel adapter now; **simulated stays default with badge**. Resend (email), MSG91/Gupshup (SMS/WhatsApp) and Razorpay **test mode** are each a later milestone, enabled only by env key. |
| AI | Gemini (existing free key, `gemini-flash-lite-latest`, D28) + local Ollama. **No Anthropic key.** All calls via `src/lib/ai/gateway.ts`. |
| Demo promise | "Show it works today; a real school onboarded within 3 days." Onboarding + CSV import are therefore early (M3, M4). |
| Execution | Fable writes this plan. Opus picks the next milestone, writes tasks. Sonnet executes one task; Opus verifies; next task. Tokens minimal everywhere. |

Out of scope for this plan (stay fixtures with `<SimulatedBadge />`): What-if simulator (0053), digital twin (0060), Custom Studio (0057), Personal AI memory (0058), connectors (0059), dashboard layouts (0061), marketplace commerce, payment gateway beyond Razorpay test mode, on-device AI, federated learning. They are V3/V4 (vision §21).

## 1. Starting point (audit 2026-10-31, evidence in git)

**Exists and is real:** 51 migrations / 54 tables with RLS and a 1,018-test security suite; 9 roles × 39 permissions (`src/lib/auth/permissions.ts`); admissions enquiry→application→decision→enrol; daily attendance with corrections and absence notifications; assignments with quiz answer-key split; exams with versioned marks, immutable results, remarks, full recheck flow; finance (structures, concessions, term invoices, offline payments, frozen receipts, double-entry ledger, defaulters); in-app notifications with 5 bilingual templates; jobs runner (6 handlers, pg_cron on hosted); public website; AI gateway (permission→policy→quota→rate→concurrency→redaction→usage) with 7 routes incl. tool-calling teacher and student agents; hosted demo on Vercel + Supabase.

**V1 gaps:** no self-serve onboarding; no CRUD actions for years/terms/grades/sections/subjects/staff/members (seed only; `academics.manage`, `staff.write`, `member.manage`, `audit.read` unused); no documents/storage; no timetable; no assignment submissions flow (table exists, no code); no period-wise or staff attendance, leave, substitution; no facilities/assets/maintenance/transport; no internal academic calendar; no CSV import/export; no audit viewer; no announcements/circulars; SMS/email simulated; no fee reminders, void/refund, online payment; no scheduled reports; backup is a documented procedure only. Dashboards mix real queries with `src/modules/core/demo/fixtures.ts` (timetable, attendance trend, approvals, staff availability, insights).

**V2 gaps:** everything under `src/modules/fabric/**` is fixtures + localStorage store; reserved migrations 0052–0063 unbuilt; no insights, agent runs, workflows, forecasts, mastery, briefings persistence, scheduled reports.

## 2. Architecture decisions for this plan (ADR-level; record as D40–D44 in `12-decision-log.md` when M1 ships)

- **D40 API dispatcher.** `src/app/api/v1/actions/[name]/route.ts` (POST) resolves `getRegisteredActions().get(name)`, authenticates via the Supabase session cookie **or** `Authorization: Bearer <supabase access token>` (same `getTenantContext`; institution slug in the JSON body or `x-institution` header), passes the raw body to the action (Zod + permission + audit unchanged), returns the `ActionResult` envelope with HTTP 200/4xx mapped from `ErrorCode`. `GET /api/v1/actions` lists names + `z.toJSONSchema(schema)` (Zod 4 built-in) as the API reference. One route, every current and future action becomes an API. Every `"use server"` action file must import-register at module load; a unit test asserts the registry contains every exported action (extends the existing C-03 registry test).
- **D41 Query registry.** `src/lib/actions/define-query.ts`: `defineQuery({ name, schema, permission, handler })` — same shape as `defineAction`, read-only, no audit, registered in a second map. Exposed at `GET/POST /api/v1/query/[name]`; `?format=csv` streams CSV for list-shaped results (M4). Existing `queries.ts` functions are wrapped, not rewritten. **Registered queries double as agent tools** (M24): the assistant's tool list is generated from the registry, so every tool is already permission-scoped.
- **D42 Channel adapters.** `src/modules/notifications/channels/{simulated,resend,msg91}.ts` implement one `Channel` interface; `service.ts` picks by env key presence (`RESEND_API_KEY`, `MSG91_AUTH_KEY`). Badge logic reads the same predicate, so UI honesty flips automatically when a key is configured. WhatsApp only through an authorised BSP (MSG91/Gupshup).
- **D43 Deterministic intelligence first.** Insights, mastery, forecasts and timetable suggestions are **rule/statistics-based SQL or TS jobs** that write rows with evidence; the LLM only writes the explanation/next-steps text (gateway, Gemini or local), never the detection. Every insight row stores `evidence jsonb`, `confidence`, `detector_version`, `reviewer`, `status`. Vision §23 rules.
- **D44 Migration numbering.** Fabric tables keep 0052–0063 as reserved in `10-backlog-index.md` §3 and are built in Workstream C. V1-completion tables take **0064–0089** (table below). Opus claims a number by editing §3 in the same commit as the migration; the channel `CLAIM` carries the number.

| Number | Owner milestone | Tables / purpose |
|---|---|---|
| 0064 | M3 | `invitations`; `create_institution` + `invite_member` definer RPCs; grants |
| 0065 | M3 | academic setup RPCs/policies: years, terms, grades, sections, subjects, subject_assignments, staff, departments (INSERT/UPDATE policies narrowed to `academics.manage`/`staff.write`) |
| 0066 | M4 | `import_batches` + `import_rows` (staged CSV import, per-row errors) |
| 0067 | M5 | `documents` (+ storage bucket `tenant-docs`, path `<institution_id>/...`, storage RLS) |
| 0068 | M6 | `announcements` + `announcement_audiences`; `notification_preferences` |
| 0069 | M7 | `rooms`, `periods`, `timetable_slots`, `timetable_versions` (publish); conflict constraints |
| 0070 | M8 | `attendance_sessions.period_id`; `staff_attendance`; `leave_requests`; `substitutions` |
| 0071 | M9 | submissions RPC `submit_assignment`/`grade_submission`; policies on `assignment_submissions` |
| 0072 | M10 | `lesson_plans`; `curriculum_unit_coverage` |
| 0073 | M11 | `question_bank`; `exam_schedule` columns on `exam_papers` |
| 0074 | M12 | `payment_reversals` RPC (`void_payment`), `fee_reminders` log, `online_payment_intents` (Razorpay test) |
| 0075 | M13 | `assets`, `maintenance_requests`, `transport_routes`, `transport_vehicles`, `transport_assignments`, `academic_calendar_events` |
| 0076 | M14 | `student_lifecycle_events` (promotion/transfer/withdrawal) + `promote_students` RPC |
| 0077 | M15 | `scheduled_reports` + job type `report.generate` |
| 0078 | M16 | `approvals` view/function unifying pending items; `audit_events` read RPC with paging |
| 0079–0089 | spare | fix rounds, found bugs (Opus records purpose in §3) |
| 0052 | M26 | `marketplace_modules`, `module_installs` (entitlement-backed) |
| 0092 | M19 | `insights`, `insight_actions`, `briefings` |
| 0093 | M20 | `mastery_snapshots` |
| 0094 | M21 | `forecasts`, `forecast_backtests` |
| 0095 | M22 | `agent_definitions`, `agent_runs` |
| 0096 | M23 | `workflows`, `workflow_runs` |
| 0097 | M27 | seed section `fabric` (insights, agents, workflows, mastery, forecasts) |
| 0098 | M27 | grants audit + security suite for 0052–0078 |

New permission keys (added to `permissions.ts` + `07 §2.2` in the milestone that first needs them): `timetable.manage`, `timetable.read`, `staff.attendance.mark`, `leave.request`, `leave.approve`, `document.read`, `document.write`, `announcement.manage`, `data.import`, `data.export`, `report.schedule`, `facilities.manage`, `transport.manage`, `insight.read`, `insight.review`, `agent.run`, `agent.approve`, `workflow.manage`, `module.install`. Guardians/students get only `document.read` (own), `announcement` read via `notification.read`, `insight` nothing.

## 3. Milestones (Opus picks strictly in this order unless the owner reorders)

Each milestone: **Goal · Builds · Replaces fixture · Acceptance (tests Opus must see green) · Spec links**. "Replaces fixture" names the `src/modules/fabric/types.ts` / `core/demo/fixtures.ts` function the UI will swap to a registered query; the query's return type must equal the fixture's row type.

### Workstream A — API + onboarding foundation (demo-critical)

**M1 API dispatcher for actions** — D40. Builds: `src/app/api/v1/actions/[name]/route.ts`, `GET /api/v1/actions` reference, bearer-token support in `src/lib/supabase/server.ts` (header client), `src/lib/http/api-envelope.ts` (ErrorCode→HTTP map), unit tests for envelope + registry completeness, db test calling one real action (e.g. `admissions.enquiry.addNote`) over HTTP with a teacher JWT and an accountant JWT (403). Acceptance: every registered action callable via curl with a seeded user's token; `tests/security/csrf.test.ts` extended (Origin check on the dispatcher). Spec: `06 §1`, `07 §3`.

**M2 Query registry + dispatcher** — D41. Builds: `define-query.ts`, `/api/v1/query/[name]`, wrap existing queries (people, attendance, exams, finance, admissions, dashboard, portal) with names `<module>.<fn>`; `GET /api/v1/query` lists them. Acceptance: every page's data need is reachable via query API; RLS still the only data filter (db test: guardian query for another child → empty/forbidden).

**M3 Onboarding + school setup** — 0064, 0065. Builds: `core.institution.create` (signup user → institution + owner membership + default academic year/terms, slug uniqueness), `core.member.invite` (creates `invitations` row + sends via channel adapter; simulated = logged link; accept → membership), `core.member.setRole/deactivate`, CRUD actions for academic years, terms, grades, sections, subjects, subject_assignments, staff, departments; institution settings update (timezone, locale, fee rules). Acceptance: db test onboards a brand-new school from zero to "first teacher invited, first section created" using only actions; escalation tests (teacher cannot invite owner; 0033 guard holds). Spec: `05 §3`, `07 §2.2`, DBT-12.

**M4 CSV import/export** — 0066. New dep allowed: `papaparse` (quoting-correct CSV; justification: no std-lib CSV in Node). Builds: `data.import.stage` (upload CSV text → `import_batches` + per-row Zod validation into `import_rows` with errors), `data.import.commit` (students+guardians, staff, fee structures, marks — one entity type per batch, idempotent on admission_no/employee_no), `?format=csv` on query dispatcher, CSV templates under `public/templates/*.csv`. Acceptance: 200-student CSV with 5 bad rows → 195 committed, 5 reported with row numbers; re-commit is a no-op. This is the "3-day onboarding" path; `docs/planning/coolskool/11-operations.md` gets an onboarding runbook section.

**M5 Documents/storage** — 0067. Builds: bucket `tenant-docs` in `supabase/config.toml` + storage RLS by `<institution_id>/` prefix, `documents` table (entity_type student|staff|application|submission, entity_id, kind, path, size, mime), `document.upload` (signed upload URL), `document.read` (signed read URL, 60s), delete = soft. Acceptance: db test — guardian reads own child's document, not another's; 10 MB cap; mime allowlist (pdf, jpg, png). Spec: `07 §2.2`, `04 §storage`.

**M6 Announcements + preferences + audit viewer** — 0068, 0078 (audit RPC part). Builds: `announcement.create/publish` (audience: school, grade, section, role; publish enqueues `notify.announcement` job → channel adapter), `notification.preferences.set` (per channel per category), `core.audit.list` query (paged, filterable, `audit.read`). Replaces: `AuditEventRow` fixture (trust workspace). Acceptance: staff-only announcement invisible to guardian via direct PostgREST (lesson 1); preference `sms=false` suppresses delivery attempt.

**M7 Timetable** — 0069. Builds: rooms, periods (per institution bell schedule), `timetable_slots` (section, weekday, period, subject, teacher, room) with **unique constraints** `(teacher, weekday, period, version)` and `(room, weekday, period, version)` = conflict detection in the DB; `timetable.saveDraft/publish` (versions), queries `timetable.forSection/forTeacher/forStudent/conflicts`. Replaces: `demoTimetable`, `TimetableConflict`, `TeacherWorkload` (periods/week), `RoomUtilisation`. Acceptance: inserting a double-booked teacher fails with `conflict`; published version read by guardian/student for own section only. Seed: a full weekly timetable for the demo tenant (seed section `timetable`).

**MOD Core + plug-and-play modules** — D45, 0084 (owner directive 2026-11-02). Runs after batch M08–M14 + M17 merges; supersedes M26's foundation part (marketplace commerce stays V3). Builds: code catalog `src/lib/modules/catalog.ts` (33 keys: 6 always-on core, 27 optional in 10 categories), state in `institutions.settings.modules`, `isModuleEnabled` + SQL mirror `app.module_enabled`, gate in `defineAction`/`defineQuery` (`forbidden`), nav/page/job/channel/AI-route gates, `core.module.set` + `core.modules.list` + `/settings/modules`, retrofit of every existing action/query. Acceptance: `tests/security/module-gate.test.ts` (every optional-module name → `forbidden` when its module is off); SQL/TS drift test; typecheck with `module` required. Tasks: `06-backend-packets/MOD-tasks.md`. **Every later milestone declares its module key** (header + `module` on each definition, `requireModule` on pages, `JOB_MODULES` row per job type).

**M8 Period attendance, staff attendance, leave, substitution** — 0070. Builds: optional `period_id` on sessions (daily stays default), `staff_attendance` (mark by admin/principal, self check-in optional), `leave.request/approve/reject` (state machine + guard trigger, lesson 11), `substitution.assign` (links a timetable slot + date + substitute teacher; conflict-checked against M7). Replaces: `demoStaffAvailability`, `demoApprovals` (leave part). Acceptance: approve path audited; teacher cannot approve own leave; substitute double-booking rejected.

**M9 Assignment submissions + feedback** — 0071. Builds: `assignment.submit` (student; text + optional document from M5; one current submission, resubmit supersedes), `assignment.grade` (teacher; score, feedback), queries `assignments.submissionsForAssignment`, `portal.mySubmissions`. Acceptance: student cannot submit for another student (RLS + RPC); guardian sees feedback; late flag computed from due date.

**M10 Curriculum coverage + lesson plans** — 0072. Builds: `lesson_plans` (section, subject, unit, date, objectives, resources), `curriculum.markCovered` (unit × section, date), queries `curriculum.coverageBySection`. Replaces: `CurriculumCoverage`. Acceptance: coverage % per section/subject matches units marked.

**M11 Question bank + exam schedule + printable report card** — 0073. Builds: `question_bank` (subject, unit, difficulty, type, body, answer — staff-only RLS like 0023), `exam_papers.scheduled_at/room_id`, query `exams.schedule`, server-rendered print view route `/api/v1/query/exams.reportCardHtml` (HTML, print CSS; PDF is a later UI concern). Replaces: `AssessmentPlanItem`. Acceptance: question bank invisible to student/guardian over PostgREST; schedule conflicts with timetable rooms detected (query, not constraint).

**M12 Finance completion** — 0074. Builds: `finance.voidPayment` (reversing ledger entries, receipt marked void in a new snapshot row, DBT-04/DBT-14), job `finance.fee_reminder` (defaulters → channel adapter, log in `fee_reminders`), `finance.collectionReport` query (by term/grade/mode, CSV), Razorpay **test mode**: `finance.createPaymentIntent` → order id, webhook route `/api/public/payments/razorpay` (signature verified, idempotent, calls `record_payment` as service role, lesson 3), badge `<LimitedBadge>` "test mode". Acceptance: void then re-record keeps ledger balanced; webhook replay idempotent; forged signature 400.

**M13 Operations: facilities, transport, academic calendar** — 0075. Builds: assets, `maintenance.request/assign/close`, transport routes/vehicles/student assignments, `academic_calendar_events` (holidays, exam weeks, PTM) with query `calendar.forRole`. Replaces: `MaintenanceRequest`, `TransportRoute`, demo events. Acceptance: guardian sees own child's route stop only; holiday blocks attendance session creation.

**M14 Student lifecycle** — 0076. Builds: `student.promote` (bulk, year→year, section mapping), `student.transfer/withdraw` (status + transfer certificate data snapshot), `student.update` (profile fields), `guardian.update/link`. Acceptance: promoted student's enrolment history has both rows; withdrawn student loses portal access (membership inactive).

**M15 Scheduled reports + exports** — 0077. Builds: `scheduled_reports` (query name + params + cron + recipients), job `report.generate` (runs registered query → CSV → document (M5) → notification), `report.export` on-demand. Acceptance: nightly attendance report lands as a document readable by principal only.

**M16 Dashboards on real data + approvals** — 0078. Builds: `core.approvals.pending` (union: attendance corrections awaiting, leave requests, recheck requests, insights awaiting review, agent runs awaiting approval), `dashboard.attendanceTrend` (last 30 days from `attendance_records`), role dashboards as queries: `dashboard.principal/teacher/parent/student/finance/admissions/operations`. **Deletes** `demoTimetable`, `demoAttendanceTrend`, `demoApprovals`, `demoStaffAvailability` usage from pages (rule 7 exception ends). Acceptance: `e2e/j13-dashboard.spec.ts` passes with fixtures removed; perf test on seeded tenant < 1.5s per dashboard query.

**M17 Channels: Resend email** — D42. Builds: `resend.ts` adapter (fetch, no SDK), invite + announcement + reminders through it when `RESEND_API_KEY` set, delivery status written to `delivery_attempts`, badge flips. Acceptance: unit test with mocked fetch; manual send once on hosted.

**M18 Backup/restore drill + ops** — Builds: `scripts/db-backup.ts` (pg_dump via supabase CLI to a dated file), `scripts/db-restore.ts`, documented RPO/RTO in `11-operations.md`, one real drill on hosted recorded with timings. Acceptance: restore into a fresh local DB passes `pnpm test:db`.

### Workstream B — V1 release gate

**V1-GATE — V1 completion report** — Opus runs the full suite, updates `03-feature-matrix.md` statuses, writes `docs/planning/fabric/reports/v1-completion.md` with one evidence line per roadmap §V1 acceptance criterion (test name or query), posts `DONE V1 <sha>`. Owner demo rehearsal on hosted follows.

### Workstream C — V2 intelligence (Fabric backend)

**M19 Insights engine** — 0054, D43. Builds: `insights` + `insight_actions` + `briefings` tables (columns = `Insight`, `InsightAction` in `types.ts`); job `insights.detect` nightly running detectors in `src/modules/insights/detectors/*.ts`, one file each: attendance anomaly (section/student drop vs 4-week baseline), marks decline (exam-over-exam per student/subject), missing submissions pattern, fee irregularity (overdue growth, unusual concessions), admissions bottleneck (stage dwell time), staff workload (periods/week over threshold, M7), timetable conflicts (M7), resource shortage (room utilisation, M7/M13). Each writes evidence JSON + confidence + `detector_version`; dedupes on `(kind, entity, window)`. `insight.explain` action: gateway (Gemini, redacted; local fallback) writes "what/why/next steps" into the row — suggestion only. `insight.review/action/resolve/dismiss` with reviewer assignment. Replaces: insights workspace fixtures, `demoInsights`, `RiskIndicator`, `PriorityAction`. Acceptance: unit tests per detector on synthetic series; db test on seeded tenant produces ≥1 insight per domain; no per-student label text in prompts (lesson: anonymised like `getSectionAttendancePatterns`); AI never changes `status`.

**M20 Learning mastery** — 0080. Builds: `mastery_snapshots` (student × subject × unit, score 0–1, source counts, computed_at) from marks (paper→unit mapping via `exam_papers.unit_ids`, added here) + graded quiz submissions (M9); job `mastery.compute`; queries `mastery.heatmapBySection`, `mastery.gapsForStudent`, `mastery.studentSuccessRows`; `intervention_plans` as `insight_actions` of kind `intervention` (teacher-reviewed). Replaces: `MasteryCell`, `StudentSuccessRow`, `InterventionPlan`. Acceptance: deterministic numbers on seed; student sees own mastery only.

**M21 Forecasting (baseline)** — 0081, L2-03 scope. Builds: `forecasts` (series key, horizon, point, lower, upper, model `seasonal_naive_v1`), `forecast_backtests` (MAPE on held-out last 3 periods), job `forecast.run` for fee collections per term and attendance per section; TimesFM is a later swap (model column). Replaces: `ForecastCard`, `FinanceForecastPoint`. Honesty: `<LimitedBadge>` "baseline model, backtested MAPE shown". Acceptance: backtest row exists before a forecast is shown; no per-student forecasts.

**M22 Agent workforce (bounded)** — 0055. Builds: `agent_definitions` (6 seeded: academic, attendance, admissions, finance, communication, administrative; each = role scope + tool allowlist from the query registry + permitted actions with `RiskClass`), `agent_runs` (task, status machine from `AgentRunStatus`, cost from `ai_usage_events`, approval_required), job `agent.run` executing via `streamAgent` with the definition's tools only; `agent.approve/reject` for `human_approved` actions; activity log = runs + audit. Replaces: AI workforce fixtures. Acceptance: a finance agent run cannot call `exam.*` tools (unit test on tool list); an action classed `human_approved` stays `awaiting_approval` until approved; usage/cost visible on `/ai/usage`.

**M23 Workflow automation (low-risk)** — 0056. Builds: `workflows` (graph JSON = `WorkflowNode`/`GraphEdge`; node types limited to trigger schedule|event, condition on query result, notify, report, agent, approval, end), `workflow_runs`; engine in `src/modules/workflows/engine.ts` (pure, unit-tested) run by job `workflow.run`; events emitted from existing jobs (attendance submitted, results published, invoice overdue, enquiry received). Seeded workflows: absence follow-up, assignment reminder, exam reminder, fee reminder, admissions follow-up. Acceptance: engine unit tests for branches/approval gates; run history per workflow; disabling stops the trigger.

**M24 School-aware assistant** — generalise `agent/teacher` to `/api/ai/agent/assistant`: tools generated from the query registry filtered by the caller's permissions (D41), plus `navigate` (returns a route from the nav spec), `createTask` (creates an `insight_action`/approval). Every answer carries `sources: [{query, params}]`. Student assistant stays separate (D32). Acceptance: principal asks "classes with largest maths decline this term" → tool `mastery.declineBySection` called, answer cites it; teacher cannot reach `finance.*` tools (db test under real RLS like the existing teacher-agent isolation test).

**M25 Briefings + AI timetable suggestions** — Builds: job `briefing.generate` (principal/teacher/finance/admissions daily, weekly performance) persisting to `briefings` with source refs (extends `dashboard-briefing` route to read persisted first); `timetable.suggest` (greedy conflict-aware fill for unassigned slots, returns proposals as `insight_actions`, never auto-applies). Replaces: `DailyBrief`. Acceptance: briefing row links ≥3 queries; suggestion never writes `timetable_slots`.

**M26 Module/entitlement foundation** — 0052. **Foundation superseded by MOD (D45); only marketplace commerce remains, V3.** Builds: `marketplace_modules` (global catalogue = feature catalog v2 keys grouped; free only), `module_installs` → sets entitlements (D30/D33) on install/disable; `module.install/disable`. Replaces: marketplace fixtures (install state only). Acceptance: disabling a module hides its permissions' actions (dispatcher returns `forbidden`).

**M27 Fabric seed + security suite + V2 gate** — 0062, 0063. Builds: seed section `fabric` (insights, mastery, forecasts, agents, workflows, briefings for the demo tenant), RLS isolation generator extended to all new tables, grants audit, perf test on big new tables (lesson 10). Opus writes `reports/v2-completion.md` with evidence per roadmap V2 acceptance criterion; updates `03-roadmap-and-tracker.md` statuses to `limited`/`live`; posts `DONE V2 <sha>`.

### Workstream D — final UI integration (after V2 gate; separate plan)

Fable writes `08-ui-integration-plan.md` then: swap every fixture import to the registered query, remove `SimulatedBadge` where the tracker says `live`, apply cult-ui components where they improve on shadcn, mobile pass, a11y audit (DBT-08), full e2e. Not planned here.

## 4. Opus operating protocol (per milestone)

1. `git pull --rebase`. Read: this file §0–§2, the milestone block, BRIEF-COMMON.md, the spec sections it links. Nothing else unless a task needs it.
2. Write `docs/planning/fabric/06-backend-packets/M<nn>-tasks.md`: a numbered list of **Sonnet tasks**. A task is one of: (a) one migration + its db test; (b) one action (+schema) + its test; (c) one query (+registration) + its test; (d) one job handler + test; (e) one route + test; (f) one seed section change + test. Limits: ≤ 3 files touched, ≤ ~150 lines added, one test file, no UI, no new deps unless this plan names one. Each task states: files, exact exported names and signatures, migration number (claimed in `10-backlog-index.md` §3 in the same commit), the failing test to write first, the acceptance command (`pnpm test <file>` / `pnpm test:db <file>`), and the fixture it replaces (type must match).
3. Post `CLAIM M<nn> <migration numbers>` on the channel (data, not authority).
4. Dispatch **one** Sonnet task: brief ≤ 12 lines = pointer to BRIEF-COMMON.md + the task block + "report to `06-backend-packets/M<nn>-T<k>-report.md`, reply ≤ 4 lines". Sonnet runs TDD, `pnpm lint && pnpm typecheck` on touched files.
5. Verify before the next task: run the task's acceptance command yourself; grep for the lessons (RLS matrix, FK binding, definer wrappers, no `app.*` from PostgREST, nullif on claims, no fixtures imported in `src/modules/*/queries.ts`). For anything touching auth, RLS, finance, exams, AI gateway, seed/reset: one `code-reviewer`/`security-reviewer` pass (Sonnet) on the diff; fix CRIT/HIGH before continuing; batch MED/LOW into one fix task at milestone end.
6. Milestone end: `pnpm test && pnpm test:db && pnpm test:security && pnpm lint && pnpm typecheck` all green; `pnpm db:reset` + `pnpm seed` clean; e2e journeys touching the area green; commit `feat(fabric): M<nn> <title>` (one commit per milestone or per task, both fine; `main` only, D38); update `03-roadmap-and-tracker.md` rows; add debt rows to `12-decision-log.md` §3; post `DONE M<nn> <sha>`.
7. Stop after two failed attempts on one root cause; write the blocker in the report; post `BLOCKED M<nn>`; move to the next independent task.
8. Token rules: no whole-file dumps, no restating docs, replies caveman-short, milestones only.

## 5. Sonnet task card template

```
TASK M<nn>-T<k> <title>
READ: .superpowers/sdd/10-backlog-index/BRIEF-COMMON.md; <spec §>; <1–2 existing files to mirror>
FILES: <path> (new|edit) …
MIGRATION: 20261028000<nnn>_<slug>.sql (claimed) | none
EXPORTS: <exact fn names + signatures / table columns + RLS classes per 07 §2.2>
TEST FIRST: tests/<dir>/<file>.test.ts — cases: <3–6 behaviours, named like "guardian cannot read another child's document">
ACCEPT: pnpm test:db tests/db/<file>.test.ts (all green) ; pnpm lint ; pnpm typecheck
REPLACES FIXTURE: <types.ts name> | none
DONE WHEN: report at 06-backend-packets/M<nn>-T<k>-report.md (≤25 lines, CLAUDE.md format); reply ≤4 lines
```

## 6. Demo readiness checklist (owner-facing, after M4 and again after M16)

- Hosted demo seeded; `/api/v1/actions` and `/api/v1/query` reference pages load.
- Onboard a new school live: `core.institution.create` → invite principal (simulated link shown) → import 200 students CSV → create sections → mark attendance → publish timetable (M7) → record a payment → see dashboards.
- Every simulated channel shows its badge; every AI output shows its provider badge and "AI draft, human saves".
- 3-day onboarding runbook (`11-operations.md`): day 1 data templates + import, day 2 structure + timetable + fees, day 3 invites + training + go-live.

## 7. Risks

- **Fixture/type drift:** UI packets consume `types.ts` while backend builds tables; any column change needs a `CONTRACT` commit before either side proceeds (existing rule). Opus checks `05-data-contracts.md` on every milestone that "replaces fixture".
- **Free-tier Gemini latency/quotas** at demo time: all AI milestones must work with local Ollama as fallback (policy already routes); demos script AI features last.
- **Scope creep from the vision:** V3/V4 items listed in §0 stay fixtures. Opus refuses tasks outside §3; owner reorders by editing §3.
- **Migration collisions with the UI session:** UI session never writes migrations; numbers 0064–0089 are backend-only.
