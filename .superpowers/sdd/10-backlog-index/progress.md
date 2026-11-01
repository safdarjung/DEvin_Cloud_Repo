# SDD ledger — plan: docs/planning/coolskool/10-backlog-index.md

Spec authority: docs/planning/coolskool/0{1..8}-*.md (07 §2.2 permission matrix wins over packet RLS classes). Packets: docs/planning/coolskool/tasks/T-0NN-*.md. Branch: feat/mvp-implementation (not main; push/merge needs owner approval).
Level 1 = all 45 packets (owner, 2026-10-29). Level 2 (UX, features, AI) planned after Level 1.

## Rulings
- Ruling: T-020 waits for DB — request/start-review/decide must be definer RPCs enforcing window + one-open-per-paper in SQL (PostgREST-callable rule lesson); migration 0022.
- Ruling: DBT-24 — guardian_students.portal_access gates portal visibility only; notifications unaffected.
- Ruling: P-01 lead packet — rewrite hot RLS policies to row-independent initPlan helpers (0020); blocks portal/dashboard/demo — cost: large policy churn, re-review all security.
- Ruling: T-019 implements notify.results_published (T-038 deferred it pending results table); T-020 implements notify.recheck_decided.
- Ruling: admissions gets SELECT on fee_structures (0019) — demo step 5 actor is Admissions and enrol needs a structure; invoices stay excluded per finance.read — cost: admissions sees fee names/amounts.
- Ruling: bulk term invoicing via `public.enqueue_term_invoices` definer (0017; finance_write_roles; payload built in SQL) — no generic user enqueue — cost: one more migration.
- Ruling: T-027 decide/convert become atomic definer RPCs (0016) and extend the applications status guard to decided states — closes rest of DBT-20.
- Ruling: T-036 generates with a refine-free schema and strict-parses refinements after (DBT-27) — Ollama runner crashes on the refined schema — cost: two schemas to keep in sync.
- Ruling: public site resolves slug via `public.get_public_site(slug)` definer (migration 0015; safe fields only, live sites only, anon execute) — not an anon policy on institutions (would expose settings/ai_policy; DBT-11) — cost: one more definer to review.
- Ruling: T-024 honeypot is z.string() + code check, not z.literal('') — literal would reject bots instead of silent success (C-83).
- Ruling: memberships.student_id/guardian_id is the canonical user link; students/guardians.user_id unused (DBT-23) — RLS already uses memberships — cost: column cleanup later.
- Ruling: up to 2 implementers in parallel, disjoint file fences, exactly one DB owner (others run only their own db test file) — owner asked for multiple agents/speed; skill says serial — cost if wrong: occasional flaky DB test, rerun.
- Ruling: each packet = implementer (Sonnet) → lead check → required review (security-reviewer for packets in 10 §4 list, else code-reviewer; Sonnet) → fixes by resuming implementer → lead runs suites → commit per packet — cost if wrong: extra review loops.
- Ruling: RLS follows 07 §2.2 matrix over packet "class S" wording (T-014 review) — cost: packets' RLS expectations differ from text; logged per packet.
- Ruling: D27 lead-added audit helper (migration 0013) — no packet created src/lib/audit.ts.
- Ruling: T-015 submit enqueues jobs via a `public.submit_attendance` definer RPC (migration 0014), not a user-callable enqueue — T-037 HIGH lesson.
- Ruling: library API checks go through the docs-lookup agent (Context7); implementers report what it confirmed — owner request.

## Reserved fix migrations (10 §3)
0011 T-012 (done) · 0012 T-037 (done) · 0013 D27 (done) · 0014 T-015 submit/correct attendance · 0015 T-024 get_public_site · 0016 T-027 decide/convert RPCs + status guards (planned) · 0017 T-031 enqueue_term_invoices (planned) · 0018 T-018 enter_marks/status guards · 0019 T-028 fee_structures read for admissions · 0020 P-01 RLS performance · 0021 T-032 receipt snapshot enrichment (planned) · 0022 T-020 recheck RPCs (planned)

