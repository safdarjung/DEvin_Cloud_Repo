# 08 — Testing and acceptance

One stack: Vitest (unit + DB integration), Playwright (E2E), ESLint, `tsc`. No pgTAP (D17). GitHub Actions runs everything on every push to `main` and on PRs, booting local Supabase with `supabase/setup-cli@v3`.

## 1. Pyramid and commands

| Layer | Location | Command | Runs against | Target |
|---|---|---|---|---|
| Unit | `tests/unit/**` | `pnpm test` | Pure TS, mocked providers | Calculations, state machines, permission matrix, AI routing/quota policy, Zod schemas, redactor, number patterns |
| DB integration | `tests/db/**` | `pnpm test:db` | Local Supabase, per-role JWT clients | Constraints, RLS, SQL functions, triggers, idempotency |
| Security | `tests/security/**` | `pnpm test:security` | Local Supabase + action registry | `07 §6` checklist |
| E2E | `e2e/**` | `pnpm test:e2e` | `pnpm dev` + seeded demo tenant | The 13 demo steps |
| Static | — | `pnpm lint && pnpm typecheck && pnpm build` | — | Zero errors |

Vitest uses `test.projects`: `unit` (environment `node`), `db` and `security` (environment `node`, `globalSetup` ensures Supabase is up and the test institution fixtures exist). Async server components are covered by E2E, not unit tests.

### Test helpers (`tests/helpers/`)

- `roles.ts`: `createTestInstitution(name)` → institution + users for every role via the admin API → `clientAs(role)` returning a `supabase-js` client authenticated as that user (real JWT, real RLS); `clientAs('anon')` returns the publishable-key client for class P tests. Two institutions (`A`, `B`) per file for cross-tenant tests. Cleanup via `app.demo_reset` on the fixture institutions (created with `is_demo = true`).
- `actions.ts`: `callAs(role, action, input)` invoking server actions with a mocked cookie session for that user.
- `factories.ts`: deterministic builders for students, guardians, sections, invoices, exams.

## 2. Unit targets

| Area | Cases |
|---|---|
| Permission matrix | Snapshot vs `07 §2`; every `Permission` string referenced in code exists in the matrix |
| Result envelope | SQL `code:` mapping; unknown error → `internal` with correlation id |
| Number patterns | `{FY}`, `{YYYY}`, `{SEQ:n}` rendering; FY boundaries (31 Mar / 1 Apr) |
| Grading | `grade_for` mirror in TS for UI; boundaries 32.99/33/40/41/90.99/91/100 |
| Finance math | Proration of monthly/quarterly components into terms; concession percent vs amount; rounding to paise |
| Attendance | Percentage with `counts_present` fractions and `in_denominator` flags; threshold alerts |
| State machines | Admissions, exams, recheck, jobs: every allowed and forbidden transition |
| AI policy | Plan resolution for 3 policies × key present/absent × switch on/off; quota and rate math; redactor patterns (phone, email, 12-digit, name list) |
| Zod schemas | Each action schema accepts the happy path and rejects unknown keys and bad types; `QuizSchema` invariants |

## 3. DB-integration targets (high-risk cases)

