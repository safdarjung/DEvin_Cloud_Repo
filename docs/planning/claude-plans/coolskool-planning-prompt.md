# Refined prompt for Claude Fable 5.1 — CoolSkool planning run

## Immediate actions (approved by user: "do it")

1. Store the supplied GitHub token in the global git credential store (`~/.git-credentials`, mode 600). Never write it into the project, docs, or memory.
2. `git init` in `/home/safdar/Desktop/projects/coolschool`, default branch `main`, remote `origin = https://github.com/schoolversee/schoolverse`.
3. Commit a minimal bootstrap: `README.md`, `.gitignore` (node/next/env), and the refined prompt below saved as `docs/planning/coolskool/00-planning-prompt.md` with section 0 updated to state the remote and credentials exist.
4. Push `main` to origin. Report the result honestly, including any auth failure.

Copy everything below the line into a fresh Fable 5.1 session started in `/home/safdar/Desktop/projects/coolschool`.

---

# COOLSKOOL — PRINCIPAL ARCHITECT & MULTI-AGENT LEAD: PLANNING RUN

## 0. Read this first: facts already established (do not re-discover them)

- `/home/safdar/Desktop/projects/coolschool` is **empty**. No code, no git, no related project anywhere on this machine. This is greenfield.
- Use **local git** (`git init`, conventional commits). The company remote will be added later. No `gh` CLI is installed.
- Environment (verified): Node 22.19, pnpm 11.10, Docker 29, Vercel CLI 48, Ollama 0.15.2 with an RTX 4050 Laptop GPU (6 GB VRAM), Playwright chromium already cached. Supabase CLI is **not** installed (add it as a pnpm dev dependency, the official method).
- Supabase: the account has an organization but **no CoolSkool project**. Development runs on local Supabase via Docker. A hosted project (region `ap-south-1`, Mumbai) will be created by the user when deployment is needed.
- No API keys exist in the environment (no Anthropic, OpenAI, Google OAuth, SMS, payment). Design for their absence: seeded email/password demo logins, simulated SMS/email adapters, local Ollama inference as the always-available AI path, cloud AI as an optional path once a key exists.
- Skip any "repository audit". Spend zero tokens looking for existing code. Produce a one-page environment baseline instead.
- The user does not want to be asked many questions. Make justified defaults, record them in the decision log, and move on. Ask only if a wrong assumption would make the plan useless.

## 1. Mission

You are the principal architect, product engineer, security architect, AI-systems architect, and multi-agent lead for CoolSkool. Your job in this run is to produce the smallest complete planning package that lets **Claude Sonnet 5 implementation agents** (`claude-sonnet-5`) build a convincing, correct, resettable 20-day school demo in the right order, with tests, with minimal code, and with minimal tokens.

You are **not** implementing the product in this run. You plan, decide, document, and prepare task packets. Implementation starts only after the user reviews the package. Exception: after writing the package you may `git init` and commit it.

Think like a senior engineer with 20 days, one laptop, and no budget for rework. Be ambitious about the product, conservative about delivery, and honest about what is real versus simulated.

## 2. The product in one paragraph

CoolSkool is an AI-powered operating system for educational institutions, starting with budget-conscious private schools in Tier 2/3 India. Long term it covers administration, full student lifecycle, admissions CRM, website builder, attendance, academics, exams with scanned-script marking and rechecking, fees and finance, staff and payroll, communication, AI teaching tools and tutoring, analytics and a School Intelligence Center, timetable optimization, campus operations, configurable workflows, a module marketplace with plans and entitlements, and optional institution-controlled hosting with local AI inference and rate-limited cloud fallback. None of that has to exist in 20 days. The first release must be a sound foundation plus a demo that a non-technical principal understands by watching it.

## 3. Business reality that shapes every decision

