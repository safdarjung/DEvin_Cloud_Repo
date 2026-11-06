# V2 completion report (draft, pre-gate)

Tree: `main` @ `23948bd` (2026-11-06). Source: `docs/planning/fabric/07-master-plan-v1-v2.md` §3 Workstream C (M19–M25, M27; M26 is superseded by MOD, and its marketplace commerce stays V3) plus the extension milestones X01–X08 (`06-backend-packets/X0n-tasks.md`, owner directive 2026-11-02). There is one row per acceptance clause, split at ";". For M27, which has no "Acceptance:" clause, there is one row per "Builds" item. Each X milestone gets one row, keyed on its acceptance test file.

Evidence is a test file plus an `it(...)` name that exists on `main` (grep-verified, long names truncated with `...`), followed by the merge commit that brought the work to `main`. Everything was read from the tree, not executed. A gate run is using the database, so **no test or db command was run to produce this report**.

**Status key:** `met`: the acceptance text matches an existing migration, code and test, and a merge commit on `main`. `met-limited`: the acceptance is met, but with a named, documented limitation (an honesty label or a debt row). `pending`: not built, or built but not proven yet.

V1 (M1–M18, MOD) is not re-proved here; see `reports/v1-completion.md`. That covers M12–M18 (rows 12–18), which this pass therefore does not repeat.

## Gate run

Full gate on `main` after merging M20, M23, M24, M25 and M27 (2026-11-06, local Supabase, `--testTimeout=30000` for db):

| Step | Result |
|---|---|
| `pnpm db:reset` (migrations + full seed incl. `fabric`) | pass, seed 66 s; `PLAN-VI-A-ACTIVE` seeded |
| `pnpm lint` | 0 errors, 11 pre-existing warnings |
| `pnpm typecheck` | clean |
| `pnpm test` (unit) | 149 files / 2592 tests pass |
| `pnpm test:db` shards 1–3 | 597 + 556 + 587 tests pass (3 approvals-pending assertions re-scoped to tolerate seeded fabric insights, then 7/7) |
| `pnpm test:security` | 20 files / 3686 tests pass |

Fixes made during the gate: `compute_mastery` rewritten as one aggregation pass (`0104`, a nested-loop plan made a full-tenant compute run for minutes); mastery `planAuthor` falls back to principal (DBT-154); `insight_actions` write expectation includes 0093's intervention UPDATE (DBT-155).

## V2 acceptance criteria (07 §3 Workstream C)