| ID | Case |
|---|---|
| C-05 | One `is_current` academic year per institution; term dates inside year |
| C-06 | `next_sequence`: 50 concurrent calls → 50 distinct consecutive values; pattern rendered |
| C-07 | `audit_events` UPDATE/DELETE raise |
| C-10..C-14 | BOLA on students, guardians, invoices, results, attendance (see `07 §6`) |
| C-13 | Enrolment uniqueness per year; roll number uniqueness per section; status history written |
| C-15 | Attendance correction writes correction row, updates record, audits; outside window as teacher → forbidden |
| C-16 | Teacher of section A cannot mark section B (RLS **T**) |
| C-20 | `enrol_applicant` idempotent; returns same student on retry |
| C-21 | Guardian matched by phone, not duplicated |
| C-22 | Section at capacity → `conflict` |
| C-23 | Enrol from non-`accepted` state → `invalid_state` |
| C-30 | Notification visible only to recipient |
| C-31 | Simulated delivery stored with `status = 'simulated'` and rendered body |
| C-40 | Publish blocked while marks are missing |
| C-41 | Snapshot totals = Σ current marks; exactly one result per enrolled student; publish twice → `invalid_state` |
| C-42 | Approve recheck → marks v2, results v2, v1 intact, request `applied`, audit + job present |
| C-43 | Marks UPDATE raises; two current versions impossible; marks > max rejected |
| C-50 | Fee structure/assignment uniqueness; teacher cannot read finance tables |
| C-51 | `generate_invoice` idempotent per (student, term); line sums equal totals |
| C-52 | `record_payment` idempotent by key; overpayment rejected; payments immutable; receipts gap-free per FY |
| C-53 | Ledger balanced per payment and per invoice |
| C-54 | Guardian reads only own children's invoices/receipts |
| C-70 | `claim_job` with SKIP LOCKED: two workers never claim the same job |
| C-71 | Failure → requeue with backoff; `max_attempts` → `dead` |
| C-72 | Duplicate idempotency key → single job |
| C-80..C-83 | Website public/private separation; enquiry rate limit, dedupe, honeypot |
| C-04 | Demo reset guards and completeness (lives in `tests/security`, listed in `07 §6`) |

## 4. E2E journeys (Playwright, seeded tenant)

| ID | Journey | Assertions |
|---|---|---|
| J-00 | Login as each demo role; nav matches permissions; `demo:reset` smoke | Pages render, no console errors |
| J-01 | Visit `/s/st-josephs-demo`; pages, notices, events; draft text absent | Published content only |
| J-02 | Submit enquiry; reference shown; second submit → duplicate message | Row in enquiries |
| J-03 | Admissions moves enquiry through stages; converts to application | Status trail |
| J-04 | Decision offer → accept | Decisions listed |
| J-05 | Enrol `APP-live-1` (new guardian) and `APP-live-2` (existing guardian `9800000002`): pick section + fee structure → admission numbers; student profile shows guardian, section, Term 2 invoice; `guardian.two` now has two children | Idempotent on re-click |
| J-06 | `teacher.vi-a` marks today's VI-A session with Aarav Sharma and one other student absent; submit; message log shows 2 simulated SMS | `guardian.one` sees the absence notification |
| J-07 | Accountant records a cash payment on `INV-T2-Aarav`; `guardian.one` logs in; sees two children; attendance, invoice now paid, receipt (print view), results | Scope correct; receipt number gap-free |
| J-08 | Teacher opens unit → Generate quiz (local) → edits a question → saves draft → publishes | Guardian sees assignment |
| J-09 | Exam controller (or `teacher.x-a`) enters X-A Mathematics marks for `PT2-X`; verification lists the missing paper before, clean after | — |
| J-10 | Publish `PT2-X`; `guardian.one` sees Ananya's report card with grades | Snapshot; 252 results |
| J-11 | `guardian.one` requests a recheck on Ananya's `PT2-X` Mathematics result | Request visible to controller |
| J-12 | Controller approves with new marks; guardian sees corrected result and "Corrected on" note; history visible to controller | v1 preserved |
| J-13 | Principal dashboard shows attendance %, collections, funnel, grade distribution; numbers match seed assertions | Charts render |

Each journey is one spec file; the full narrative spec `e2e/demo-narrative.spec.ts` chains J-01→J-13 after `pnpm demo:reset`.

## 5. Nonfunctional checks

| Check | How | When |
|---|---|---|
| Lint, type, build | CI | Every push |
| Accessibility smoke | `@axe-core/playwright` on login, dashboard, attendance, guardian portal, public home: no serious/critical violations | Day 14, 17 |
| Responsive smoke | Playwright at 390×844 and 1280×800 for the same five pages | Day 14, 17 |
| Demo reset | `pnpm demo:reset` then J-00 | Day 16, 19 |
| Backup/restore | `11-operations.md` §6 procedure executed once against hosted project | Day 18 |
| Load scenarios | §6 | Day 15, 17 |

## 6. Load-test scenarios (measured, never asserted in advance)

Tool: `autocannon` via `pnpm dlx` for HTTP, SQL timing for bulk jobs. Environment stated in every result (local laptop vs Vercel + hosted Supabase). Results saved to `docs/planning/coolskool/results/load-<day>.md`.

