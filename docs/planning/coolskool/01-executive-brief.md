# 01 — Executive brief

## 1. Objective

Ship, in 20 days, a sound foundation plus a demo that a non-technical principal of a Tier 2/3 Indian private school understands by watching it: a public school website takes an enquiry, admissions converts it into an enrolled student with a guardian and fees, a teacher marks attendance, the guardian sees it, a teacher generates an AI quiz, exams are marked and published, a recheck corrects a result traceably, and the principal sees it all on one dashboard. Everything runs on a seeded, resettable demo tenant with synthetic people.

## 2. The demo scenario (13 steps)

| # | Step | Actor | Status label |
|---|---|---|---|
| 1 | Public website of "St. Joseph's Convent School (Demo)" | Visitor | Fully implemented (data-driven pages, published versions only) |
| 2 | Visitor submits an admission enquiry | Visitor | Fully implemented (rate limited, deduplicated) |
| 3 | Admissions officer works the enquiry pipeline | Admissions | Fully implemented |
| 4 | Application accepted | Admissions / Principal | Fully implemented |
| 5 | Enrolment: student + guardian + section + fee assignment + first invoice in one transaction | Admissions | Fully implemented and tested (idempotent) |
| 6 | Teacher marks attendance; absence triggers guardian notification | Teacher | Fully implemented; SMS channel **simulated** (labeled) |
| 7 | Guardian portal: attendance, fees, results, assignments | Guardian | Fully implemented |
| 8 | Assignment + AI quiz generated from a curriculum unit, teacher reviews before saving | Teacher | Functional but limited (local model on laptop GPU; cloud optional) |
| 9 | Marks entry with arithmetic verification | Teacher / Exam controller | Fully implemented |
| 10 | Publish results (immutable snapshot), report card view | Exam controller | Fully implemented and tested |
| 11 | Guardian requests a recheck | Guardian | Fully implemented |
| 12 | Recheck decision → new marks version → re-snapshot → notification | Exam controller | Fully implemented and tested |
| 13 | Principal dashboard (attendance, fees, admissions, exams) | Principal | Fully implemented (Recharts on live queries) |

Payment recording (cash/UPI/bank reference) with sequential receipts is shown inside step 7/13 as fully implemented; no gateway.

## 3. Baseline

See `02-environment-baseline.md`. Greenfield repo, one laptop, no API keys, no hosted Supabase project. Local Supabase and local Ollama are the development paths; Vercel + hosted Supabase (Mumbai) is the demo hosting path.

## 4. The 20-day slice

Foundation (scaffold, schema, RLS, auth, tenant layout, permissions, test harness, seed) by Day 6; four parallel lanes Days 5–13 (academics/attendance/exams; website/admissions; finance; AI/notifications/dashboard); integration Day 14–16; security Day 17; deploy Day 18; rehearsal Day 19; buffer Day 20. Details: `09-twenty-day-plan.md`. Backlog DAG: `10-backlog-index.md`.

## 5. Key decisions (authoritative text in `12-decision-log.md`)

- Modular monolith in one Next.js App Router app; Supabase Postgres with SQL migrations and RLS; no ORM, no queue, no microservices (D1–D4, D10).
- Two-layer authorization: RLS via `security definer` helpers on a `memberships` table, plus `requirePermission` in every server action with a single TypeScript permission matrix (D4, D6).
- Path-based tenant routing; public site at `/s/[slug]` (D5).
- Immutable finance and exam history with versioned corrections and append-only audit (D13, D14, D20).
- AI through one gateway enforcing per-institution policy (`local_only | cloud_allowed | local_with_cloud_fallback`), quotas, redaction, and usage logging; local Ollama is the always-available path (D9).
- Deterministic seed and guarded demo reset (D19).

## 6. Risks (top five; full register in `09-twenty-day-plan.md` §6 and `07-security-and-ai-governance.md`)

1. **Foundation slips** (schema + RLS + harness) delay every lane. Mitigation: checkpoint Day 4; lanes start on migrations only until seed lands Day 6.
2. **Local model JSON reliability** on a 6 GB GPU. Mitigation: Zod validation + one repair retry; synchronous `generateObject` fallback; honest "limited" label.
3. **Seed volume** (≈3,000 students, ≈180k attendance rows) slows `db:reset`. Mitigation: bulk inserts, attendance limited to 60 days, seed sections per lane.
4. **Cross-tenant or guardian-scope leak.** Mitigation: generated RLS suite over every tenant table on Day 17 and at every checkpoint.
5. **Shared-file conflicts** (migrations, permission matrix, nav, seed). Mitigation: reserved migration numbers, one owner per file, seed sections per lane.

## 7. Roadmap (five phases; dependency map in `03-feature-matrix.md` §2)

1. **Foundation** (this demo): tenancy, identity, people, academics, attendance, admissions, finance basics, exams with rechecking, website, AI gateway, notifications, dashboard.
2. **Complete operations:** self-service onboarding, CSV import, staff/payroll, library/transport/inventory, timetable, communication at scale, real SMS/email/payment gateways, scanned scripts with per-question marking.
3. **Intelligence and optimization:** School Intelligence Center, early-warning analytics, timetable optimization, AI tutoring, OCR-assisted marking.
4. **Marketplace and ecosystem:** modules, plans, entitlements, usage metering, partner integrations, visual website editor.
5. **Institution intelligence and controlled autonomy:** institution-controlled hosting with measured sizing, configurable workflows, policy-bounded agents.

## 8. Non-goals for the demo

Self-service signup, payroll, library/transport/inventory, timetable solver, marketplace/billing, visual website editor, OCR, payment gateway, multi-campus UI, social network, hardware sizing recommendations, on-prem deployment tooling, real SMS/email delivery.

## 9. What is real versus simulated

Real: all data flows, RLS, audit, immutability, enrolment transaction, finance ledger, exam snapshots and rechecks, in-app notifications, local AI inference. Simulated and labeled: SMS and email delivery (rendered into a visible message log). Limited: AI quality on the laptop GPU, student portal (role exists, no dedicated UI), platform superadmin (seed/reset only).