| # | Milestone | Acceptance criterion (07 §3) | Status | Evidence |
|---|---|---|---|---|
| 1 | M19 | Unit tests per detector on synthetic series | met | `tests/unit/insights-detector-attendance.test.ts`: `it("section falling from 92% to 80% over 5 days fires a warning at confidence 0.95", ...)`. Also `insights-detector-academics`, `-office`, `-rooms` and `-timetable.test.ts` (marks, submissions, fees, concessions, room pressure, workload, room capacity). Merge `b9ce8c7` (feature `00bc802`, migration `0092`) |
| 2 | M19 | db test on seeded tenant produces ≥1 insight per domain | met-limited | A fixture tenant covers all 6 domains: `tests/db/insights-acceptance.test.ts`: `it("real runOnceCore detects every domain, a rerun is a no-op; principal reviews/dismisses over HTTP; ...", ...)`. On the seeded demo tenant, only 4 of the 6 M19 domains fire: `tests/db/seed-fabric.test.ts`: `fullOnly("fires attendance/staff/operations/admissions candidates, every one dated AS_OF", ...)`. Admissions was planted by M27-T1 (`e386449`). Academics shows only through M20 gap insights; `marks_decline` and `missing_work` are structural zeros. Finance is 0 (DBT-110). Merge `b9ce8c7`, `23948bd` |
| 3 | M19 | No per-student label text in prompts | met | `tests/db/insight-explain.test.ts`: `it("the captured prompt has no UUID, no fixture student name, and both nonce markers", ...)`. Also `tests/unit/attendance-insight-anonymization.test.ts`. Merge `b9ce8c7` |
| 4 | M19 | AI never changes `status` | met | `tests/db/insight-explain.test.ts`: `it("principal explains an open insight -> explanation + provider/model stored, status unchanged", ...)`. Merge `b9ce8c7` |
| 5 | M20 | Deterministic numbers on seed | met | `tests/db/seed-mastery.test.ts`: `it("calling compute_mastery again produces identical scores (determinism)", ...)`. `tests/db/mastery-acceptance.test.ts`: `it("Aarav Sharma's Mathematics unit-1 score = HY marks / max (3 dp), confidence 0.5 (deterministic on seed)", ...)`. Values are deterministic, but snapshot ids change on reset (DBT-133, M20 numbering). Merge `c4133d4` (feature `edbffd7`, migration `0093`) |
| 6 | M20 | Student sees own mastery only | met | `tests/db/mastery-rls.test.ts`: `it("student reads own rows only", ...)`. `tests/db/mastery-queries.test.ts`: `it("guardian asking for another family's student gets [] (RLS blocks the snapshot read)", ...)`. Merge `c4133d4` |
| 7 | M21 | A backtest row exists before a forecast is shown | met | A composite FK forces the backtest to exist. `tests/db/forecasts-acceptance.test.ts`: `it("enqueue_due_forecasts + runOnceCore -> forecast.run succeeded, every forecast has a backtest; ...", ...)`. Merge `4de8605` (feature `29232ce`, migration `0094`) |
| 8 | M21 | No per-student forecasts | met | `tests/db/forecast-run-job.test.ts`: `it("builds seasonal fee forecasts and moving-average attendance forecasts from seeded history; backtest ids match; no student reference in either table", ...)`. No `student_id` column exists. Merge `4de8605` |
| 9 | M22 | A finance agent run cannot call `exam.*` tools (unit test on tool list) | met | `tests/unit/agents-tools.test.ts`: `it("finance agent gets its own read and proposal tools and nothing from exams", ...)`. `tests/unit/agents-catalog.test.ts`: `it("finance has no tool or action starting with exam", ...)`. Merge `54d4c3a` (feature `008ae27`, migration `0095`) |
| 10 | M22 | An action classed `human_approved` stays `awaiting_approval` until approved | met | `tests/db/agents-decide-actions.test.ts`: `it("human_approved run: admin forbidden, principal approves -> done, announcement draft exists, decided_by principal", ...)`. `tests/db/agents-rls.test.ts`: `it("guard: running->done ok; done->running invalid_state; awaiting_approval->running without decided_by invalid_state", ...)`. Merge `54d4c3a` |
| 11 | M22 | Usage/cost visible on `/ai/usage` | met-limited | `tests/db/agents-acceptance.test.ts`: `it("module gate, run → awaiting_approval, approval gate, approve → done + reminder side effect, ...", ...)` (`agents.runs` and `ai.usageSummary` reflect the run). `tests/db/agents-queries.test.ts`: `it("3 runs (2 done, 1 failed) -> runs_30d 3, error_rate_pct 33; a 0.5 USD usage row on one run -> cost_paise_30d 4200", ...)`. Limitations: "Local AI only" (DBT-126, M22 numbering), so hosted runs fail `ai_unavailable`; cost uses a fixed ₹84/USD rate (DBT-127, M22). Merge `54d4c3a` |
| 12 | M23 | Engine unit tests for branches/approval gates | met | `tests/unit/workflows-engine.test.ts`: `test('approval pauses the run awaiting approval with the cursor on the approval node', ...)` and `test('resume rejected without a rejected edge finishes done and calls nothing after it', ...)`. Merge `77cb294` (feature `07e52a5`, migration `0096`) |
| 13 | M23 | Run history per workflow | met | `tests/db/workflows-queries.test.ts`: `it("filters by workflowId and status, and respects limit", ...)` (`workflows.runs`). Merge `77cb294` |
| 14 | M23 | Disabling stops the trigger | met | `tests/db/workflows-lifecycle.test.ts`: `it("a paused matching workflow is never swept", ...)`. `tests/db/workflows-acceptance.test.ts`: `it("principal saves+activates an event workflow; ... disabling stops new runs; ...", ...)`. Merge `77cb294` |
| 15 | M24 | Principal asks "classes with largest maths decline this term" → tool `mastery.declineBySection` called, answer cites it | met-limited | `mastery.declineBySection` is not built (DBT-98, M24 numbering): snapshots keep no history. The citation path is proven with `mastery.heatmapBySection` instead: `tests/db/assistant-acceptance.test.ts`: `it("principal: mastery question cites mastery.heatmapBySection in sources (tool-eligibility path, M20 not in this lane)", ...)`. Merge `4628ffc` (commits `b9ac3e1`, `fd2863d`; no migration) |
| 16 | M24 | Teacher cannot reach `finance.*` tools (db test under real RLS) | met | `tests/db/assistant-acceptance.test.ts`: `it("teacher: no finance_* tool is offered, a scripted finance_listDefaulters call leaks nothing, and the registered query is forbidden direct", ...)`. `tests/unit/assistant-tools.test.ts`: `it("teacher gets no finance read tool and no createTask", ...)`. Merge `4628ffc` |
| 17 | M25 | Briefing row links ≥3 queries | met | `tests/db/briefings-acceptance.test.ts`: `it("principal generate links >=3 real sources; owner shares the row; ...", ...)`. `tests/db/briefing-actions.test.ts`: `it("principal: generated_by rules, >=3 sources, one audit row (counts only, no item text); ...", ...)`. Briefs are generated lazily in-request, not by a nightly job (DBT-134). Merge `64a0eba` (feature `d151310`; no migration) |
| 18 | M25 | Suggestion never writes `timetable_slots` | met | `tests/db/timetable-suggest.test.ts`: `it("fills empty cells without touching timetable_slots, and every suggested slot saves cleanly via saveDraft", ...)`. Suggestions are returned as query output and not stored as `insight_actions` (DBT-141). Merge `d451bc4` (M25-T8 in `d7ae86d`) |
| 19 | M27 | Seed section `fabric` (insights, mastery, forecasts, agents, workflows, briefings) | met-limited | `tests/db/seed-fabric.test.ts`: `it("seeds RUN-ATT-DONE/RUN-COM-FAILED/RUN-ADM-REJECTED/RUN-FIN-APPROVAL with the table's ids, statuses and risk_class, an honest log/summary, and no 'Called' entry", ...)`, `fullOnly("PLAN-VI-A-ACTIVE: intervention plans proposed, exactly one active", ...)` and `it("demo:reset reproduces the same fingerprint and leaves fabric rows present", ...)`. Mastery and workflows come from their own sections (`seed-mastery`, `seed-workflows`). By design, no briefings and no `workflow_runs` are seeded. There is no fee forecast, because only 1 of the 4 needed terms exists (DBT-105). Seeded agent runs carry no model output. Merge `23948bd` (`e386449`, `07d58c2`, `066d771`) |
| 20 | M27 | RLS isolation generator extended to all new tables | met-limited | `tests/security/rls-generated.test.ts`: `it("every tenant table has RLS enabled", ...)`, `it("write: [] tables have no permissive write policy", ...)` and `it("cross-institution INSERT is rejected by RLS or a coded guard, for every table and role", ...)` (exception: `guardian_students`, DBT-45). `tests/security/rls-demo-deny.test.ts`: `it("every probed table outside EMPTY_IN_DEMO has demo rows", ...)`. Limitation: T4's entry-by-entry reconciliation against task-file rulings ran only for the 12 M12–M15 tables, on a lane without V2 merged. The 33 M19–M23/X tables are covered by the probes, but their rulings were not reconciled line by line. The deny probe skips `owner` and 24 `EMPTY_IN_DEMO` tables. Merge `23948bd` |
| 21 | M27 | Grants audit | met | `tests/security/grants.test.ts`: `it("authenticated may execute exactly the declared public invoker functions", ...)`, `it("service_role-only public functions are exactly SERVICE_ONLY", ...)` and `it("every user- or service-callable definer is named in 07 §4", ...)`. Merge `23948bd` |
| 22 | M27 | Perf test on big new tables (lesson 10) | met | `tests/db/fabric-perf.test.ts`: `it("every new table with >= 10,000 demo rows has a PERF_MATRIX entry", ...)` plus a `each probe's median < 1500 ms — <label>` test per probe. Merge `23948bd` |
| 23 | M27 | `reports/v2-completion.md` with evidence per criterion; tracker statuses; `DONE V2 <sha>` | met-limited | This document, the tracker edit below, and the green gate in "Gate run". Limited: hosted needs the owner's push of `0093`/`0096`/`0104` and a hosted demo reset before the fabric demo data shows |