## Progress
- T-001…T-012: complete (39dfd37)
- T-013: complete (c94a8f8, code review → 3 fixes)
- D26 docs: 9129664
- T-035: complete (ad226bf, security review → 4 fixes)
- T-014: complete (7568c6a, security review → CRITICAL+HIGH fixed)
- T-037: complete (736d6b4, lead rework superuser DSN + security review HIGH fixed)
- D27: complete (737b723, security review clean; DBT-18 parked)
- T-026: complete (e2f5cce, lead HIGH anon grant + security review MEDIUM fixed; DBT-20 parked for T-027)
- T-022: complete (2e69318, code review → races, answer leak, dedupe fixed; DBT-19, DBT-21 parked)
- T-023: complete (5ea2e59, security review clean; DBT-22 parked)
- T-038: complete (see git log; code review → active filter, layout guard, backfill fixed; DBT-23/24 parked)
- T-015: complete (800da94; security review MEDIUM tz fixed; follow-ups: seed I-A/VI-A teacher → T-016, DBT-25)

- T-024: complete (see git log; security review → IP spoofing, body cap, mock parity fixed; DBT-26)
- T-030: complete (152220f; review CRITICAL admin money + HIGH enrolled guard fixed). Note for T-028: enrol_applicant roll_no collision surfaces as raw PG error → map to conflict
- T-040: complete (ada4fe0; review → schema parity test; DBT-27 for T-036)
- T-025: complete (c7590a7 + e2e fix 9b70d6a)

- T-017: complete (see git log; CRITICAL post-publish tampering fixed; enter_marks must be one-transaction RPC in T-018)
- T-031: complete (f64732f; phase 1; review HIGH sync cap fixed). Phase 2 (0017 enqueue_term_invoices) queued after T-017 review

- T-036: phase 1 complete (see git log; review MEDIUM delimiter + LOWs fixed). Phase 2 DBT-21 (answer-key split migration) queued
- T-028: complete (d2c6f51; 0019 admissions fee read; registry idempotent + static unique-name test; search quoting fix)

- T-027: complete (6950310; review HIGH oracle fixed; full reset + e2e 28/28)

- T-018: complete (see git log; review clean + 3 LOW fixes)

- T-019: complete (see git log; e2e j10 pending full run)

- T-016: implementing (DB owner; seed attendance + fix one-teacher-two-sections seed bug; report → T-016-report.md)

- T-032: implementing (parallel; own db file; receipts from snapshot; report → T-032-report.md)

- P-01: complete (see git log; CRITICAL fixed + re-review PASS; 07 §4 helper rows ride with Batch A commit)
- BATCH-A: complete (see git log): T-016 fix, T-031p2 0017, T-032p2 0021

- T-032: phase 1 complete (see git log). Phase 2 QUEUED after P-01: 0021 receipt snapshot enrichment

- T-034: complete (see git log; review MED receipts query + LOW perms fixed)

- T-039: complete (see git log; DBT-31)

- BATCH-B: complete (6b77957; review 0 CRIT/HIGH, MED fixed via publish gate; j07 fix + payments tz test fix included)
- Ruling: LOW staff-on-behalf recheck — action stays student/guardian (SQL allows exam_write_roles) — fails closed; spec J-11 is guardian-filed — cost if wrong: small action+perm change later.
- T-034: fix round 2 done — resolvePortalSelection redirects to ?student=<id>; j07+j11 5/5, unit 358, lint/typecheck clean. Ships with Batch B commit

