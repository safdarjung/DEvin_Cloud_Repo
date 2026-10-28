# 12 — Decision log

Format per ADR: decision · context · options · choice and trade-offs · revisit trigger · evidence. Phase 0 facts in §2; debt register in §3.

## 1. ADRs

**D1 — Single Next.js App Router app, modular monolith.** Context: one laptop, 20 days, four lanes. Options: monorepo with packages; microservices; single app. Choice: single app, `src/modules/<domain>`, no monorepo. Trade-off: shared build; mitigated by file ownership (`09 §3`). Revisit: when a second deployable (mobile BFF, worker) is needed. Evidence: prompt §6.

**D2 — pnpm.** Installed 11.10; workspace-free. Revisit: never for this phase.

**D3 — Supabase Postgres, CLI SQL migrations, supabase-js with generated types, no ORM.** Options: Drizzle/Prisma over RLS; raw SQL. Choice: SQL migrations + generated types; business rules in SQL functions where transactions span tables. Trade-off: less type help in SQL; mitigated by DB-integration tests. Revisit: if query composition becomes error-prone (> 3 bugs from hand-written SQL). Evidence: Supabase local dev + migration docs (§2).

**D4 — Single DB, `institution_id` everywhere, RLS via `security definer` helpers on `memberships`.** Options: custom JWT claims (access-token hook); schema-per-tenant. Choice: helpers in non-exposed `app` schema reading `memberships` (claims refresh only on token reissue; DB read is always current and supports multi-institution users). Trade-off: one extra indexed lookup per policy; cached via `(select auth.uid())`. Revisit: if policy latency > 5 ms p95 at 3,000 users (measure Day 15). Evidence: Supabase RLS docs recommend `security definer set search_path = ''` helpers in a non-exposed schema (§2).

**D5 — Path-based tenant routing `(tenant)/[institution]`, public site `/s/[slug]`.** Subdomains later via `proxy.ts` rewrite. Revisit: custom domains (F-WEB-05).

**D6 — Two-layer authorization; static TS permission matrix.** RLS for data, `requirePermission` in actions; matrix in one file, snapshot-tested against `07 §2`; RLS uses coarse role sets that mirror the matrix's read columns with a generated consistency suite. Revisit: F-IDN-05 (table-driven).

**D7 — Server Actions for authenticated mutations, Route Handlers for public/AI/cron; uniform envelope.** Next 16 note: Server Functions bypass proxy matchers, so every action re-verifies session and membership. Revisit: none.

**D8 — Service-role allow-list.** Seed/reset, job runner, named `security definer` functions (`07 §4`). Admin client guarded by `SERVICE_ROLE_CALLER` + ESLint import restriction. Revisit: when a worker service is split out.

**D9 — AI via Vercel AI SDK; gateway enforces policy, quota, redaction, logging.** AI SDK is at major 7 (ESM-only, Node 22): `generateText` + `Output.object` for Zod output; `createUIMessageStreamResponse` for streaming. Local provider `ai-sdk-ollama@^4.6` (peer `ai@^7`, structured outputs confirmed in its README); alternative `ollama-ai-provider-v2@^4`; no official Ollama provider exists. Cloud `@ai-sdk/anthropic@^4`. Model ids are configuration (`AI_CLOUD_MODEL_QUALITY` default `claude-sonnet-5`, `AI_CLOUD_MODEL_CHEAP` default `claude-haiku-4-5`, both dateless); docs list `claude-sonnet-5` and `claude-haiku-4-5` as still available with `claude-sonnet-5-5` ($2/$10) and `claude-haiku-5-5` (from $0.10/$0.50) as current successors — switch by env when a key exists. Local model `qwen3:4b-instruct-2507-q4_K_M` primary (≈4 GB VRAM at 8k context, Apache-2.0, non-thinking), `qwen2.5:3b` fallback (already on disk; Qwen research licence — not for commercial use without review). Revisit: after T-040 measurements. Evidence: §2 items 3, 7–9, 11.

**D10 — Jobs table + cron route + CLI runner, no queue service.** `claim_job` with `FOR UPDATE SKIP LOCKED`, backoff, dead-letter. Revisit: > 10k jobs/day or sub-second latency needs.

**D11 — Notifications real in-app; SMS/email simulated and labeled.** Adapters behind one interface; DLT-registered SMS later. Revisit: when a provider key exists.

**D12 — Data-driven website with immutable page versions; enquiry via rate-limited function.** No visual editor. Revisit: F-WEB-06.

**D13 — Finance: offline payments, FY-sequenced receipts, immutable payments/receipts/lines, minimal double-entry ledger.** Void/refund via reversing entries is P1 (F-FIN-09). Revisit: gateway (F-FIN-08).