## Extensions X01–X08 (one line each; status follows the `03-feature-matrix.md` label)

| # | Milestone | Acceptance test | Status | Evidence |
|---|---|---|---|---|
| 24 | X01 student leave + diary (`0085`) | `tests/db/x01-acceptance.test.ts` | met | `it("guardian requests leave for own child (other child -> 403, overlap -> 409); wrong-section teacher ...", ...)`. Matrix F-ATT-06 / F-COM-07 "impl (API; UI in Workstream D)". Merge `35b50a4` (feature `6adeddf`) |
| 25 | X02 certificates + ID cards (`0091`) | `tests/db/certificates-acceptance.test.ts` | met-limited | `it("admissions issues bonafide certificates with gap-free serials, prints HTML with CSP img-src data:, ...", ...)`. F-STU-12 "limited (API + HTML print; no logo, no digital signature, English only)", DBT-97. Merge `e03f385` (feature `4dde5f6`) |
| 26 | X03 library (`0086`) | `tests/db/library-acceptance.test.ts` | met-limited | `it("issue/conflict/forbidden, overdue + myLoans scoping, return charges the fine to the invoice, double-return 404, module disabled -> forbidden", ...)`. F-SVC-01 "limited"; DBT-89/90 (X03 numbering): no fine cap, no holds. Merge `b11fc1c` (feature `54ca844`) |
| 27 | X04 late fees, instalments, Tally export (`0087`) | `tests/db/fee-plans-acceptance.test.ts` | met-limited | `it("accountant sets a late-fee rule (admin forbidden), sets an instalment plan (sum mismatch rejected), ...", ...)`. F-FIN-10 "limited"; the Tally layout is not validated against live Tally (DBT-93, X04 numbering). Merge `d451bc4` (feature `d7ae86d`) |
| 28 | X05 WhatsApp channel (`0089`) | `tests/db/whatsapp-acceptance.test.ts` | met-limited | `it("guardian B opts out, guardian A gets a real MSG91 send, module off blocks preference + fan-out, module back on + no key simulates", ...)`. F-COM-04 "sim": simulated until `MSG91_AUTH_KEY` and `MSG91_WA_NUMBER` are set; DBT-91..96 (X05 numbering). Merge `b11fc1c` (feature `54ca844`) |
| 29 | X06 exam seating + admit cards (`0088`) | `tests/db/exam-seating-acceptance.test.ts` | met-limited | `it("exam_controller generates a two-grade slot into 2 rooms, too-few-seats conflicts, slots query shows the plan, ...", ...)`. F-EXM-12 "limited (API + HTML print; no UI; module exam_seating, default off)". Merge `e03f385` (feature `4dde5f6`) |
| 30 | X07 visitors, gate pass, pickup (`0090`) | `tests/db/visitors-acceptance.test.ts` | met-limited | `it("admin checks a visitor in/out; guardian pickup scoping; class teacher -> gate pass -> approve -> ...", ...)`. F-SVC-06 "limited" (module default off). Merge `4de8605` (feature `29232ce`) |
| 31 | X08 PTM booking + surveys (`0099`) | `tests/db/ptm-acceptance.test.ts` | met-limited | `it("admin publishes a 2-section PTM event -> teacher adds slots -> guardians book/conflict/cancel over HTTP; ...", ...)`. F-COM-06 "limited": no reminders, aggregate results only, anonymous results below 3 responses suppressed; DBT-115..119. Merge `35b50a4` (feature `6adeddf`) |

