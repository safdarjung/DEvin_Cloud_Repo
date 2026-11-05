# M27 — Fabric seed + security suite + V2 gate

Source: `07-master-plan-v1-v2.md` §3 M27. Migration: **none** — reserved `0097` and `0098` are released (rulings). No new deps, permissions, actions, queries, job types, pages or nav items, so there is no module key, manifest line, C-03 fixture or smoke sample. Owning files: seed section `scripts/seed/sections/fabric.ts` (new, registered last) and the security/perf tests below. **Prereqs merged:** M12–M25, X01–X08, MOD, V1-GATE (`docs/planning/fabric/reports/v1-completion.md`). Specifically: M16-T2 `tests/helpers/demo-context.ts` (`signInDemo`, `buildDemoContext`, `timed`, `closeDemoHelper`) and the M16-T14 in-process route pattern (`tests/db/dashboard-perf.test.ts`); M19-T14 `src/modules/jobs/handlers/insights.detect.ts` (`insightsDetect`) and the M19-T21 per-domain counts (report + the M19 debt row "seeded-tenant domains with 0 candidates" in `12-decision-log.md` §3); M20-T12 `src/modules/mastery/detector.ts` (`runMasteryGapDetector`) and M20-T13 seed section `mastery`; M21-T7 `src/modules/jobs/handlers/forecast.run.ts` (`forecastRun`); M22-T3 `src/modules/agents/catalog.ts`; M23-T20 seed section `workflows`. Replaces fixture: none (data only; M19–M25 already swapped the types).