| Scenario | Assumptions | Measure |
|---|---|---|
| L1 Attendance burst | 72 class teachers submit between 07:45 and 08:00; each submit = 1 action with ≈42 records; 10 concurrent | p50/p95 action latency, errors, DB CPU |
| L2 Result-day guardian load | 3,000 guardians open the portal within 30 min after publish; ≈1.7 rps average, modelled peak 10 rps for 5 min | p95 TTFB of `/[institution]/portal`, error rate |
| L3 Bulk invoice generation | One job generating 3,024 Term 2 invoices | Wall time, rows/s, lock waits |
| L4 Public site | 50 rps on `/s/st-josephs-demo` for 2 min | p95, cache behaviour |
| L5 AI concurrency | 4 and 8 parallel quiz requests on the laptop | From `pnpm ai:bench` |

## 7. Gates

**Task done (every packet):** acceptance criteria met · packet tests green with actual output in the completion report · lint/typecheck clean on touched files · integrated on seeded data · review done where required (`CLAUDE.md`) · honesty label correct.

**Checkpoint (Days 4, 9, 13, 16, 18):** full `pnpm test && pnpm test:db && pnpm test:security` green · `pnpm build` green · `pnpm demo:reset` succeeds · E2E journeys available so far green · no open CRITICAL/HIGH review findings.

**Demo ready (G-2, Day 19):** all 13 journeys green on the hosted deployment · security suite green on hosted · load results L1–L4 recorded (no regressions vs Day 15 beyond 20%) · backup/restore executed once · rehearsal script run twice end-to-end from a reset state in under 25 minutes · every "simulated"/"limited" label present in the UI · known limitations list in `11-operations.md` §9 up to date.

## 8. Known limitations accepted for the demo

AI quality depends on a 4B local model; SMS/email simulated; student portal has no dedicated UI; no payment void/refund; no CSV import; concurrency caps are per process; accessibility is smoke-tested only; load numbers are from one laptop and one Vercel region.

## 9. Test data map (journeys → named demo entities in `05 §8.1`)

| Journey | Logs in as | Uses | Leaves behind (reset clears) |
|---|---|---|---|
| J-02 | visitor | slug `st-josephs-demo` | one `enquiries` row (website) |
| J-03/J-04 | admissions | the J-02 enquiry, or `ENQ-*` in `new` | status trail, one application |
| J-05 | admissions | `APP-live-1`, `APP-live-2`, sections I-C and VI-B, grade fee structures | two students, one new guardian, two invoices |
| J-06 | teacher.vi-a | `VI-A`, Aarav Sharma | today's session, 2 jobs, 2 notifications, 2 simulated SMS |
| J-07 | accountant, guardian.one | `INV-T2-Aarav` | one payment, one receipt, ledger rows |
| J-08 | teacher.x-a | `UNIT-X-MATH-3`, section `X-A` | one `ai_usage_events` row, one assignment |
| J-09/J-10 | examcontroller | `PT2-X`, paper X-A Mathematics | 42 marks rows, 252 results, 252 jobs |
| J-11/J-12 | guardian.one, examcontroller | Ananya's `PT2-X` result | request, decision, marks v2, result v2 |
| J-13 | principal | everything above | — |

## 10. CI workflow (`.github/workflows/ci.yml`)

| Job | Steps | Budget |
|---|---|---|
| `static` | checkout → pnpm install (cache) → `pnpm lint` → `pnpm typecheck` → `pnpm build` | < 6 min |
| `unit` | `pnpm test` | < 2 min |
| `db` | `supabase/setup-cli@v3` → `supabase start` → `pnpm db:reset` (migrations + seed) → `pnpm test:db` → `pnpm test:security` | < 15 min (seed dominates; CI may use `SEED_SCALE=small` = 2 sections per grade, documented in `scripts/seed/config.ts`) |
| `secrets` | gitleaks | < 1 min |
| `e2e` (nightly, manual) | start Supabase, seed, `pnpm build && pnpm start`, `pnpm test:e2e` | < 25 min |

`SEED_SCALE=small` is for CI only; every checkpoint runs the full seed locally.