**Count: 18 met, 13 met-limited, 0 pending.**

## Security suite and perf (lane-report figures; re-verify in the gate)

- **C-01** (`rls-generated.test.ts`): every discovered tenant table, with 119 expectation entries; 117 are probed (`profiles` and `institutions` are excluded). One `insertProbeException`: `guardian_students` → DBT-45.
- **C-05** (`rls-demo-deny.test.ts`): 117 tables × 8 demo logins + `anon`. 24 tables are in `EMPTY_IN_DEMO`; the other 93 must be non-empty (the non-vacuous count). The M27-T5 report: 444/444.
- **C-06** (`grants.test.ts`): `PUBLIC_INVOKER_AUTHENTICATED` 11 names, `SERVICE_ONLY` 27 names. The M27-T6 report: 12/12.
- **C-07** (`fabric-perf.test.ts`): 45 `NEW_TABLES`. Only `mastery_snapshots` is big (44,164 demo rows). Medians: `count(*)` 12.7–22.0 ms; `mastery.heatmapBySection` 123.4 ms (principal) and 34.5 ms (teacher); `mastery.studentSuccessRows` 64.0 ms; `mastery.gapsForStudent` 17.8 ms and 14.1 ms. Budget: 1500 ms. The M27-T7 report: 10/10, run without a fresh `db:reset`.