Rulings:
- **No migration; 0097 and 0098 are released.** Seed data is TypeScript (`scripts/seed/sections/*.ts`, run by `pnpm seed` and `pnpm demo:reset`), never SQL. A migration also runs on hosted and on every real school's database, so demo rows there would break rules 1 and 11. The grants audit and the RLS suite are tests over the catalog (`scripts/audit-grants.sql`, `pg_policies`, `pg_class`) and create no object. 0098's original scope ("security suite for 0052–0078") is covered by the generic tests below, which cover every tenant table. A defect that an M27 task finds is **not** fixed inside M27: the task stops and reports it, and the controller claims a new number ≥ 0100 (BRIEF-COMMON HOSTED-APPLIED; a fix for a 0092–0099 object must also sort after 0099). T8 marks 0097 and 0098 freed in `10-backlog-index.md` §3.
- **Tables in scope ("new tables": M12–M25 and X01–X08).** M12: `payment_reversals`, `fee_reminders`, `online_payment_intents`. M13: `assets`, `maintenance_requests`, `transport_vehicles`, `transport_routes`, `transport_stops`, `transport_assignments`, `academic_calendar_events`. M14: `student_lifecycle_events`. M15: `scheduled_reports`. M19: `insights`, `insight_actions`, `briefings`. M20: `mastery_snapshots` (and the intervention policies on `insight_actions`). M21: `forecasts`, `forecast_backtests`. M22: `agent_definitions`, `agent_runs`. M23: `workflows`, `workflow_runs`. X01: `student_leave_requests`, `diary_entries`, `diary_acknowledgements`. X02: `certificates`. X03: `library_books`, `library_copies`, `library_loans`. X04: `late_fee_rules`, `invoice_instalments`, `late_fee_charges`. X06: `exam_seating_plans`, `exam_seats`. X07: `visitor_entries`, `pickup_persons`, `gate_passes`. X08: `ptm_events`, `ptm_event_sections`, `ptm_slots`, `ptm_bookings`, `surveys`, `survey_audiences`, `survey_respondents`, `survey_responses`. M16, M17, M18, M24, M25, X05 and MOD add no tenant table. That is 45 tables. T7 holds this list as `NEW_TABLES`; T4 reconciles each one's `rls-expectations.ts` entry. If a merged migration created a table that is not listed here, add it and say so in the report.
- **Seed section `fabric` — engines, not literals.** It runs last in `SECTIONS`, after M20's `mastery` and M23's `workflows`. Every row it creates comes from the real deterministic engine called in-process with `ctx.admin`. The only exception is agent runs, because no engine can produce them without a model. Contents:
  - `AS_OF` = `max(date)` of the demo tenant's daily (`period_id is null`), submitted `attendance_sessions`. Today that is 2026-10-28, the end of the fixed attendance window. If the M16 debt fix ever moves that window, `AS_OF` follows it.
  - **Insights.** Call `insightsDetect(job, { admin: ctx.admin })` with a synthetic `JobRow` (`id = uuidV5("fabric", "job:insights.detect")`, `type: "insights.detect"`, `payload: { as_of: AS_OF }`, `status: "running"`, `attempts: 1`, every other field filled). The row is never inserted into `jobs`. The handler throws if a detector fails, and the seed lets it throw. Then call `runMasteryGapDetector(ctx.admin, ctx.institutionId)` (real `now`, which is M20's own window rule).
  - **Lifecycle picks** show the review flow. Candidates are the insights whose `signal` is one of M19's 11 keys, so M20 gap rows are excluded. Order: severity rank desc, confidence desc, `created_at` asc, `dedupe_key` asc. Pick from all candidates, whatever their status. A step runs only while its target is still `new`, which makes the section idempotent.
    - `INS-REVIEWING`: the first candidate in domain `attendance` (fallback: the first candidate). Principal `decide_insight(id, 'review')`.
    - `INS-ACTIONED`: the first candidate in domain `finance`, `operations`, `staff` or `admissions` that is not already picked (fallback: the next candidate). Principal `record_insight_action(id, 'Review the evidence with the responsible staff', 'Principal''s office', 'Raised by the insights engine for follow-up.', 'Cause identified and a fix agreed.', 'planned')`, then the same text with `p_status 'done'` and `p_supersedes_id` = the planned row.
    - `INS-DISMISSED`: the last candidate with `approval_required = false` that is not already picked. Principal `decide_insight(id, 'dismiss', 'Known cause; no action needed this term.')`.
    - With fewer than 3 candidates, skip the missing picks and say so in the report.
    - RPCs run as the demo principal inside one `ctx.sql.begin` transaction per call, with `set_config('request.jwt.claims', {sub, role: "authenticated"}, true)`. This is the `scripts/seed/sections/exams.ts` publish precedent. The RPCs audit as they normally do.
  - **Intervention.** `PLAN-VI-A-ACTIVE`: the first `proposed` intervention plan of a VI-A student, ordered by roll number (fallback: the first plan by section label, then `student_id`). Set `intervention_status = 'active'` with `ctx.admin`; M20's guard trusts the service role and sets `status`. No plan → skip and report.
  - **Forecasts.** Call `forecastRun(job, { admin: ctx.admin })` with a synthetic `JobRow` whose payload is `{ as_of: AS_OF }`. Expected result: `attendance:school` plus one series per section, 3 horizons each, every forecast tied to a backtest of the same series and model. **No `fees:term` forecast:** at `AS_OF` the demo tenant has one complete term, and the engine needs 4. That absence is correct behaviour ("no backtest, nothing shown"); planting prior-year finance history is an open owner question (T8 debt row). Never insert forecast rows by hand.
  - **Agents.** Insert the 6 `agent_definitions` rows (`AGENT_SLUGS`, `is_enabled` true) with `on conflict (institution_id, slug) do nothing`. Then insert 4 finished or waiting `agent_runs` with `ctx.admin`, `on conflict (id) do nothing`. M22 left inserts unguarded for exactly this. `requested_by` = demo principal; `catalog_version` = `AGENT_CATALOG_VERSION`; `workflow_run_id` null; no `ai_usage_events` (cost 0). Timestamps are relative to the run time, as in `staffing.ts`: created 50 h, 26 h, 6 h and 2 h ago, `started_at` = `created_at`, `finished_at` 1 minute later for terminal rows.

    | handle | id = `uuidV5("fabric", …)` | agent | status | risk_class | task | proposals |
    |---|---|---|---|---|---|---|
    | `RUN-ATT-DONE` | `agent-run:attendance-done` | attendance | done | read_only | "Which sections are below the attendance threshold today?" | `[]` |
    | `RUN-COM-FAILED` | `agent-run:communication-failed` | communication | failed | read_only | "Draft a reminder about next week's events." | `[]` |
    | `RUN-ADM-REJECTED` | `agent-run:admissions-rejected` | admissions | rejected | user_confirmed | "Add a follow-up note to the oldest new enquiry." | 1 × `admissions.enquiry.note` (input valid for its schema; the oldest `new` enquiry by `created_at`, `id`), status `skipped`; `decided_by` principal, `decision_note` "Not needed this week." |
    | `RUN-FIN-APPROVAL` | `agent-run:finance-reminders` | finance | awaiting_approval | human_approved | "Send fee reminders to families with overdue invoices." | 1 × `finance.reminders.send`, input valid for `SendFeeRemindersSchema`, status `proposed`, `error_code` null |

    **Honesty:** no model wrote these rows. Each `summary` is "Seeded demo run: no model was called." Each `log` starts with `{ level: "info", text: "Seeded demo run (no model call)" }`, followed only by entries that describe the stored state (`Proposed <action> (<risk>)`, `Rejected by principal`, `Finished: <status>`). There is never a `Called <query>` entry, because no tool ran. Approving `RUN-FIN-APPROVAL` runs the real `finance.reminders.send` path (M22-T8; simulated channel with badge). That is the demo's agent-approval step.
  - **Not seeded, by design:** `mastery_snapshots` (M20's `mastery` section); `workflows` (M23's `workflows` section); **`briefings`** — M25 generates a brief lazily for the calling user from registered queries that need that user's session. The seed cannot run those under plain node, and a seeded row would freeze a brief no generator produced for that day; the first open creates it. **`workflow_runs`** — runs are engine history; the 4 scheduled demo workflows create real runs on the first runner tick after their `next_run_at`; the seed never runs or leaves jobs (the `exams.ts` precedent). T9 cites M25-T9 and M23-T21 as the evidence for those two.
  - **Determinism, idempotency, reset.** For a given seed and `AS_OF`, re-seeding reproduces the same business fields. Ids are deterministic except where `record_insights` uses `gen_random_uuid()`; that is the same exemption the exams and finance fingerprints already use. Re-running the section on a seeded tenant adds no row. It creates no `jobs` row and no notification. `app.demo_reset` must clear everything it wrote, including superseded `insight_actions`, guarded `agent_runs` and `workflow_runs`. If the reset fails on these rows, that is a finding: stop and report, because the fix needs a migration ≥ 0100.
  - **Runner interplay (expected, not a bug).** Any later runner tick (hosted pg_cron, or `runOnceCore` in another db test file) runs `forecast.run` and `insights.detect` with the live date. That replaces the seeded forecasts and adds insights. Once the fixed attendance window is more than 4 weeks old (about 2026-11-23), the live attendance series is stale and demo forecasts disappear. This has the same root cause as the M16 attendance-window debt. Tests that assert fabric rows therefore run their own `demo:reset` first.
  - **Scale.** Assertions that depend on detector output (named insights, the VI-A plan) run only at `getSeedScale() === "full"`. `small` asserts only the scale-free rules: agents, the school-wide forecast, and no jobs left.
  - Imports: relative `.ts` only (BRIEF-COMMON). The handlers, `detector.ts` and `catalog.ts` are already plain-node safe because `pnpm jobs:run` and the seeds load them. If one is not, stop and report; never add `@/` to the seed.
- **Planting (T1) — only where M19 recorded zero candidates, never a threshold.** A domain may be planted only when all of these hold:
  - its zero count comes from the seed being internally inconsistent (for example, a row stamped with wall-clock `now()` while its siblings use the fixed window);
  - the fix is ≤ 30 lines in the owning seed section;
  - it changes no 05 §8.1 named entity, no §8.2 count and no other section's test expectation.

  Otherwise the domain becomes a debt row. Planner's estimate from the current seed:
  - `admissions.stage_dwell` is zero because enquiries keep the default `updated_at` = seed time, after `AS_OF`, while `created_at` is fixed. Plant: `updated_at = created_at` in `admissions.ts`.
  - `academics.marks_decline` is structural (only HY-2026 is published; PT2-X is a live demo step); `missing_work` and `awaiting_review` are also structural (§8.2 asserts zero homework assignments). Debt; the academics domain is covered by M20 gap insights.
  - `finance.concession_spike` is zero (concessions are stamped at seed time). Leave it; `overdue_growth` covers finance.
- **RLS suite extension (T4, T5).** `rls-generated.test.ts` (C-01) already discovers every tenant table and fails on a missing expectation, so the new tables are covered for cross-tenant SELECT. M27 adds four checks:
  1. **Catalog (T4):** every tenant table has `relrowsecurity`. An entry with `write: []` has no permissive `INSERT|UPDATE|DELETE|ALL` policy. An entry with a non-empty `write` has at least one such policy.
  2. **Cross-tenant INSERT (T4):** for every table × role, inserting `{ institution_id: B }` as A's member fails with `42501`, or with `P0001` whose message starts with `code:`. RLS `WITH CHECK` runs before NOT NULL, FK and CHECK constraints. So a `23502`, `23503` or `23514` means RLS let a foreign institution through, and the check fails. This makes C-01's documented "INSERT … with a foreign `institution_id` fails" true; UPDATE and DELETE are already covered, because SELECT policies apply to their `WHERE`. Exceptions only for an open DBT row, keyed by table with the DBT id (expected: `guardian_students`, DBT-45 recursion).
  3. **Within-tenant deny probe (T5):** on the seeded demo tenant, for every tenant table, every demo login whose role is **not** in the entry's `read` list, plus `anon` unless `anonRead`, selects `institution_id = demo` and gets 0 rows (or a `42501` grant-layer denial). This enforces the `read` lists, which until now were documentation only (lesson 1). `owner` has no demo login and is not probed. The rows exist (seeded), so a non-empty result is a real leak. `EMPTY_IN_DEMO` (in the test, one comment per table) lists tables the seed leaves empty. Every table not in it must have ≥ 1 demo row, which keeps the probe non-vacuous. The check runs one way only, because runner ticks from other files may add rows.
  4. **Reconciliation (T4):** for each of the 45 tables, the entry's `classes`, `read` and `write` must equal its task-file RLS ruling and its migration's policies.

  If an entry is wrong, fix the entry. If a **policy** contradicts its ruling, that is a finding: stop and report; never edit an expectation to match a bad policy.
- **Grants audit (T6).** `grants.test.ts` already pins `anon`, the `app.*` RLS helpers and the `public` definers callable by `authenticated`. Two buckets become exact lists so that no function's audience drifts:
  - `PUBLIC_INVOKER_AUTHENTICATED`: public security-invoker, non-trigger functions that `authenticated` may execute (expected: the RLS-bound aggregates such as `attendance_daily_counts`, `ledger_totals`, `term_collection_totals`, `mastery_heatmap`, `mastery_student_stats`).
  - `SERVICE_ONLY`: public non-trigger functions that `service_role` may execute and `anon`/`authenticated` may not. It replaces the 4-name loop. Expected: `jobs_claim`, `jobs_complete`, `submit_public_enquiry`, `record_online_payment`, `record_insights`, `enqueue_insight_detection`, the 8 `insight_src_*`, `compute_mastery`, `enqueue_mastery_compute`, `forecast_fee_series`, `forecast_attendance_series`, `enqueue_due_forecasts`, `emit_workflow_event`, `enqueue_due_workflows`, `workflow_metric`, and the M15/X04 sweeps.

  Plus **doc drift:** every name in `PUBLIC_AUTHENTICATED` and every definer in `SERVICE_ONLY` appears in `07-security-and-ai-governance.md` §4. Lists are derived from the DB and then checked against each function's task-file grant. A contradiction is a finding.
- **Perf (T7, lesson 10: "add a perf test on seeded data for any new big table").**
  - Big = ≥ 10,000 demo-tenant rows (service-role count) among `NEW_TABLES`. The test asserts big ⊆ `PERF_MATRIX` keys, so a new big table cannot slip through.
  - Each probe: as each scoped login in the table's `read` list among `teacher.vi-a`, `guardian.one`, `student.one`, plus `principal`, run `select("id", { count: "exact", head: true }).eq("institution_id", demo)`. That evaluates the policy over every row, which is the 0020 failure mode.
  - Plus registered queries over big tables through the in-process route with a bearer token (M16-T14): `mastery.heatmapBySection` (principal, `teacher.vi-a`), `mastery.studentSuccessRows` (`teacher.vi-a`), `mastery.gapsForStudent` (`student.one` self; `guardian.one` for Aarav).
  - Budget: median of 3 timed calls after 1 warm-up < 1500 ms (the M16 budget). Expected big table: `mastery_snapshots`, about 40k rows; others as measured.
  - A miss is a finding: stop and report (an index or policy fix needs a migration ≥ 0100). Never raise the budget.
- **V2 gate (T9, Opus).** `docs/planning/fabric/reports/v2-completion.md` has one evidence line per criterion: `- [met|limited|gap] <criterion> — <test file> › "<test name>" (or query/route) — <honesty label | none>`. Criteria sources:
  - (A) every Acceptance clause of M19–M25 and M27 in `07-master-plan-v1-v2.md` §3, split at ";" into atomic lines;
  - (B) every `03-roadmap-and-tracker.md` row whose `packet` cell names M19–M25 or M27;
  - (C) one line per X01–X08 milestone (its acceptance test file);
  - V1 by link to `v1-completion.md`, not re-proved.

  Tracker status rule:
  - `live` = all of the row's evidence green and its milestone recorded no honesty label;
  - `limited` = green with a recorded label (quote it: insights "v1 rules", mastery "Estimated from exam papers and graded work", forecasts "baseline model, backtested MAPE shown", agents "Local AI only");
  - otherwise the status is unchanged and the row is listed under **Gaps**.

  The status describes backend + API. Every changed row's `packet` cell appends "· UI: Workstream D", so docs never claim a UI that still shows fixtures (rule 7). Out of scope (§0: simulator, twin, studio, personal AI, connectors, layouts, marketplace commerce) is one line, with status unchanged. Any `gap`, or a red gate → no `DONE`; the report ends `BLOCKED V2` with the list.

Routing: T1 sonnet exclusive [] ; T2 sonnet exclusive [1] ; T3 sonnet exclusive [2] ; T4 sonnet tests [] ; T5 sonnet tests [3,4] ; T6 sonnet tests [] ; T7 sonnet tests [] ; T8 haiku none [1,2,3,4,5,6,7] ; T9 opus exclusive [8]

Only T1–T3 and T9 write the demo tenant, and only through `pnpm demo:reset` and the seed. T5 and T7 read it and never write. Every test that asserts fabric rows calls `runDemoReset()` first (the `tests/db/seed-staffing.test.ts` helper), because other files' runner ticks change those rows. Shared files are **Edit only, never Write**: `scripts/seed/index.ts`, `tests/security/rls-expectations.ts`, `tests/security/rls-generated.test.ts`, `tests/security/grants.test.ts`, and every doc. T4 and T5 both edit `rls-expectations.ts`, so re-read it before editing. Single-file db runs use `pnpm test:db tests/db/x.test.ts` with no `--`. Gate agents: the 10-minute command limit kills `pnpm test:db`, so run it in the background.

---

### Task 1: M27-T1 Plant zero-candidate insight domains (Sonnet)
READ: BRIEF-COMMON.md; rulings (Planting, Seed section `fabric` → `AS_OF`); the M19 debt row "seeded-tenant domains with 0 candidates" in `docs/planning/coolskool/12-decision-log.md` §3 and the M19-T21 report (per-domain counts); `tests/db/insights-acceptance.test.ts` (M19-T21 seeded-tenant dry run); `src/modules/insights/detectors/*.ts` (the source each zero domain reads); the owning seed section(s), e.g. `scripts/seed/sections/admissions.ts`
FILES: at most 2 owning seed sections (e.g. `scripts/seed/sections/admissions.ts`) + their existing `tests/db/seed-<section>.test.ts` (one new case each). Never a detector, threshold or migration. If nothing qualifies, no file changes: report only.
EXPORTS: none. For each zero domain in the M19 row, the report states one of:
- planted: root cause, the changed lines, and the new dry-run count;
- debt: the one-line structural reason, for T8.
TEST FIRST: the owning section's seed test gets a case for the planted property, e.g. "every seeded enquiry has `updated_at` = `created_at`". Then the M19-T21 dry run, with `as_of` = `AS_OF`, shows ≥ 1 candidate for each planted domain.
ACCEPT: `DEMO_RESET_ALLOWED=true pnpm demo:reset`; `pnpm test:db tests/db/seed-<section>.test.ts tests/db/insights-acceptance.test.ts tests/db/seed-determinism.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 2: M27-T2 Seed section `fabric` part 1 — insights, lifecycle, interventions (Sonnet, seed owner)
READ: BRIEF-COMMON.md; rulings (Seed section `fabric`: `AS_OF`, Insights, Lifecycle picks, Intervention, Determinism, Scale); `scripts/seed/index.ts`; `scripts/seed/lib/{context,ids}.ts`; `scripts/seed/sections/exams.ts` lines 290–300 (jwt-claims transaction); `src/modules/jobs/types.ts` (`JobRow`, `JobHandler`); M19 `src/modules/jobs/handlers/insights.detect.ts`, `supabase/migrations/20261028000092_insights.sql` (`decide_insight`, `record_insight_action`); M20 `src/modules/mastery/detector.ts`, `scripts/seed/sections/mastery.ts`; `tests/db/seed-staffing.test.ts` (`runDemoReset`, read-the-demo-tenant pattern); T1 report
FILES: `scripts/seed/sections/fabric.ts` (new; relative `.ts` imports only); `scripts/seed/index.ts` (Edit: import + register `{ name: "fabric", run }` last); `tests/db/seed-fabric.test.ts` (new)
EXPORTS:
- `run(ctx: SeedContext): Promise<void>` (part 1);
- `fabricAsOf(ctx): Promise<string>`;
- internal `pickLifecycleTargets(rows)`: pure, with the order and fallbacks from the rulings.
TEST FIRST (`beforeAll`: `runDemoReset()`):
- Every domain that fires per the M19 counts plus T1 has ≥ 1 insight. Every M19-signal insight has `date_to` = `AS_OF`.
- Exactly the picked rows left `new`: `INS-REVIEWING` is `reviewing` with `reviewer_id` = principal, `INS-ACTIONED` is `actioned` with 2 `insight_actions` (planned, superseded by done), and `INS-DISMISSED` is `dismissed`. Every other row is `new`.
- The audit has `insight.reviewing`, `insight.action_recorded` and `insight.dismissed` by the principal, and no note text.
- Full scale only: `PLAN-VI-A-ACTIVE` is `active`, and every other plan is `proposed`. The named insights are pinned by `dedupe_key` (copy them from the run into the test and the report).
- Re-running `run(ctx)` with a ctx rebuilt from the seeded tenant leaves the insight, action and plan counts and statuses unchanged, and the demo tenant's `jobs` count unchanged.
- The section creates no `notifications` row.
ACCEPT: `DEMO_RESET_ALLOWED=true pnpm demo:reset`; `pnpm test:db tests/db/seed-fabric.test.ts tests/db/seed-determinism.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 3: M27-T3 Seed section `fabric` part 2 — forecasts, agents, reset determinism (Sonnet, seed owner)
READ: BRIEF-COMMON.md; rulings (Forecasts, Agents and its table, Honesty, Determinism, Runner interplay); T2 files; M21 `src/modules/jobs/handlers/forecast.run.ts` and `supabase/migrations/20261028000094_forecasts.sql`; M22 `src/modules/agents/catalog.ts` (`AGENT_SLUGS`, `AGENT_CATALOG`, `AGENT_CATALOG_VERSION`, `AgentProposal`, `AgentLogEntry`), `supabase/migrations/20261028000095_agents.sql` (checks), `src/modules/agents/actions.ts` (reject semantics); `src/modules/finance/reminders.actions.ts` + `SendFeeRemindersSchema`; M16 `src/modules/core/approvals.queries.ts` (`pendingApprovals`) and `tests/helpers/demo-context.ts`
FILES: `scripts/seed/sections/fabric.ts` (Edit: part 2); `tests/db/seed-fabric.test.ts` (Edit)
EXPORTS:
- `run(ctx)` gains the forecast step and the agent step, in that order after part 1.
- Constant `SEEDED_RUN_MARKER = "Seeded demo run (no model call)"`.
TEST FIRST:
- Forecasts:
  - `attendance:school` has horizons 1–3 with `as_of` = `AS_OF`, and so does the VI-A section series.
  - Every forecast's `backtest_id` names a backtest of the same series and model.
  - There is no `fees:term` row.
- Agents:
  - There are 6 definitions.
  - The 4 runs have the table's ids, statuses and `risk_class`.
  - Every run's `log[0].text` is the marker, its `summary` is the fixed sentence, and no log entry starts with "Called".
  - `RUN-FIN-APPROVAL`'s proposal input passes `SendFeeRemindersSchema`, and its action is a key of `AGENT_CATALOG.finance.actions`.
  - `RUN-ADM-REJECTED` has `decided_by` = principal.
  - `pendingApprovals` for `buildDemoContext("principal")` contains `{ kind: "agent_run", id: RUN-FIN-APPROVAL }`; admin's does not.
- Re-running `run(ctx)` adds no row.
- Reset determinism (last test):
  - Fingerprint the business fields: insights (signal, dedupe_key, severity, confidence, status, evidence), the current `insight_actions` (insight dedupe_key, action, status), forecasts (series_key, model, horizon, period_start, point, lower, upper), backtests (series_key, model, mape), agent definitions (slug) and runs (id, status, risk_class, proposals).
  - Then `runDemoReset()`; the fingerprint is equal and the reset succeeded with fabric rows present (`demo:reset` safe).
ACCEPT: `DEMO_RESET_ALLOWED=true pnpm demo:reset`; `pnpm test:db tests/db/seed-fabric.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 4: M27-T4 RLS catalog audit, cross-tenant INSERT probe, expectation reconciliation (Sonnet)
READ: BRIEF-COMMON.md (lessons 1, 2, 7); rulings (RLS suite extension 1, 2, 4; Tables in scope); `tests/security/rls-generated.test.ts`; `tests/security/rls-expectations.ts`; `tests/helpers/roles.ts`; the RLS rulings of M12, M13, M14, M15, M19, M20, M21, M22, M23, X01–X04, X06–X08 task files and the policy blocks of migrations `…0074`, `…0075`, `…0076`, `…0077`, `…0083`, `…0085`–`…0096`, `…0099`
FILES: `tests/security/rls-generated.test.ts` (Edit: 4 new `it`s); `tests/security/rls-expectations.ts` (Edit: entries for the 45 tables, only where they differ from their ruling and policy)
EXPORTS:
- `TableExpectation` gains `insertProbeException?: string` (a DBT id).
- Tests:
  - "every tenant table has RLS enabled";
  - "write: [] tables have no permissive write policy";
  - "tables with writers have a permissive write policy";
  - "cross-institution INSERT is rejected by RLS or a coded guard, for every table and role".
TEST FIRST: the four tests. Each new failure is triaged in the report as (a) an entry fix, made here, or (b) a policy finding; for (b), stop.
ACCEPT: `pnpm test:security tests/security/rls-generated.test.ts`; `pnpm test:security`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 5: M27-T5 Within-tenant deny probe on the seeded demo tenant (Sonnet)
READ: BRIEF-COMMON.md (lesson 1); rulings (RLS suite extension 3); T4 `rls-expectations.ts`; M16 `tests/helpers/demo-context.ts` (`signInDemo`); `scripts/seed/sections/core.ts` (the 11 demo logins; `SEED_DEMO_PASSWORD` default); `tests/security/rls-generated.test.ts` (`selectColumns`)
FILES: `tests/security/rls-demo-deny.test.ts` (new); `tests/security/rls-expectations.ts` (Edit: `read` lists only where the policy matches its task-file ruling and the list was wrong)
EXPORTS:
- Test "role outside `read` sees 0 demo rows" for each table × role (logins `principal`, `admin`, `admissions`, `accountant`, `examcontroller`, `teacher.vi-a`, `guardian.one`, `student.one`, plus `anon`).
- Test "every table outside `EMPTY_IN_DEMO` has demo rows".
- If `demo-context.ts` imports `@/`-only code that the security project cannot load, sign in with `@supabase/supabase-js` directly and say so.
TEST FIRST: the two tests. Run them on a fresh `pnpm db:reset`. A row returned to a denied role is a finding: stop and name the table, role and policy.
ACCEPT: `pnpm db:reset`; `pnpm test:security tests/security/rls-demo-deny.test.ts`; `pnpm test:security`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 6: M27-T6 Grants audit — exact function buckets + 07 §4 drift (Sonnet)
READ: BRIEF-COMMON.md (lessons 3, 4, 5); rulings (Grants audit); `tests/security/grants.test.ts`; `scripts/audit-grants.sql`; `docs/planning/coolskool/07-security-and-ai-governance.md` §4; the grant lines of each new function's task file (M12, M15, M16, M19–M23, X01–X04, X06–X08)
FILES: `tests/security/grants.test.ts` (Edit); `docs/planning/coolskool/07-security-and-ai-governance.md` §4 (Edit: add only missing names, in the existing row style)
EXPORTS:
- `PUBLIC_INVOKER_AUTHENTICATED` and `SERVICE_ONLY` (sorted literals).
- Tests:
  - "authenticated may execute exactly the declared public invoker functions";
  - "service_role-only public functions are exactly SERVICE_ONLY", which replaces the 4-name loop;
  - "every user- or service-callable definer is named in 07 §4" (bare function name in the file text).
- `scripts/audit-grants.sql` is unchanged.
TEST FIRST: the three tests. A function whose live grant contradicts its task file is a finding: stop.
ACCEPT: `pnpm test:security tests/security/grants.test.ts`; `pnpm test:security`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 7: M27-T7 Perf on big new tables (Sonnet)
READ: BRIEF-COMMON.md; rulings (Perf, Tables in scope); M16 `tests/db/dashboard-perf.test.ts` (in-process route + bearer + `next/headers` mock) and `tests/helpers/demo-context.ts` (`timed`); M20 `src/modules/mastery/query-defs.ts`; the `rls-expectations.ts` `read` lists
FILES: `tests/db/fabric-perf.test.ts` (new)
EXPORTS:
- `NEW_TABLES` (the 45).
- `PERF_MATRIX: Record<table, probes>`.
- Test "every new table with ≥ 10,000 demo rows has a perf entry".
- Test "each probe's median < 1500 ms".
- Log the row counts and the medians for the report.
TEST FIRST: the two tests on a fresh `pnpm db:reset`, read-only. A budget miss is a finding: stop.
ACCEPT: `pnpm db:reset`; `pnpm test:db tests/db/fabric-perf.test.ts`; `pnpm lint`; `pnpm typecheck`. The report includes the table of row counts and medians.
REPLACES FIXTURE: none

### Task 8: M27-T8 Docs (Haiku)
READ: T1–T7 reports; rulings
FILES (docs only, Edit only):
- `docs/planning/coolskool/10-backlog-index.md` §3: `0097` and `0098` → "freed — M27 is TS/test only: seed sections are TypeScript, audits are tests; fixes from M27 findings take ≥ 0100".
- `docs/planning/coolskool/05-data-architecture.md`:
  - §8 adds `fabric` to the section order.
  - §8.1 gains the fabric handles from the T2 and T3 reports: `INS-REVIEWING`, `INS-ACTIONED`, `INS-DISMISSED` (each with signal and entity label), `PLAN-VI-A-ACTIVE`, `FC-ATT-SCHOOL`, `FC-ATT-VI-A`, `RUN-ATT-DONE`, `RUN-COM-FAILED`, `RUN-ADM-REJECTED`, `RUN-FIN-APPROVAL`. Mark full-scale-only handles.
- `docs/planning/coolskool/07-security-and-ai-governance.md` §6:
  - The C-01 mechanism gains the cross-tenant INSERT probe and the catalog checks.
  - New rows: `C-05` within-tenant deny probe (`tests/security/rls-demo-deny.test.ts`); `C-06` function grant buckets + 07 §4 drift (`grants.test.ts`); `C-07` perf on big new tables (`tests/db/fabric-perf.test.ts`).
- `docs/planning/coolskool/12-decision-log.md` §3: debt rows with the next free DBT numbers. Grep the highest number first.
  - The demo has no fee forecast: it has 1 of the 4 complete terms needed. Upgrade: plant prior-year finance history (owner decision).
  - Seeded agent runs carry no model output (marker in the log). Real runs replace them in use.
  - Briefings and workflow runs are not seeded (lazy brief; engine-made runs).
  - The first runner tick replaces seeded forecasts, and from about 2026-11-23 the attendance series is stale (same root cause as the M16 attendance-window row).
  - The zero-candidate domains that T1 did not plant, with their reasons.
  - The deny probe skips `owner` (no demo login) and the `EMPTY_IN_DEMO` tables.
  - Each `insertProbeException`.
ACCEPT: tables render (no broken pipes); `pnpm lint`
REPLACES FIXTURE: none

### Task 9: M27-T9 V2-GATE — completion report + tracker (Opus)
READ: BRIEF-COMMON.md; rulings (V2 gate); `07-master-plan-v1-v2.md` §0 and §3 (M19–M25, M27); `docs/planning/fabric/03-roadmap-and-tracker.md`; `docs/planning/fabric/reports/v1-completion.md`; the M19–M25, X01–X08 and M27 reports and their debt rows
FILES: `docs/planning/fabric/reports/v2-completion.md` (new); `docs/planning/fabric/03-roadmap-and-tracker.md` (Edit: statuses + "· UI: Workstream D")
EXPORTS: the report, in this order, about 150 lines max:
- gate run (sha, date, each command with its pass/fail counts);
- (A) master-plan acceptance lines;
- (B) tracker rows with old → new status;
- (C) extensions X01–X08;
- security suite (C-01, C-05, C-06, C-07: counts of tables, roles and functions covered, the non-vacuous table count);
- perf medians (from T7);
- honesty labels;
- out of scope;
- Gaps, or "none".
Evidence is a real test name or query/route. Never "should pass".
TEST FIRST: n/a (gate). Run, in this order:
1. `pnpm lint && pnpm typecheck && pnpm test`;
2. `pnpm db:reset` (clean, seed includes `fabric`);
3. `pnpm test:db`, in the background;
4. `pnpm test:security`;
5. `pnpm test:e2e`.
Paste the actual counts.
ACCEPT: every gate command green; every criterion `met` or `limited`; the report has no `gap`. Otherwise the report ends `BLOCKED V2` with the gap list.
REPLACES FIXTURE: none

---

Controller after T9:
- Run a security review (Sonnet) on the M27 diff, covering:
  - the seed's service-role writes and jwt-claims impersonation (the demo tenant only; claims are transaction-local);
  - no PII or payloads in seed logs;
  - the seeded agent runs' honesty marker;
  - tests that read the demo tenant never write it.
  The `security-reviewer` agent type cannot write files: pass its findings inline to the fixer.
- Fix CRIT/HIGH/MED.
- Commit `feat(fabric): M27 fabric seed + security suite + V2 gate` and push to `main`.
- No hosted migration push (none exists). Reseeding the hosted demo (`DEMO_RESET_ALLOWED=true pnpm demo:reset` against hosted) is owner-run.
- Post `DONE V2 <sha>`, only if the report has no `BLOCKED V2`.