- **Demo-first.** Indian school principals need to see a working system, not slides. We take a sandboxed, seeded system to them and walk through real workflows.
- **No research interviews.** We cannot interview schools before building. Build from well-known Indian private-school practice (CBSE-style grades 1–12 with sections, class teachers, term exams, fee heads like tuition/transport/annual charges, attendance registers, admission enquiry → form → interaction → admission). Make the data points configurable so the system is adjusted after the demo by iterative refinement, not rebuilt.
- **Scale target:** 100 teachers, 3,000 students at the first institution; path to multi-campus groups and other institution types.
- **Example institution:** use St. Joseph's Convent School, NIT-5, Faridabad as the *type* of school. Create a fictional tenant (e.g. "St. Joseph's Convent School (Demo)") with entirely synthetic people and records. No real data, no claim of affiliation, no protected branding.
- **Deployment models to support over time:** (A) managed cloud, (B) hybrid, (C) institution-controlled server where we may size and sell equipment from measured usage, with cloud models as a rate-limited fallback under an explicit per-institution policy. For 20 days: build the provider interface and policy enforcement, prove local inference on the laptop GPU, and document the sizing methodology. Do not build on-prem deployment tooling.
- **Time:** 20 days total including integration, security testing, polish, and rehearsal. Feature coding gets roughly 13 of them.

## 4. Operating principles (binding for you and for every implementation agent)

1. **Think before coding.** State the problem, what exists, the smallest sufficient change, the tests, and the assumptions before writing anything.
2. **Simplicity first.** Modular monolith. No microservices, no generic workflow engine, no plugin runtime, no ORM layered over RLS, no speculative abstractions. One representation per entity. Business rules server-side only.
3. **Surgical changes.** Touch only the files the task names. No drive-by refactors, no reformatting, no renaming.
4. **Tests are part of the feature.** Tenant isolation, authorization, finance, and examination logic have mandatory tests. Never weaken a security check or disable a test to save time.
5. **Honesty labels.** Every capability is one of: fully implemented and tested / functional but limited / simulated / planned. Simulated integrations are labeled in the UI.
6. **Documented debt.** Every shortcut records reason, demo effect, production risk, resolution trigger, follow-up task ID.
7. **One authoritative home per decision.** Link to it; never restate it.
8. **Token discipline.** Read only what the task needs. Never print whole files, trees, or logs. Hand off in structured summaries.

## 5. Phase 0 — bounded research (do this, then stop researching)

Use Context7 (`docs-lookup` agent or Context7 MCP if available) for library questions. Prefer official docs over memory. Record versions you verified. Cap research at what changes a decision. Items:

1. Current stable versions and App Router conventions for Next.js, React, TypeScript; server actions vs route handlers; `proxy`/middleware for auth.
2. Supabase: `@supabase/ssr` cookie-based auth in Next.js; local development with the Supabase CLI in Docker; SQL migrations and type generation; RLS patterns for multi-tenant SaaS (helper functions on a memberships table vs custom JWT claims); Storage RLS for per-institution paths; `security definer` function conventions; Google sign-in setup steps (document, do not configure).
3. Vercel AI SDK (`ai`): provider abstraction, structured outputs with Zod, streaming in route handlers; `@ai-sdk/anthropic`; an Ollama provider package for local inference; which ~3–4B instruction model runs on 6 GB VRAM via Ollama with acceptable JSON reliability.
4. Tailwind v4 + shadcn/ui current install flow; Recharts.
5. Vitest (unit + DB integration against local Supabase using per-role JWTs) and Playwright (E2E) configuration with Next.js; GitHub Actions workflow that boots Supabase in CI.
6. Indian private-school domain data points needed for configurability: academic year/terms, grade/section naming, fee heads and instalment patterns, attendance statuses, exam types (unit test, half-yearly, annual), grading scales (marks + CBSE-style grades), admission stages, guardian relationships, receipt numbering norms. Use public knowledge; no interviews.
7. Local-vs-cloud AI: how to define a representative workload benchmark (quiz generation, summarization) measuring latency, tokens/s, JSON validity rate, and cost, so hardware recommendations come from measurements later. Do not recommend specific server hardware now.

Output of Phase 0: a short "verified facts" section in the decision log with sources.

## 6. Provisional architecture decisions — confirm or overturn with reasons

These are the defaults. Keep each unless research or a concrete requirement shows a better option. Record every one as an ADR (decision, context, options, choice, trade-offs, revisit trigger, evidence).