## Post-gate changes (2026-11-06)

- Five Fabric workspaces ship with real data (no fixtures): Student success (F-UI-04, `/fabric/students`), What-if simulator (F-UI-08, migration `0106` + `simulation_scenarios` table), Digital twin (F-UI-09), Marketplace (F-UI-11, real module catalog + `setModuleEnabled` action), Custom Studio (F-UI-12, migration `0107` + `studio_requests` table, AI proposal via `agentCloud`).
- Dashboard/Today now render real insights/priorities/risks/forecasts on demo tenant; portal sample family insights removed.
- AI: gateway features opt into Groq/Gemini via `runStructured` agentCloud (D28 amendment); student study chat remains local-only (D32).
- Migrations `0104` (compute_mastery single-pass aggregation) and `0105` (PTM guardian guard fix) applied to hosted; demo-login is a plain form POST to `/api/public/demo-login`; PWA no longer reloads on first service-worker install.

## Honesty labels (UI badges land in Workstream D; docs carry them now)

- Insights (M19): real detections, so no badge. The explanation is an AI draft and shows a provider badge. Matrix F-INT-00: "limited (v1 rules)".
- Mastery (M20): `<LimitedBadge>` "Estimated from exam papers and graded work". Marks are spread evenly over units, there are no per-question marks and no recency weighting (DBT-125/126, M20 numbering).
- Forecasts (M21): `<LimitedBadge>` "baseline model, backtested MAPE shown" (DBT-104, M21 numbering).
- Agents (M22): `<LimitedBadge>` "Local AI only" (DBT-126, M22).
- Workflows (M23): `<LimitedBadge>` "Low-risk automation: in-app alerts, reports, queued agent tasks; family reminders need approval".
- Assistant (M24): a provider badge plus "AI answer — sources listed"; in cloud mode, `<LimitedBadge>` "Summaries only" (aggregate tools only). The hosted demo answers `ai_unavailable` (DBT-99, M24 numbering).
- Briefings (M25): `ProviderBadge` plus "AI-written summary" on the headline. Timetable suggestions: `<LimitedBadge>` "Rule-based — review before saving".
- X01–X08: per the matrix labels in rows 24–31.

## Deploy state