**D14 — Exams: paper-level versioned marks, immutable results snapshots, recheck state machine.** Per-question marks, scripts, OCR later. Revisit: F-EXM-07.

**D15 — UUID v4 PKs; human numbers from row-locked `institution_sequences` with pattern strings.** Gap-free per key; FY-scoped keys for invoices/receipts. Revisit: none.

**D16 — Tailwind v4 (CSS-first, no config file) + shadcn/ui + Recharts + lucide.** Versions in §2. Revisit: none.

**D17 — Vitest (`test.projects`) + Playwright + ESLint flat config + tsc; no pgTAP.** Async server components tested via E2E. Revisit: none.

**D18 — Demo: Vercel + hosted Supabase `ap-south-1`; dev: local Supabase; hybrid/on-prem documented only.** Revisit: Phase 5.

**D19 — Deterministic seed (mulberry32 seed 20261028, UUID v5 ids) and guarded `demo:reset` via a dynamic `app.demo_reset`.** The reset function discovers tenant tables (`institution_id` column) and orders deletes by FK topology at runtime, so new modules need no reset changes; it refuses non-demo institutions and requires `DEMO_RESET_ALLOWED`. Revisit: if a tenant table legitimately lacks `institution_id` (forbidden by convention).

**D20 — Append-only `audit_events` via `app.audit()`; revision triggers on marks, payments, results, memberships.** Revisit: retention policy (F-IDN-14).

**D21 — `cacheComponents: false`; dynamic rendering by default.** Context: `create-next-app` for Next 16 enables Cache Components + partial prefetching, which require `<Suspense>` around every runtime read and error at build otherwise. Choice: disable for the demo; opt in per route later with `'use cache'`. Trade-off: no static shells; acceptable for an authenticated app and a small public site. Revisit: public-site performance work (L4 results).

**D22 — Node 22.12+ engine, TypeScript pinned to `^5.9`, Zod 4.** Context: `ai@7`, `supabase-js@2.118`, `vitest@5` require Node ≥ 22; TypeScript 7 is `latest` but Next 16 documents ≥ 5.1 and TS 7 compatibility with Next tooling is unverified; `ollama` providers require Zod 4. Revisit: when Next documents TS 7 support.

**D23 — Supabase key naming: publishable/secret.** `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`; local CLI prints both legacy (anon/service_role JWT) and new keys — T-002 records which the installed CLI emits and maps them. Revisit: none.

**D24 — Request interceptor is `src/proxy.ts` (`export function proxy`)** on Next 16; `middleware.ts` is deprecated. Only session refresh with `getClaims()`; no authorization. Revisit: if edge runtime is ever required.

## 2. Phase 0 verified facts (2026-10-28)

Context7 MCP was not available in this session; versions come from the npm registry and official docs fetched by three read-only research agents. Items marked *unverified* are to be confirmed by T-001/T-002/T-035/T-040.