## Next queue
T-031p2(0017) → T-036p2(DBT-21) → T-020 → T-021 → T-029 → T-033 → T-020(DB, 0022) → T-041…T-045
- SEEDS (T-021+T-029+T-033): complete (committed; db 309, sec 474, unit 358; e2e 33/38 non-seed causes) — review APPROVE (MED published_at → DBT-33 + comment; LOW no-op test dropped)
- BATCH-C: complete (db 310, sec 474, unit 358, e2e 38/38 x2; lead review of 0024 added concession cap + zero-subtotal guard, C-51d)
- NEXT: T-041 demo narrative e2e J-00..J-13 → T-042 security suite + DBTs → T-043 load → T-045 rehearsal. T-044 needs user OK.
- T-041: complete (e2e 79/79 x2). Found: (a) guardian/student report card exam name null — exams_select staff-only RLS; (b) teacher root redirect → /portal → 500; (c) axe-core dep deferred to T-045. (a)+(b) → T-042 batch, migrations from 0025.
- T-042: complete (0025–0044; sec 999, db 310, unit 378, e2e 79; 2 review rounds, all HIGH/MED fixed)
- T-043: complete (local L1–L4 met, 0 errors; fixed 1,000-row truncation in generate_term_invoices + lead added stable order). T-045 todo: sweep other unbounded PostgREST reads >1,000 rows.
- T-044: user-approved ("you do them"). Hosted Supabase ikraqkdptahvjbglvwzz is eu-west-1 (NOT ap-south-1) — Ruling: proceed for synthetic demo; real school data needs Mumbai project. Vercel project coolskool-demo (Hobby), prod https://coolskool-demo.vercel.app; vercel.json framework=nextjs; .vercelignore blocks .env*. Jobs via pg_cron+pg_net (scripts/hosted-schedule-jobs.ts) — Ruling: free tier, no Vercel Pro. Found: hosted lacks default API grants → 0045 (table grants = local ACLs) + 0046 (service_role EXECUTE); both no-op locally. Seed silently ignored supabase-js errors (people.ts upserts) → fix in T-045. Secrets pasted in chat (secret key, DB password) → user to rotate.
- T-044: complete (5fe7117). Hosted seed ok (15 min; people 9 min — T-045 perf). pg_cron fired, route 200. Hosted J-00 12/12, J-01 8/8. Found+fixed: dead nav links /academics /ai /settings (prod prefetch 404s) + nav-routes test. Pending user: rotate Supabase secret key + DB password (both pasted in chat). Not done from packet: backup/restore drill, full hosted e2e J-02..J-13 (mutates demo data; run before rehearsal then reset).
- Runbook artifact: https://claude.ai/artifact/DxswhnFQzBbrheyrBa3TJL
- L1-AI (owner-approved 2026-10-30, post-Level-1 polish, 4 features via AskUserQuestion): report-card remark drafts (DB owner, migration 0047 result_remarks), principal daily briefing, attendance pattern insights (anonymized — no PII in prompt), admissions reply drafts (adds admissions to ai.generate). All reuse src/lib/ai/gateway.ts + the quiz feature's pattern (nonce delimiters, ProviderBadge, AI-drafts-human-saves). 4 agents dispatched in parallel; reports to L1-AI-{remarks,briefing,attendance,enquiry}-report.md.
- L1-AI: complete (39bf3a4). 4 features, independent review 0 CRIT/HIGH (4 MED/4 LOW, all fixed), lead fixed a test bug (missing mock + unrealistic URI-too-long fixture) before commit. db 316, security 1018, unit 430, lint/typecheck clean. Not deployed to hosted yet.
- D28/teacher-agent: owner-approved real multi-turn tool-calling agent, teacher role first. Verified: local qwen2.5:3b tool-call round-trip works (~3.7s); Gemini flagship free tier unusably slow (~400s, reproduced 2x); gemini-flash-lite-latest works (~5s) — chosen. Owner approved Gemini for ALL teacher-agent tools incl. student data (D28 exception to L2-02). Deps @ai-sdk/google + @ai-sdk/react installed, committed (92896d8) with ADR. Implementer dispatched: 5 tools (findStudent, findCurriculumUnit new; getAttendancePattern, generateQuiz, draftResultRemark reuse existing scope-checked logic), new route /api/ai/agent/teacher, new /ai page, nav entry.
- D28/teacher-agent: complete (7df3b36). Review: 1 HIGH (file-part DoS) + 1 MED (uncapped output/concurrency) + 4 LOW, all fixed. New db test proves cross-teacher isolation under real RLS. Verified live with real Gemini key: ambiguous "Aarav Sharma" (2 students) correctly triggered a clarifying question. db 318, unit 456, lint/typecheck clean. NOT pushed to GitHub/deployed to hosted yet — GEMINI_API_KEY only in local .env.local.