- **Hosted Supabase:** every migration up to `0101` is applied, **except `0093` (M20 mastery), `0096` (M23 workflows) and `0104` (compute_mastery single pass)**. Those two are merged to `main` but wait for the owner's push: `pnpm exec supabase db push --linked --include-all`. Until then, mastery (M20), workflow automation (M23) and anything that reads them are verified locally only, not live on the hosted tenant. This includes the assistant's mastery tools, M25 briefing sources over mastery, and M27's seeded intervention plan.
- **M27 has no migration** (`0097` and `0098` were released). The hosted demo shows the `fabric` seed only after an owner-run `DEMO_RESET_ALLOWED=true pnpm demo:reset` against hosted, and that is not recorded as done. A runner tick replaces the seeded forecasts with live-date forecasts. From about 2026-11-23, the fixed attendance window is too old, and the demo attendance forecasts disappear (same root cause as DBT-84).
- `0100` and `0101` (platform leads, marketing slugs) belong to the UI session, not V2.

## Tracker changes (`03-roadmap-and-tracker.md`, Status column only)

| Row | Old → new | Delivered by (rows above) | Why `limited` |
|---|---|---|---|
| FB-CORE-04 | planned → limited | M23 (12–14) | Low-risk automation badge; `workflows` has no school-specific columns |
| FB-AI-04 | planned → limited | M24 (15–16) | Cloud mode "Summaries only"; no conversation persistence; hosted demo `ai_unavailable` (DBT-99, M24) |
| FB-AI-05 | planned → limited | M24 (15–16), M22 (9–11) | Tool calls are permission-checked; the assistant hands off only as a draft task (`createTask`), not to an agent or workflow |
| FB-EDU-10 | planned → limited | M20 (5–6) | "Estimated from exam papers and graded work" |

**Not changed:**
- FB-INT-07 is already `limited` (M23).
- Rows still `simulated` stay `simulated` even where V2 built their backend: FB-INT-01..04/06 (M19, M21), FB-AGT-01..04 and FB-WS-09 (M22, M23), FB-WS-06/15/16 (M19, M25), FB-CORE-05 and FB-TRUST-01 (M27). Their UI still renders fixtures until Workstream D (rule 7).
- FB-EDU-12/13/14/15 are V1-delivered, and the X modules only extend them. FB-EDU-14 also needs inventory, hostel and canteen (F-SVC-03/04 planned).

## Open debt touching V2 (`12-decision-log.md` §3)

The lanes reused DBT numbers. DBT-86..104 and DBT-125..130 each appear twice, so every cite above names its milestone.

- M19: DBT-106..114. M20: DBT-125..133 (M20 rows), DBT-153. M21: DBT-98..105 (M21 rows). M22: DBT-125..130 (M22 rows). M23: DBT-145..152. M24: DBT-98..104 (M24 rows). M25: DBT-134..144.
- X01: DBT-120..124. X02: DBT-97. X03: DBT-89/90 (X03 rows). X04: DBT-86..94 (X04 rows). X05: DBT-91..96 (X05 rows). X08: DBT-115..119. X06 and X07 have no §3 row.
- M27: DBT-154 and DBT-155 are both resolved 2026-11-06 (`23948bd`, `066d771`). The debt rows that M27-T8 should have added are **not in §3**:
  - seeded agent runs carry no model output;
  - briefings and `workflow_runs` are not seeded;
  - seeded forecasts are replaced by the first runner tick and go stale around 2026-11-23;
  - the deny probe skips `owner` and the `EMPTY_IN_DEMO` tables;
  - the `insertProbeException` DBT-45.

## Not covered by this pass

- No test, db or seed command was run. Every status is evidence of existence (test name, migration, merge commit) read from the tree. The counts belong in **Gate run**.
- M26 (marketplace commerce) and the §0 out-of-scope items (simulator, twin, studio, personal AI, connectors, layouts) are unchanged; they remain V3.
- `03-feature-matrix.md` has no mastery (M20) row. This pass did not add one; it is docs-only for this file and the tracker.