| # | Default |
|---|---|
| D1 | Single Next.js App Router app, TypeScript, modular monolith under `src/modules/<domain>/` (core, people, academics, attendance, admissions, finance, exams, website, ai, notifications). No monorepo. |
| D2 | pnpm. |
| D3 | Supabase Postgres with CLI SQL migrations in `supabase/migrations/`, `supabase-js` with generated types. No ORM. |
| D4 | Single database; `institution_id` on every tenant table; RLS policies call `security definer` helpers (`app.member_institutions()`, `app.has_role(inst_id, role)`, `app.has_permission(inst_id, perm)`) backed by a `memberships` table. Supports users in multiple institutions. |
| D5 | Path-based tenant routing `app/(tenant)/[institution]/…`; layout resolves membership; every server action takes `institution_id` and re-verifies. Public site at `/s/[slug]` (subdomains later via middleware). |
| D6 | Authorization in two layers: RLS for data, `requirePermission(ctx, 'exam.result.publish')` in every server action. Static TypeScript permission matrix (role → permissions) for the demo; table-driven in Phase 4. Hiding UI is never authorization. |
| D7 | Server Actions for authenticated mutations with Zod validation; Route Handlers for public forms, AI streaming, cron/jobs. Uniform result envelope `{ok:true,data} | {ok:false,error:{code,message,fieldErrors?}}`. |
| D8 | Service-role usage limited to: seed/reset script, job runner, and named `security definer` functions (`submit_public_enquiry`, `enrol_applicant`, `publish_exam_results`, `record_payment`, `apply_recheck_decision`). Each listed in the security doc and audited. |
| D9 | AI via Vercel AI SDK with Anthropic (cloud: `claude-sonnet-5` for quality, `claude-haiku-4-5-20251001` for cheap) and Ollama (local). Internal gateway `src/lib/ai/gateway.ts` enforces per-institution policy `local_only | cloud_allowed | local_with_cloud_fallback`, daily token quota per institution, per-user rate limit, concurrency cap, redaction before any cloud call, and logs usage (tokens, cost estimate, latency, provider, model) but never prompt bodies. `local_only` must never instantiate a cloud provider. Structured outputs validated with Zod. |
| D10 | Background work via a `jobs` table processed by a cron route handler and `pnpm jobs:run`. No queue service. |
| D11 | Notifications: `notifications` (in-app, real) + `delivery_attempts` through a channel adapter interface; SMS/email adapters are simulated and labeled. |
| D12 | Website: data-driven public site (`websites`, `pages`, JSON blocks, `page_versions` with publish), block-form editing. No visual editor, no AI site generation in the demo. Enquiry form writes to admissions through a rate-limited `security definer` function. |
| D13 | Finance: offline payment recording (cash/UPI/bank ref), sequential receipt numbers per institution, immutable `payments`/`receipts` (triggers block UPDATE/DELETE), ledger entries. No gateway. |
| D14 | Exams: `exams → exam_papers → marks` (paper-level, versioned with `superseded_by`), `results` immutable snapshot on publish, `recheck_requests` state machine, approved correction inserts a new marks version and re-snapshots; original always preserved; every step audited. Per-question marks, scanned scripts, OCR are Phase 2 (upload + secure view is P1 if time allows). |
| D15 | UUID v4 primary keys; human-readable numbers (admission_no, employee_no, invoice_no, receipt_no) from a row-locked `institution_sequences` table. |
| D16 | Tailwind v4 + shadcn/ui + Recharts + lucide. |
| D17 | Vitest (unit, DB integration with real RLS) + Playwright (E2E) + ESLint + tsc. No pgTAP. |
| D18 | Demo hosting: Vercel + hosted Supabase (`ap-south-1`). Dev: local Supabase. Hybrid/on-prem documented as a path (same schema, self-hosted Supabase, app container), not built. |
| D19 | Deterministic seed with a fixed PRNG seed: 12 grades × 6 sections ≈ 3,024 students, ~100 teachers, 60 school days of attendance, one completed term exam with marks and published results, current-year invoices ~70% paid, ~40 admission leads across stages, one guardian per persona with 1–2 children. `pnpm demo:reset` deletes only rows of institutions with `is_demo = true` and only when `DEMO_RESET_ALLOWED=true`. |
| D20 | `audit_events` append-only (trigger) written via an `audit()` helper; additional revision triggers on marks, payments, results, memberships. |