| Item | Fact | Source |
|---|---|---|
| Next.js | 16.4.3 stable; `proxy.ts` replaces `middleware.ts` (Node-only); Turbopack default; async `params/cookies`; `next lint` removed; `cacheComponents` default on in `create-next-app`; `revalidateTag(tag, profile)`, `updateTag()` | nextjs.org docs (upgrading/version-16, caching, proxy) |
| React / TypeScript | React 19.3.1; TypeScript `latest` = 7.0.2 (pin ^5.9, D22) | npm registry |
| @supabase/supabase-js / @supabase/ssr | 2.118.0 / 0.12.7; `createServerClient` with cookies `getAll/setAll`; `getClaims()` recommended in server/proxy code; env `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | supabase.com/docs/guides/auth/server-side/nextjs |
| Supabase CLI | 2.122.0 via `pnpm add -D supabase`; `init/start/stop/migration new/db reset/db push/link`; `gen types typescript --local` (flags *unverified*); ports 54321/54322/54323/54324 (Mailpit) | supabase.com/docs/guides/local-development |
| Supabase CI | `supabase/setup-cli@v3` | github.com/supabase/setup-cli |
| RLS guidance | helpers `security definer set search_path = ''` in non-exposed schema; wrap `(select auth.uid())`; index policy columns; custom claims refresh only on token reissue | supabase.com/docs/guides/database/postgres/row-level-security; custom-claims RBAC guide |
| Storage RLS | policies on `storage.objects` using `(storage.foldername(name))[1]` | supabase.com/docs/guides/storage/security/access-control |
| AI SDK | `ai` 7.0.155 (ESM, Node ≥ 22; peer zod ^3.25.76 or ^4.1.8); `Output.object`; `createUIMessageStreamResponse` + `toUIMessageStream`; `instructions` (was `system`), `onEnd` (was `onFinish`); `@ai-sdk/anthropic` 4.0.90; `@ai-sdk/react` 4.0.159 | ai-sdk.dev migration guide 7.0, structured data, chatbot |
| Ollama providers | `ai-sdk-ollama` 4.6.0 (peer ai ^7.0.137; structured outputs auto) · `ollama-ai-provider-v2` 4.1.0 (peer ai ^7, zod 4); no official provider | ai-sdk.dev community providers; npm READMEs |
| Ollama structured outputs | `format` accepts a JSON schema object; `think: false` for hybrid-thinking models; use `temperature 0`; validate with Zod anyway | docs.ollama.com |
| Local models (6 GB) | `qwen3:4b-instruct-2507-q4_K_M` 2.5 GB disk, ≈4.0 GB VRAM @8k (estimate); `qwen2.5:3b` 1.9 GB (installed); `llama3.2:3b` ≈3.3 GB; `gemma3:4b` ≈4.6–5 GB (tight); desktop already uses ≈2.9 GB VRAM at rest (*measured once, varies*) | ollama.com/library; `nvidia-smi`, `ollama list` |
| Anthropic pricing | `claude-sonnet-5` $2/$10 per MTok (cache hit $0.20); `claude-haiku-4-5` $1/$5; successors `claude-sonnet-5-5` $2/$10, `claude-haiku-5-5` $0.10/$0.50 (≤100k prompt); batch 50% off; dated id `claude-haiku-4-5-20251001` *unverified* (dateless alias confirmed) | platform.claude.com pricing + models overview |
| Tailwind / shadcn | tailwindcss 4.3.3 (`@import "tailwindcss"`, `@tailwindcss/postcss`, no config file); shadcn CLI 4.23.0 (`pnpm dlx shadcn@latest init`) | tailwindcss.com, ui.shadcn.com |
| Recharts / lucide / zod | 3.10.1 / 1.63.0 / 4.6.7 | npm registry |
| Vitest / Playwright | vitest 5.0.5 (Node ^22.12), `@vitejs/plugin-react` 6.1.2, `test.projects` (*unverified*); `@playwright/test` 1.64.1 | npm registry; nextjs.org testing/vitest |
| Domain (CBSE private school) | Session Apr–Mar, two terms; grades Nursery–XII with Roman numerals; sections A–F, optimum 40; 9-point grading A1–E2, pass 33%; attendance 75% rule; fee heads and FY-prefixed gap-free receipts; admission funnel with no screening at entry level (RTE); guardian phone as identity; designations PGT/TGT/PRT; SMS templates | CBSE academic/affiliation documents, RTE Act, Haryana fee rules (public sources; details in `05 §4.1` defaults) |

Unverified at planning time: exact `gen types` flags; `test.projects` syntax; TS 7 + Next 16; VRAM estimates; dated Haiku id; whether hosted Supabase in `ap-south-1` has capacity on Day 18.

## 3. Debt register

Each shortcut: reason · demo effect · production risk · resolution trigger · follow-up.

| ID | Shortcut | Reason | Demo effect | Production risk | Trigger | Follow-up |
|---|---|---|---|---|---|---|
| DBT-01 | SMS/email simulated | No provider keys | Message log with badge | None (labeled) | Provider contract signed | F-COM-02 |
| DBT-02 | Concurrency caps per process | Serverless | Caps may be exceeded across instances; DB quota still holds | Overspend on cloud AI | First cloud key | Move cap to DB advisory lock |
| DBT-03 | Static permission matrix | Time | Roles fixed | Per-school role needs | Second customer | F-IDN-05 |
| DBT-04 | No payment void/refund | Time | Mistakes need reversing entries by SQL | Accountant workflow gap | First real school | F-FIN-09 |
| DBT-05 | Student portal shares guardian UI | Time | Student login works, same screens | None | Phase 2 | F-STU-11 |
| DBT-06 | Honeypot + rate limit only on public form | No CAPTCHA key | Spam risk low on demo | Spam on real sites | Public launch | Add Turnstile |
| DBT-07 | Prompt built only from curriculum text; redactor regex-based | Safety by construction | Limited AI features | Leak if features widen without review | Any prompt using student data | `07 §5` review |
| DBT-08 | Accessibility smoke only | Time | Serious violations fixed; no full audit | Compliance | Phase 2 | a11y audit |
| DBT-09 | Load tests on one laptop + one region | Environment | Indicative numbers | Mis-sizing | Real usage data | F-PLT-07 |
| DBT-10 | Backup drill once, manual | Time | Known restore path | RPO/RTO undefined | Hosting a real school | Backup policy |
| DBT-11 | Demo login hints via `NEXT_PUBLIC_DEMO_LOGIN_HINTS` env flag | No anon read on `institutions` | Hint list on login page | Must be off on any non-demo deployment | First non-demo tenant | Replace with per-institution flag read by a `security definer` function |
