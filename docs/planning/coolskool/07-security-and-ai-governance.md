# 07 — Security and AI governance

## 1. Threat model

| # | Threat | Vector | Control | Verified by |
|---|---|---|---|---|
| T1 | Cross-tenant read/write | Any query with a forged `institution_id`; direct PostgREST call with a user JWT | RLS on every table via `app.is_member` / `app.has_role`; `institution_id` never taken from the client without re-check in `getTenantContext` | Generated RLS suite (C-01), BOLA tests (C-10..) |
| T2 | Guardian sees another child | Guessing student/invoice/result ids | Own-scope policies via `app.guardian_student_ids`; actions re-check scope | C-11, C-44, C-54 |
| T3 | Teacher reads finance/HR | Navigating to `/finance`, calling finance actions | Class **C** RLS (finance/exam role sets); `requirePermission` in actions; nav hidden only as UX | C-03, C-50 |
| T4 | Direct server-action invocation bypassing UI | Crafted POST to a server action with another institution's slug or forbidden input | `defineAction` always resolves ctx from session + slug and checks permission; Zod rejects unknown fields (`.strict()`) | C-03 escalation tests |
| T5 | Drafts leaking on the public site | Anon query on `page_versions` or guessing version ids | Policy **P** exposes only `published_version_id` rows; public route never selects drafts | C-80 |
| T6 | Storage path traversal | Upload to `other-institution/...` | Bucket `institution-files`; policy `(storage.foldername(name))[1] = institution_id::text` and `app.is_member`; signed URLs only (P1 feature) | Storage policy test when F-STU-08 lands |
| T7 | Service-role leakage | Importing `admin.ts` in a client component or action | `src/lib/supabase/admin.ts` is `server-only`, exports a factory that throws unless `process.env.SERVICE_ROLE_CALLER` matches an allow-list set by seed/jobs entrypoints; ESLint `no-restricted-imports` outside `scripts/` and `src/modules/jobs/` | Lint rule + unit test of the guard |
| T8 | Prompt injection via student/teacher-authored text | Curriculum text or remarks containing instructions | Data block delimiters + instruction; schema-constrained output; human review before save; no tool use in demo prompts; injection fixture in benchmark | C-66 |
| T9 | Unauthorized cloud egress under `local_only` | Bug or misconfiguration selects Anthropic | Policy resolver returns a plan without `cloud`; the cloud provider module is lazily imported only when the plan contains `cloud`; `AI_CLOUD_ENABLED` global switch | C-62 (spy on provider factory) |
| T10 | Demo reset against non-demo data | Operator error or exposed endpoint | `app.demo_reset` raises unless `is_demo`; `DEMO_RESET_ALLOWED` env; permission `demo.reset` only for `is_platform_admin`; UI confirmation phrase | C-04 |
| T11 | Marks/payments tampering | Direct UPDATE/DELETE | Immutability triggers; versioned corrections; audit revision triggers | C-43, C-52 |
| T12 | Rate abuse on public forms | Bots on enquiry form | Rate limit per `ip_hash` per hour inside the function; honeypot; (CAPTCHA planned) | C-81, C-83 |
| T13 | Session fixation / stale claims | Long-lived cookies | `@supabase/ssr` refresh in `proxy.ts` with `getClaims()`; memberships read from DB each request (no role in JWT) | Manual + C-02 |
| T14 | Secrets in repo or logs | `.env` commit, logging env | `.gitignore` covers `.env*` except example; CI secret scan (`gitleaks` action); logger redacts keys | CI job |

## 2. Permission matrix

### 2.1 Roles

| Role | Who | Scope rule |
|---|---|---|
| owner | School management/trust | Everything in the institution |
| principal | Head of school | Everything except member management of owners; approves decisions |
| admin | Office administrator / ERP admin | Configuration, people, website publish, jobs |
| admissions | Front office / admissions executive | Enquiries, applications, enrolment, website edits |
| accountant | Accounts office | Fee structures, invoices, payments, finance reads |
| exam_controller | Exam cell coordinator | Exam setup, verification, publish, recheck decisions |
| teacher | Teaching staff | Own sections (class teacher or subject assignment) for attendance, marks, assignments |
| student | Enrolled student with a login | Own records only |
| guardian | Parent/guardian with a login | Linked children only (`guardian_students.portal_access`) |
| platform_superadmin | CoolSkool operator (`profiles.is_platform_admin`) | `demo.reset`, `institution.create`; no tenant data access unless also a member |