## 7. Data architecture requirements

Design the canonical model with one owning module per entity. Minimum inventory:

- **core:** institutions (slug, is_demo, ai_policy, settings JSON for configurable data points), campuses, academic_years, terms, profiles, memberships, institution_sequences, audit_events, jobs, notifications, delivery_attempts, ai_usage_events
- **people:** students (admission_no unique per institution, `source_application_id` unique for idempotent enrolment), guardians, guardian_students (relationship, is_primary, portal_access), staff, departments
- **academics:** grades, class_sections, subjects, subject_assignments, enrolments + enrolment_status_history, curriculum_units, assignments, assignment_submissions
- **attendance:** attendance_sessions, attendance_records, attendance_corrections
- **admissions:** enquiries, applications, application_decisions
- **finance:** fee_structures, fee_components, fee_assignments, concessions, invoices, invoice_lines, payments, receipts, ledger_entries
- **exams:** exams, exam_papers, marks, results, recheck_requests, recheck_decisions, answer_sheets (P1)
- **website:** websites, pages, page_versions, notices, events

Reserve by naming convention, do not create: payroll, library, transport, inventory, modules/plans/subscriptions/entitlements/usage_events, workflow definitions, timetable solver runs, device registry, consent/retention records.

For every table document: purpose, owner, PK/stable IDs, essential fields and types, nullability, FKs and cardinality, uniqueness/check constraints, tenant ownership, sensitivity class, indexes from expected queries, history/deletion semantics, migration order, representative tests. Operational records vs immutable history must be explicit. Student and guardian records are never duplicated for module convenience.

## 8. Workflows to specify (state diagram + contract + failure cases each)

1. Preconfigured demo tenant bootstrap (self-service signup is P1 stub, on roadmap)
2. Student/guardian CSV import with duplicate detection (P1; demo uses seed)
3. Website page publish and public enquiry capture (rate limit, spam, duplicate submissions)
4. Admission application → decision → enrolment (single transaction, idempotent on application_id, creates/links student and guardian, assigns section and fee structure)
5. Attendance session → absence → correction with audit → guardian notification
6. Assignment creation and AI quiz generation from a curriculum unit (structured output, teacher reviews before saving)
7. Exam setup → marks entry → arithmetic verification → publish (snapshot)
8. Recheck request → review → authorized decision → correction → re-snapshot → notify
9. Fee structure → assignment → invoice generation → payment recording → receipt → ledger
10. AI request: policy check → quota → provider selection → redaction → call → validation → usage log
11. Local inference unavailable → explicit permitted fallback or clear refusal under `local_only`
12. Job execution with retry, idempotency key, and dead-letter state
13. Demo reset

Each with trigger, preconditions, actor and permission, inputs (Zod), state transitions, validation, side effects, DB operations and transaction boundary, notifications, approvals, failure and retry behavior, duplicate-submission behavior, audit records, user feedback, tests.

## 9. Security and AI governance package

- Threat model: cross-tenant read/write, guardian seeing other children, teacher reading finance/HR, direct server-action invocation bypassing UI, drafts leaking on the public site, Storage path traversal, service-role leakage, prompt injection via student-authored text, unauthorized cloud egress under `local_only`, demo reset against non-demo data.
- Permission matrix: roles (owner, principal, admin, admissions, accountant, exam_controller, teacher, student, guardian, platform_superadmin) × permissions; map every sensitive operation.
- Data classification: public, internal, confidential (finance, HR, counselling, exam pre-publication), restricted (credentials, tokens).
- AI data-flow policy, local/cloud decision rules, quotas and limits, approval requirements (AI never changes marks, payments, access, or welfare decisions), logging/retention rules.
- Security test checklist that is executable: a generated Vitest suite that iterates over every tenant table and proves SELECT/INSERT/UPDATE/DELETE isolation; BOLA tests on student, guardian, invoice, result IDs; role escalation through server actions; public/private content separation; unauthorized cloud fallback.

## 10. Testing and acceptance