### 2.2 Matrix

Roles: **own** owner · **pri** principal · **adm** admin · **ads** admissions · **acc** accountant · **exc** exam_controller · **tch** teacher · **stu** student · **grd** guardian. `platform_superadmin` = `profiles.is_platform_admin` (only `demo.reset`, `institution.create`). ✓ = granted; `s` = scoped by RLS to own sections (teacher) or own children/self (guardian/student).

| Permission | own | pri | adm | ads | acc | exc | tch | stu | grd |
|---|---|---|---|---|---|---|---|---|---|
| institution.settings.manage | ✓ | ✓ | ✓ | | | | | | |
| member.manage | ✓ | ✓ | ✓ | | | | | | |
| audit.read | ✓ | ✓ | ✓ | | | | | | |
| dashboard.view | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | | |
| student.read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | s | s | s |
| student.write | ✓ | ✓ | ✓ | ✓ | | | | | |
| guardian.read | ✓ | ✓ | ✓ | ✓ | ✓ | | s | | s |
| staff.read | ✓ | ✓ | ✓ | | ✓ | ✓ | | | |
| staff.write | ✓ | ✓ | ✓ | | | | | | |
| academics.manage | ✓ | ✓ | ✓ | | | | | | |
| academics.read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | s | s |
| attendance.mark | ✓ | ✓ | ✓ | | | | s | | |
| attendance.correct | ✓ | ✓ | ✓ | | | | s (window) | | |
| attendance.read | ✓ | ✓ | ✓ | | | ✓ | s | s | s |
| admissions.enquiry.read / write | ✓ | ✓ | ✓ | ✓ | | | | | |
| admissions.application.decide | ✓ | ✓ | | ✓ | | | | | |
| admissions.enrol | ✓ | ✓ | ✓ | ✓ | | | | | |
| finance.structure.manage | ✓ | ✓ | ✓ | | ✓ | | | | |
| finance.invoice.generate | ✓ | ✓ | | | ✓ | | | | |
| finance.payment.record | ✓ | ✓ | | | ✓ | | | | |
| finance.read | ✓ | ✓ | ✓ | | ✓ | | | s | s |
| exam.manage | ✓ | ✓ | | | | ✓ | | | |
| exam.marks.enter | ✓ | ✓ | | | | ✓ | s | | |
| exam.result.publish | ✓ | ✓ | | | | ✓ | | | |
| exam.result.read | ✓ | ✓ | ✓ | | | ✓ | s | s | s |
| exam.recheck.request | | | | | | | | s | s |
| exam.recheck.review / decide | ✓ | ✓ | | | | ✓ | | | |
| assignment.manage | ✓ | ✓ | | | | | s | | |
| assignment.read | ✓ | ✓ | ✓ | | | | s | s | s |
| ai.generate | ✓ | ✓ | ✓ | | | | ✓ | | |
| ai.usage.read | ✓ | ✓ | ✓ | | | | | | |
| website.edit | ✓ | ✓ | ✓ | ✓ | | | | | |
| website.publish | ✓ | ✓ | ✓ | | | | | | |
| notification.read (own) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| notification.log.read | ✓ | ✓ | ✓ | ✓ | | | | | |
| job.manage | ✓ | ✓ | ✓ | | | | | | |

The matrix is implemented once in `src/lib/auth/permissions.ts` as `ROLE_PERMISSIONS: Record<Role, Permission[]>`; a unit test snapshots it against this table (C-03). RLS role sets (`app.staff_roles()` etc.) mirror the read columns; `tests/security/rls-expectations.ts` declares per-table expectations and the generated suite asserts them.

## 3. Data classification

| Class | Examples | Handling |
|---|---|---|
| Public | published pages, public notices/events, institution name | Anon RLS; cacheable |
| Internal | grades, sections, subjects, curriculum, assignments, jobs, ai usage | Members only |
| Confidential | student/guardian/staff PII, attendance, admissions, finance, HR, exam marks before and after publication, audit, delivery logs (contain phone numbers) | Role-scoped RLS; never sent to cloud AI unredacted; never logged in plain text |
| Restricted | credentials, service role key, API keys, session cookies, `CRON_SECRET` | Env only; `server-only` modules; never in client bundles, logs, or reports |

Exam marks are confidential at all times; pre-publication they are additionally invisible to guardians/students because `results` rows do not exist until publish and `marks` has no guardian policy.

## 4. Service-role allow-list (D8)

| Caller | Purpose | Guard |
|---|---|---|
| `scripts/seed/*`, `scripts/demo-reset.ts` | Seed and reset | CLI only; `DEMO_RESET_ALLOWED` for reset |
| `src/modules/jobs/runner.ts` | Claim and process jobs across institutions | `CRON_SECRET` on the route; `SERVICE_ROLE_CALLER=jobs`. Calls `app.claim_job`/`app.complete_job` (schema not exposed over PostgREST) via the `public.jobs_claim`/`public.jobs_complete` security-definer wrappers (`20261028000012`), `execute` revoked from public/anon/authenticated, granted only to `service_role` — the web route never holds a direct Postgres superuser connection. Dead-lettering an unknown job type updates `public.jobs` directly (service_role has BYPASSRLS + standard `public` table grants; no wrapper needed). The CLI (`scripts/jobs-run.ts`) uses the same service-role client via `scripts/lib/admin-client.ts`, not a superuser DSN. Tenant-side job mutation (admin "Requeue" on `/jobs`) is not service-role at all: `public.jobs_requeue(p_institution_id, p_id)` (`20261028000012`) is `execute`-granted to `authenticated` (not `service_role`), internally checks `app.has_role(p_institution_id, array['owner','principal','admin'])`, only allows `status = 'dead' → 'queued'`, and writes its own `app.audit` row (status+attempts only) — `jobs_update` (0003) was dropped and `UPDATE` revoked from `authenticated` on `public.jobs` so no other tenant-side mutation path exists. |
| `src/lib/ai/usage.ts` (T-035) | Read quota/rate counts and insert `ai_usage_events` metadata (never prompt text) for users who hold `ai.generate` but not `ai_usage_events` SELECT | Called only after `runStructured`'s `hasPermission(ctx, 'ai.generate')` check; queries filter by `ctx.institution.id`; `withAiServiceRole` sets `SERVICE_ROLE_CALLER=ai` only for the synchronous factory call |
| `src/modules/website/with-service-role.ts` (T-024) | Public enquiry capture | `public.submit_public_enquiry` is granted to `service_role` only (`20261028000007`) — neither anon nor authenticated may call it directly (lead security review, HIGH). `withPublicEnquiryServiceRole` sets `SERVICE_ROLE_CALLER=public_enquiry` only for the synchronous factory call inside `src/app/api/public/enquiry/route.ts`'s `POST` handler, restores it in `finally`. The route does its own honeypot check and Zod validation first, and computes `ip_hash` server-side before the call — never a raw IP, never a client-supplied hash. |
| SQL `security definer` functions | `app.submit_public_enquiry`, `app.assign_application_no` (trigger, T-026, `20261028000007`), `app.enrol_applicant`, `app.generate_invoice`, `app.record_payment` (T-030, `20261028000008`; `app` is not PostgREST-exposed, so each is wrapped by a thin `public.*` function of the same name/signature that does the role check — `public.enrol_applicant`: `authenticated` only, requires `app.current_user_id()` is not null plus `admissions.enrol` (own/principal/admin/admissions); `public.record_payment`/`public.generate_invoice`: `authenticated` (and `service_role` for `generate_invoice`, for the future T-031 job) gated on `app.finance_write_roles()` (own/principal/accountant — fix round 1, CRITICAL: `finance.invoice.generate`/`finance.payment.record` exclude admin, unlike `app.finance_roles()` used for RLS reads/structure writes, which correctly includes admin) — a null `current_user_id()` (service role) skips the check. `app.enrol_applicant` calls `app.generate_invoice` directly (not its public wrapper) in the same transaction, so that internal call is never re-role-checked; every `app.*` function still derives `institution_id` only from the row it acts on (student/invoice/application), never from a caller-supplied argument. `app.guard_application_enrolled` (trigger, T-030, `20261028000008`, fix round 1, HIGH/DBT-20): BEFORE UPDATE on `public.applications`, raises `code:invalid_state` on any direct write setting `status = 'enrolled'` unless `app.allow_enrol` is set for the transaction; `app.enrol_applicant` sets it immediately before its own status update (same `set_config`/`current_setting` shape as `app.allow_publish`, T-023), `app.publish_exam_results`, `app.apply_recheck_decision`, `app.publish_page` (T-023, `20261028000010`; role-checked inside, exposed via `public.publish_page` — `app` is not PostgREST-exposed — `execute` granted to `authenticated`, revoked from `anon`), `app.next_sequence`, `app.claim_job`, `app.enqueue_job`, `app.demo_reset`, `app.audit`, `app.validate_attendance_status` (trigger, T-014), `public.record_audit_event` (D27; `authenticated`, actor forced to caller, membership checked), `public.submit_public_enquiry` (T-026 lead fix, `20261028000007`; `execute` granted only to `service_role` — called by T-024's server route after its own honeypot check and Zod validation, with a server-computed `ip_hash`; neither `anon` nor `authenticated` may call it directly), `public.submit_attendance` (T-015, `20261028000014`; `authenticated`; checks class-teacher-or-admin scope, idempotent resubmit, enqueues `notify.attendance_absence` per notifying status, audits `attendance.submitted`), `public.correct_attendance` (T-015, `20261028000014`; `authenticated`; enforces `attendance.correct`'s matrix row including the teacher-only correction window, audits `attendance.corrected`), `public.get_public_site` (T-024 fix, `20261028000015`; `stable`; returns only `institution_id, institution_name, website_id, theme, nav`, one row, only when the website is live — never `settings`/`ai_policy`, never for an unknown or offline slug; `execute` revoked from `public`, granted to `anon, authenticated`), RLS helpers | Each checks `auth.uid()` membership/role internally where user-invoked; `execute` revoked from `anon`/`authenticated` except the user-invoked ones listed in each migration; `set search_path = ''` |

Any new service-role or `security definer` usage must be added to this table in the same PR.

## 5. AI governance (D9)

- **Data flow:** prompts are built server-side from allow-listed fields (demo: curriculum unit title/description, grade, subject, teacher instruction). Student and guardian records never enter prompts in the demo. If a future feature needs them, the redactor must map names/phones/emails/ids to placeholders and the feature must be approved here first.
- **Policy per institution:** `ai_policy` ∈ `local_only` (default) · `cloud_allowed` · `local_with_cloud_fallback`. Changed only by `institution.settings.manage`; change is audited.
- **Global switches:** `AI_CLOUD_ENABLED` (default false), `ANTHROPIC_API_KEY` presence. Without both, cloud never runs regardless of policy.
- **Limits:** daily token quota per institution, per-user per-minute requests, concurrency caps (`05 §4.1 ai`). Exceeding returns `quota_exceeded`/`rate_limited`; never silently degrades.
- **Approval rule:** AI never writes marks, payments, attendance, memberships, access, admissions decisions, or welfare records. AI output is a draft; a human with the relevant permission saves it through the normal action with full validation.
- **Redaction before cloud:** regex pass for Indian phone numbers, emails, 12-digit numbers (Aadhaar-like), and names from a per-request deny list (section roster when available); count stored in `ai_usage_events.redactions`.
- **Logging and retention:** `ai_usage_events` stores metadata only (feature, provider, model, tokens, latency, cost estimate, ok/error, redactions) — never prompt or output text. Retained with the institution. Application logs must not print prompts.
- **Transparency:** UI shows provider used and a "Simulated/Local/Cloud" badge; `/ai/usage` page for admins.
- **Benchmarking:** `pnpm ai:bench` (T-040) measures; no capability claims are made before Day 15 results exist.

## 6. Executable security checklist (`pnpm test:security`)

| ID | Test | Mechanism |
|---|---|---|
| C-01 | For every tenant table in `rls-expectations.ts` and every role: cross-institution SELECT returns 0 rows; INSERT/UPDATE/DELETE with a foreign `institution_id` fails | Generated `describe.each` over `pg_tables` ∩ expectations; fails if a tenant table lacks an expectation entry |
| C-02 | Disabled membership loses access immediately | Flip `status`, re-query |
| C-03 | Permission matrix snapshot equals `07 §2`; each action's declared permission is in the matrix; calling every action as each unauthorized role returns `forbidden` | Unit + integration over the action registry |
| C-10..C-14 | BOLA: student, guardian, invoice, result, attendance ids of another institution and of another guardian's child return `not_found`/0 rows for every role | Integration |
| C-44 | Guardian cannot request a recheck for a result that is not their child's | Integration |
| C-62 | `local_only` never calls the cloud provider factory (spy) | Unit |
| C-63 | `local_with_cloud_fallback` without key → `ai_unavailable`, no network call | Unit with mocked fetch |
| C-80 | Anon never receives draft page content; direct PostgREST select on `page_versions` as anon returns only published rows | Integration |
| C-81/83 | Enquiry rate limit and honeypot | Integration |
| C-04 | `demo_reset` refuses non-demo institution and refuses without env flag | Integration |
| C-90 | No `admin.ts` import outside allow-listed paths | ESLint rule run in CI |
| C-91 | No secrets committed | `gitleaks` in CI |

The suite is a Day 4 deliverable (T-009 scaffolds it; T-042 completes it) and runs at every checkpoint and in CI.

## 7. Logging and retention rules

| Data | Where | Content rules | Retention (demo) |
|---|---|---|---|
| Application logs | Vercel / stdout | correlation id, error code, route, institution id, user id; never prompt bodies, env values, phone numbers, or request bodies | Platform default |
| `audit_events` | DB | actor, entity ids, before/after JSON for row changes (PII inside is confidential class) | Kept with the institution; reset with demo |
| `ai_usage_events` | DB | metadata only (`07 §5`) | Kept; reset with demo |
| `delivery_attempts` | DB | rendered message bodies (contain names and phones) → confidential; visible only to `notification.log.read` roles | Kept; reset with demo |
| Supabase auth logs | Supabase | sign-in events | Platform default |
| Load/bench results | `docs/planning/coolskool/results/`, `bench-results/` (git-ignored) | synthetic data only | Until superseded |

## 8. Incident response during the project

1. **Suspected data leak** (cross-tenant or cross-guardian): stop merging; reproduce with the generated suite; fix the policy in a new migration; rerun `pnpm test:security`; record in `12 §3` if a shortcut was involved. Demo data is synthetic, so no notification duty exists, but the rule is rehearsed as if it were real.
2. **Secret committed:** rotate the key in Supabase/Vercel immediately, purge from history (`git filter-repo`), add a gitleaks rule, note in the completion report.
3. **Cloud egress observed under `local_only`:** disable `AI_CLOUD_ENABLED`, capture the usage event, fix the policy resolver, add a regression test (C-62 variant).
4. **Reset ran against the wrong institution:** impossible by design (`is_demo` check); if a non-demo institution ever exists on the demo host, the drill is restore from the latest dump (`11 §6`).

## 9. Storage policy template (for F-STU-08 when it lands)

Bucket `institution-files`, private. Object path `<institution_id>/<entity>/<id>/<filename>`. Policies on `storage.objects`: SELECT where `app.is_member((storage.foldername(name))[1]::uuid)` and entity-level scope mirrors the table's RLS class; INSERT with the same predicate plus a size/type check in the action; no UPDATE; DELETE by admin roles only. Access via signed URLs valid 10 minutes; never public buckets.