Define the pyramid with the single stack above (Vitest, Playwright, ESLint, tsc; GitHub Actions workflow prepared even before the remote exists). Specify: unit targets (calculations, state machines, permission matrix, AI routing/quota policy, Zod schemas), DB-integration targets (constraints, RLS, enrolment transaction, payment idempotency, marks versioning, recheck transitions), E2E journeys for every demo step, security tests, nonfunctional checks (lint/type/build, accessibility smoke, responsive smoke, demo reset, backup/restore procedure), and load-test scenarios with explicit assumptions (teacher attendance burst at 8:00, 3,000 guardian dashboard loads after result publication, bulk invoice generation) measured on Day 15 and Day 17, never asserted in advance. Define the "task done" gate and the "demo ready" gate.

## 11. The 20-day demo scope and plan

Deliver the 13-step narrative: public website → enquiry → CRM → accept → enrol (student + guardian + section + fees) → teacher attendance → guardian portal → assignment + AI quiz → marks → publish → recheck → corrected result → principal dashboard. Label each step fully implemented / limited / simulated. Explicitly exclude: self-service signup, payroll, library/transport/inventory, timetable solver, marketplace/billing, visual website editor, OCR, payment gateway, multi-campus UI, social network, hardware.

Produce a day-by-day plan with checkpoints and gates, the critical path (scaffold → foundation schema + RLS → people/academics → seed → parallel lanes → integration Day 16 → security Day 17 → deploy Day 18 → rehearsal Day 19 → buffer Day 20), four parallel lanes after the foundation (academics/attendance/exams; website/admissions; finance; AI/notifications/dashboard), named shared-file conflict zones (migrations numbering, permission matrix, tenant layout and nav, seed script sections), the most likely delay causes, and an ordered fallback ladder that removes scope without removing security or faking features.

## 12. Multi-agent methodology (the core of this run)

You orchestrate. Sonnet 5 agents implement. Rules:

**Planning stage (this run):** use at most 3–4 narrowly scoped read-only research agents in parallel only where it saves time (library docs, domain data points, AI benchmark design). Do not have several agents produce the same architecture. You reconcile and own the single design.

**Implementation stage (after approval):**
- Decompose into task packets of 0.5–1.5 agent-days. Each packet has: ID and title; business outcome; feature-matrix IDs it serves; verified current repo state; links to the exact spec sections (not the whole package); files to inspect first; expected changes; files that must not be modified; prerequisites; security and data-integrity requirements; acceptance criteria; exact test commands; deliverables; assumptions and risks; completion-report format.
- Shared foundations (schema migrations, permission matrix, tenant layout, seed framework, AI gateway interface, result envelope, notification adapter interface) are finished and merged **before** dependent lanes start. One agent owns each numbered migration; nobody else edits it.
- Parallel only across lanes with disjoint file sets. Encode dependencies as a DAG in the backlog index.
- Each agent runs only its packet's targeted tests during work; the lead runs the full suite at integration checkpoints (Days 4, 9, 13, 16, 18).
- Review is separate from implementation: the lead or a `code-reviewer` / `security-reviewer` agent reviews every packet touching auth, RLS, finance, exams, AI gateway, or seed/reset before merge.
- Completion report (max ~25 lines): files changed; behavior implemented; tests run with actual results; tests not run and why; limitations; security/integration risks; follow-ups.

**Before a Sonnet agent writes code it must:**
1. Load `andrej-karpathy-skills:karpathy-guidelines` and apply the Ponytail principles (challenge every new file, dependency, and abstraction; reuse platform features; keep validation, security, error handling).
2. Read `CLAUDE.md` and its task packet and only the linked spec sections.
3. Use Context7 (`docs-lookup`) for any library API it is not certain about, against the versions pinned in the repo.
4. Inspect the existing implementation of the affected path.
5. Write a 5–10 line plan: problem, smallest change, files, tests, assumptions. For trivial tasks a 3-line plan is enough.
6. Use `tdd-workflow`: write the failing test first for business rules, RLS, and state transitions.
7. Ask a question only if a critical ambiguity cannot be resolved safely; otherwise proceed with a recorded default.

**Token rules for agents:** no whole-file dumps; no repeated context already in docs; targeted greps and partial reads; no speculative extras; stop retrying after two failures on the same root cause and report instead; reuse existing components, schemas, utilities; no new dependency without a one-line justification in the completion report.

**Definition of done:** acceptance criteria met, packet tests green, integrated into the running app on seeded data, reviewed where required, honesty label correct in UI and docs.

Write the project `CLAUDE.md` so that an agent with only `CLAUDE.md` + its packet can work correctly: stack, commands, folder conventions, result envelope, auth/permission helpers, migration rules, test commands, boundaries, the pre-code protocol above, and the completion-report format.

## 13. Deliverables (write to `docs/planning/coolskool/`, plus root `CLAUDE.md`)

```
00-README.md                     index; how an agent navigates the package
01-executive-brief.md            objective, demo scenario, baseline, 20-day slice, decisions, risks, roadmap, non-goals
02-environment-baseline.md       the facts from §0, credential gaps, what is unverified
03-feature-matrix.md             full long-term catalog: ID, name, value, phase, demo status, P0–P3, deps, data owner, sensitivity, acceptance ref, assumptions
04-architecture.md               Mermaid context + module diagrams, module contracts, cross-module pattern, deployment modes, AI gateway, website publishing, events/jobs
05-data-architecture.md          Mermaid ERD, data dictionary, ownership matrix, constraints/indexes, RLS strategy, history/deletion, migration order, seed design, integrity tests
06-workflows-and-contracts.md    the 13 workflows with state diagrams, server-action/route contracts, Zod shapes, error codes, idempotency, audit
07-security-and-ai-governance.md threat model, permission matrix, classification, AI policy, limits, approvals, logging, executable checklist
08-testing-and-acceptance.md     pyramid, tools, high-risk cases, E2E journeys, load scenarios + assumptions, gates, known limitations
09-twenty-day-plan.md            day plan, critical path, lanes, conflict zones, delay risks, fallback ladder, rehearsal plan
10-backlog-index.md              task DAG, lane assignment, parallel/sequential marks, critical-path flag
tasks/T-0NN-<slug>.md            one packet per task (~35–40), 40–90 lines each
11-operations.md                 env var names (no values), local/hosted setup, seed/reset, dev/demo separation, deploy, backup, monitoring, troubleshooting, production-readiness gaps
12-decision-log.md               all ADRs + Phase 0 verified facts with sources
```

Size caps: documents 150–400 lines; no document restates another. The feature matrix must cover the whole long-term catalog (institution/identity, student lifecycle, website/admissions, exams/rechecking, finance/staff, learning/intelligence, services/campus, commercial platform) with phase and dependency, so nothing is lost while the demo stays small. Include a five-phase dependency map (foundation → complete operations → intelligence/optimization → marketplace/ecosystem → institution intelligence/controlled autonomy).

## 14. Hard boundaries for this run

- No application code, no dependency installs, no migrations, no Supabase project creation, no deployment, no destructive commands.
- No printing of secrets (none exist, keep it that way).
- No claims of having tested, benchmarked, or load-tested anything.
- Do not spend the run optimizing the agent environment or installing tools.

## 15. Quality gates before you finish

Run these reviews on your own package and fix contradictions: product (does the demo tell a credible school story without technical explanation?), architecture (one owner per entity, no duplication, modules addable without breaking shared records), security (cross-tenant, guardian scope, direct action invocation, draft leakage, AI boundary, unapproved changes to marks/payments/access), data integrity (duplicates, retries, deterministic totals, traceable corrections, safe reset), delivery (DAG complete, every critical task has acceptance criteria, integration time protected, fallback exists), token efficiency (one home per decision, packets independently understandable, no unjustified abstraction or parallelism).

## 16. Final response format

After writing and committing the package, reply with a concise summary: environment condition; key architectural findings and decisions with rationale; the 20-day scope with honesty labels; data and workflow conclusions; security/privacy/reliability risks; five phases and dependencies; critical path and ordering; which tasks run in parallel; what remains unverified; files created; and the next five tasks in exact execution order. Point to files; do not repeat them. State clearly that this run planned and did not implement or test anything.

Begin with Phase 0.
