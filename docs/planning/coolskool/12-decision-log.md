# 12 — Decision log

Each ADR: **Decision** · **Context** · **Options** · **Choice and trade-offs** · **Revisit trigger** · **Evidence**. Phase 0 verified facts in §2; debt register in §3. Add new ADRs at the end (D25+); never edit a decision in place — supersede it.

## 1. ADRs

### D1 — Single Next.js App Router app, modular monolith
- **Decision:** one deployable under `src/modules/<domain>/`; no monorepo.
- **Context:** one laptop, 20 days, four parallel lanes, no ops team.
- **Options:** (a) monorepo with packages per domain; (b) separate services (API, worker, web); (c) single app with module folders.
- **Choice:** (c). Trade-off: one build and one dependency graph for everyone; mitigated by file ownership (`09 §3`) and module import rules (`04 §2`).
- **Revisit:** a second deployable is needed (mobile BFF, long-running worker).
- **Evidence:** prompt §6; Next 16 docs (Node runtime, Turbopack).

### D2 — pnpm
- **Decision:** pnpm 11, no workspaces.
- **Options:** npm; yarn; pnpm.
- **Choice:** pnpm (installed, fast, strict peer resolution exposes AI SDK/Zod mismatches early).
- **Revisit:** never in this phase. **Evidence:** `02 §2`.

### D3 — Supabase Postgres, SQL migrations, supabase-js with generated types, no ORM
- **Context:** RLS is the security backbone; every query must run as the user.
- **Options:** (a) Drizzle/Prisma with a pooled connection (bypasses RLS unless `set role` per request); (b) PostgREST via supabase-js with generated types; (c) raw `pg` with manual role switching.
- **Choice:** (b) plus `security definer` SQL functions for multi-table transactions. Trade-off: SQL functions are tested only by DB-integration tests; accepted.
- **Revisit:** more than three defects traced to hand-written SQL composition.
- **Evidence:** Supabase local-development and migration docs (§2).

### D4 — Single database, `institution_id` everywhere, RLS via `security definer` helpers on `memberships`
- **Options:** (a) custom JWT claims via the access-token hook; (b) schema-per-tenant; (c) helper functions reading `memberships`.
- **Choice:** (c), helpers in non-exposed `app` schema with `set search_path = ''` and `(select auth.uid())`. Trade-off: one indexed lookup per policy evaluation; claims would be faster but refresh only on token reissue and complicate multi-institution users.
- **Revisit:** policy evaluation > 5 ms p95 at demo scale (measure Day 15) → consider claims for role only.
- **Evidence:** Supabase RLS and custom-claims guidance (§2).

### D5 — Path-based tenant routing, public site at `/s/[slug]`
- **Options:** subdomain per institution now; path-based now with subdomain rewrite later.
- **Choice:** path-based; `proxy.ts` can rewrite subdomains later without touching pages.
- **Revisit:** custom domains (F-WEB-05). **Evidence:** D24 (proxy is Node-only and supports rewrites).

### D6 — Two-layer authorization with a static TypeScript permission matrix
- **Options:** (a) RLS only; (b) application checks only; (c) both, matrix in code; (d) both, matrix in a table.
- **Choice:** (c). RLS uses coarse role sets mirroring the matrix's read columns; a generated suite asserts consistency (C-01, C-03). Trade-off: role changes need a deploy.
- **Revisit:** F-IDN-05. **Evidence:** `07 §2`, `05 §5`.

### D7 — Server Actions for authenticated mutations; Route Handlers for public/AI/cron; uniform envelope
- **Context:** Next 16 Server Functions bypass proxy matchers; every action re-verifies.
- **Options:** REST route handlers for everything; tRPC; Server Actions.
- **Choice:** Server Actions + `defineAction` wrapper (validation, permission, envelope, registry). Trade-off: harder to call from non-browser clients; acceptable for the demo.
- **Revisit:** mobile app or partner API. **Evidence:** Next 16 proxy docs (§2).

### D8 — Service-role allow-list
- **Decision:** service role only in seed/reset, the job runner, and named `security definer` functions (`07 §4`); admin client guarded by `SERVICE_ROLE_CALLER` and an ESLint import restriction.
- **Options:** free use of service role in actions (fast, unsafe); allow-list.
- **Choice:** allow-list. **Revisit:** a worker service is split out. **Evidence:** threat T7.

### D9 — AI via Vercel AI SDK v7 behind one gateway
- **Context:** no cloud key; a 6 GB GPU; policies must be enforceable and testable.
- **Options:** (a) direct Anthropic SDK + direct Ollama HTTP; (b) AI SDK with providers; (c) LangChain.
- **Choice:** (b): `generateText` + `Output.object` for Zod output; `createUIMessageStreamResponse` for streaming; local provider `ai-sdk-ollama@^4.6` (peer `ai@^7`, structured outputs documented), alternative `ollama-ai-provider-v2@^4`; cloud `@ai-sdk/anthropic@^4`. Model ids are configuration: `AI_CLOUD_MODEL_QUALITY` default `claude-sonnet-5`, `AI_CLOUD_MODEL_CHEAP` default `claude-haiku-4-5` (dateless; successors `claude-sonnet-5-5` and `claude-haiku-5-5` switchable by env). Local model `qwen3:4b-instruct-2507-q4_K_M` primary (≈4 GB VRAM at 8k context, Apache-2.0, non-thinking), `qwen2.5:3b` fallback (on disk; Qwen research licence — review before commercial use). Trade-off: a community Ollama provider may lag AI SDK releases; swap is one file.
- **Revisit:** after T-040 measurements, or when a cloud key exists.
- **Evidence:** §2 rows AI SDK, Ollama providers, local models, pricing.

### D10 — Jobs table + cron route + CLI runner
- **Options:** external queue (SQS, Upstash, pg-boss); jobs table with `SKIP LOCKED`.
- **Choice:** jobs table (`05 §2.1`, W12). Trade-off: minimum latency equals the cron interval (5 min) unless `pnpm jobs:run` is triggered; acceptable for notifications in a demo.
- **Revisit:** > 10k jobs/day or sub-minute latency requirements. **Evidence:** Postgres `FOR UPDATE SKIP LOCKED` semantics.

### D11 — In-app notifications real; SMS/email simulated and labeled
- **Options:** integrate a free SMS trial; simulate.
- **Choice:** simulate behind one `Channel` interface, visible message log with badge. Trade-off: no real delivery in the demo (stated on screen).
- **Revisit:** DLT-registered SMS provider key. **Evidence:** `02 §4`.

### D12 — Data-driven website with immutable page versions; enquiry via rate-limited SQL function
- **Options:** static site generator; CMS integration; JSON blocks in Postgres.
- **Choice:** JSON blocks with eight types, publish pointer on `pages`. Trade-off: no visual editing; forms per block are enough for a demo.
- **Revisit:** F-WEB-06. **Evidence:** W3, C-80.

### D13 — Finance: offline payments, FY-sequenced receipts, immutable rows, minimal double-entry ledger
- **Options:** single-entry "paid amount" on invoices; full accounting module; minimal ledger.
- **Choice:** minimal ledger with five accounts; void/refund by reversing entries is P1 (F-FIN-09). Trade-off: no cheque clearing state (DBT-14).
- **Revisit:** gateway integration or accountant export requirements. **Evidence:** domain research (§2): gap-free FY receipts are the norm.

### D14 — Exams: paper-level versioned marks, immutable result snapshots, recheck state machine
- **Options:** mutable marks with an edit log; versioned rows.
- **Choice:** versioned rows (`superseded_by`), snapshots at publish, recheck as the only correction path after publish. Trade-off: more rows; simpler reasoning and audit.
- **Revisit:** per-question marking (F-EXM-08). **Evidence:** prompt §6; W7/W8.

### D15 — UUID v4 primary keys; human numbers from row-locked sequences with pattern strings
- **Options:** bigserial PKs; UUID v7; UUID v4.
- **Choice:** v4 (`gen_random_uuid()`), seed uses v5 for determinism; business numbers rendered from `settings.numbering` patterns (`{FY}`, `{YYYY}`, `{SEQ:n}`). Trade-off: random PKs are index-unfriendly at scale; irrelevant at demo scale.
- **Revisit:** tables > 50M rows. **Evidence:** C-06.

### D16 — Tailwind v4 (CSS-first) + shadcn/ui + Recharts + lucide
- **Options:** MUI; Chakra; Tailwind + shadcn.
- **Choice:** Tailwind v4 with `@import "tailwindcss"` and no config file; shadcn components copied into the repo. **Revisit:** none. **Evidence:** §2 versions.

### D17 — Vitest (`test.projects`) + Playwright + ESLint flat config + tsc; no pgTAP
- **Options:** pgTAP for SQL; Jest; Vitest.
- **Choice:** one JS stack; SQL tested through per-role clients. Trade-off: SQL unit tests are slower than pgTAP; fewer tools to learn.
- **Revisit:** SQL function count > 30. **Evidence:** Next.js Vitest guide (§2).

### D18 — Demo on Vercel + hosted Supabase `ap-south-1`; dev on local Supabase; hybrid/on-prem documented only
- **Options:** demo from the laptop; hosted.
- **Choice:** hosted for reliability at the venue, laptop Ollama shown as the local-inference path; screen recording as a backup (`09 §8`).
- **Revisit:** Phase 5. **Evidence:** `02 §3`.

### D19 — Deterministic seed and guarded dynamic demo reset
- **Decision:** PRNG `mulberry32(20261028)`, UUID v5 ids, fixed 2026 dates, named demo entities (`05 §8.1`); `app.demo_reset` discovers tenant tables by the `institution_id` column and deletes in FK-topological order, refuses non-demo institutions, requires `DEMO_RESET_ALLOWED`.
- **Options:** static delete list per table (breaks when modules add tables); dynamic discovery.
- **Choice:** dynamic. Trade-off: slightly more PL/pgSQL; no maintenance.
- **Revisit:** a tenant table without `institution_id` (forbidden by convention). **Evidence:** C-04.

### D20 — Append-only audit via `app.audit()`; revision triggers on marks, payments, results, memberships
- **Options:** application-level logging only; DB triggers.
- **Choice:** both: helper for intent-level events, triggers for row-level before/after on sensitive tables. **Revisit:** retention policy (F-IDN-14). **Evidence:** C-07.

### D21 — `cacheComponents: false`; dynamic rendering by default
- **Context:** `create-next-app` for Next 16 enables Cache Components and partial prefetching, requiring `<Suspense>` around every runtime read and failing the build otherwise.
- **Options:** adopt Cache Components now; disable.
- **Choice:** disable for the demo; opt in per route later with `'use cache'`. Trade-off: no static shells; the app is authenticated and the public site is small.
- **Revisit:** L4 public-site results. **Evidence:** Next 16 caching docs (§2).

### D22 — Node 22.12+, TypeScript `^5.9`, Zod 4
- **Context:** `ai@7`, `supabase-js@2.118`, `vitest@5` require Node ≥ 22; TypeScript 7 is `latest` but Next 16 documents ≥ 5.1 and TS 7 compatibility with Next tooling is unverified; Ollama providers require Zod 4.
- **Choice:** pin as stated in `engines` and `.nvmrc`. **Revisit:** Next documents TS 7 support. **Evidence:** §2.

### D23 — Supabase key naming: publishable/secret
- **Decision:** `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`; T-002 records which keys the installed CLI prints and maps legacy names if needed. **Evidence:** Supabase SSR docs (§2).

### D24 — Request interceptor is `src/proxy.ts`
- **Decision:** `export function proxy()` (Node runtime) doing session refresh with `getClaims()` only; `middleware.ts` is deprecated in Next 16. **Revisit:** edge runtime requirement. **Evidence:** Next 16 upgrade guide (§2).

### D25 — Demo data must support every live step
- **Decision:** the seed ships a second exam in `marks_entry` with one unmarked paper, two accepted-not-enrolled applications (one sharing an existing guardian's phone), an unpaid Term 2 invoice for a named child, and section capacity 45, so steps 5, 7, 9–12 run live without preparation (`05 §8.1`).
- **Context:** the first draft seeded only a published exam, which would have forced the demo to publish 3,024 results of a new exam or skip the publish step.
- **Options:** publish the seeded exam live (3,024 notifications, slow); seed a small grade-scoped exam.
- **Choice:** grade-scoped `Periodic Test 2 (Grade X)`. **Revisit:** none. **Evidence:** `11 §10` script timing target.

### D26 — Fabric is the platform direction; CoolSkool is its first domain pack
- **Context:** on 2026-10-29 the owner set the long-term product as **Fabric**: a multi-domain intelligence platform with personal and institutional workspaces, hybrid local/cloud AI, domain packs, and approved agentic execution. Nothing in the current codebase implements those beyond what T-001…T-045 already plan.
- **Decision:** no change to the 20-day plan, packet scope, or demo branding. Keep four existing boundaries intact so later extraction stays cheap: (1) cross-cutting code lives in `src/lib/{auth,actions,ai,supabase}` and `app.*` SQL helpers, domain logic in `src/modules/<domain>`; (2) `profiles` is global (keyed by `auth.users`, no `institution_id`) and institution access exists only through `memberships` — never attach personal data to an institution row; (3) every model call goes through `src/lib/ai/gateway.ts` with policy resolved before any provider is instantiated, so privacy/cost/device routing extends one place; (4) AI output is a suggestion a human saves (CLAUDE.md rule 6).
- **Not now:** personal workspace, domain-pack registry, forecasting/simulation, module studio, entitlements/billing, on-device runtimes. Each needs its own ADR with a concrete use case and measurable benefit.
- **Revisit:** after T-045, before starting a second domain or any personal-account feature.

## 2. Phase 0 verified facts (2026-10-28)

Context7 MCP was not available in this session; versions come from the npm registry and official docs fetched by three read-only research agents. Items marked *unverified* are to be confirmed by T-001/T-002/T-035/T-040.

| Item | Fact | Source |
|---|---|---|
| Next.js | 16.4.3 stable; `proxy.ts` replaces `middleware.ts` (Node-only); Turbopack default; async `params/cookies`; `next lint` removed; `cacheComponents` default on in `create-next-app`; `revalidateTag(tag, profile)`, `updateTag()`; Server Functions bypass proxy matchers | nextjs.org docs (upgrading/version-16, caching, proxy) |
| React / TypeScript | React 19.3.1; TypeScript `latest` = 7.0.2 (pin ^5.9, D22) | npm registry |
| @supabase/supabase-js / @supabase/ssr | 2.118.0 / 0.12.7; `createServerClient` with cookies `getAll/setAll`; `getClaims()` recommended in server/proxy code; env `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | supabase.com/docs/guides/auth/server-side/nextjs |
| Supabase CLI | 2.122.0 via `pnpm add -D supabase`; `init/start/stop/migration new/db reset/db push/link`; `gen types typescript --local` (flags *unverified*); ports 54321/54322/54323/54324 (Mailpit) | supabase.com/docs/guides/local-development |
| Supabase CI | `supabase/setup-cli@v3` | github.com/supabase/setup-cli |
| RLS guidance | helpers `security definer set search_path = ''` in a non-exposed schema; wrap `(select auth.uid())`; index policy columns; custom claims refresh only on token reissue | supabase.com/docs/guides/database/postgres/row-level-security; custom-claims RBAC guide |
| Storage RLS | policies on `storage.objects` using `(storage.foldername(name))[1]` | supabase.com/docs/guides/storage/security/access-control |
| AI SDK | `ai` 7.0.155 (ESM, Node ≥ 22; peer zod ^3.25.76 or ^4.1.8); `Output.object`; `createUIMessageStreamResponse` + `toUIMessageStream`; `instructions` (was `system`), `onEnd` (was `onFinish`); `@ai-sdk/anthropic` 4.0.90; `@ai-sdk/react` 4.0.159 | ai-sdk.dev migration guide 7.0, structured data, chatbot |
| Ollama providers | `ai-sdk-ollama` 4.6.0 (peer ai ^7.0.137; structured outputs auto) · `ollama-ai-provider-v2` 4.1.0 (peer ai ^7, zod 4); no official provider | ai-sdk.dev community providers; npm READMEs |
| Ollama structured outputs | `format` accepts a JSON schema object; `think: false` for hybrid-thinking models; `temperature 0`; validate with Zod anyway | docs.ollama.com |
| Local models (6 GB) | `qwen3:4b-instruct-2507-q4_K_M` 2.5 GB disk, ≈4.0 GB VRAM @8k (estimate); `qwen2.5:3b` 1.9 GB (installed); `llama3.2:3b` ≈3.3 GB; `gemma3:4b` ≈4.6–5 GB (tight); desktop already uses ≈2.9 GB VRAM at rest (*measured once, varies*) | ollama.com/library; `nvidia-smi`, `ollama list` |
| Anthropic pricing | `claude-sonnet-5` $2/$10 per MTok (cache hit $0.20); `claude-haiku-4-5` $1/$5; successors `claude-sonnet-5-5` $2/$10, `claude-haiku-5-5` $0.10/$0.50 (≤100k prompt); batch 50% off; dated id `claude-haiku-4-5-20251001` *unverified* (dateless alias confirmed) | platform.claude.com pricing + models overview |
| Tailwind / shadcn | tailwindcss 4.3.3 (`@import "tailwindcss"`, `@tailwindcss/postcss`, no config file); shadcn CLI 4.23.0 (`pnpm dlx shadcn@latest init`) | tailwindcss.com, ui.shadcn.com |
| Recharts / lucide / zod | 3.10.1 / 1.63.0 / 4.6.7 | npm registry |
| Vitest / Playwright | vitest 5.0.5 (Node ^22.12), `@vitejs/plugin-react` 6.1.2, `test.projects` (*unverified*); `@playwright/test` 1.64.1 | npm registry; nextjs.org testing/vitest |
| Domain (CBSE private school) | Session Apr–Mar, two terms; grades Nursery–XII, Roman numerals; sections A–F, optimum 40; 9-point grading A1–E2, pass 33%; attendance 75% rule; fee heads and FY-prefixed gap-free receipts; admission funnel with no screening at entry level (RTE); guardian phone as identity; designations PGT/TGT/PRT; SMS templates | CBSE academic/affiliation documents, RTE Act, Haryana fee rules (public sources; defaults in `05 §4.1`) |

Unverified at planning time: exact `gen types` flags; `test.projects` syntax; TS 7 + Next 16; VRAM estimates; dated Haiku id; hosted Supabase capacity in `ap-south-1` on Day 18.

### Installed versions (T-001, 2026-10-29)

Context7 MCP was unavailable in this environment too; versions and syntax below were confirmed empirically (installed package types, `--help` output, and a green `pnpm build`/`pnpm test:e2e`), resolving the "unverified at planning time" items above.

| Package | Installed version | Notes |
|---|---|---|
| next | 16.4.3 | `create-next-app` enables `cacheComponents: true` and `partialPrefetching: true` by default (confirmed D21's assumption); explicitly set `cacheComponents: false` in `next.config.ts`. No `--turbopack` CLI flag exists anymore — Turbopack is the default bundler; create-next-app wires Tailwind through a `turbopack.rules["*.css"]` loader (`@tailwindcss/turbopack`), not `postcss.config.mjs` — no postcss config was added (see note below). `next typegen` must run once before a standalone `tsc --noEmit` succeeds (generates the `LayoutProps`/`PageProps` ambient types under `.next/types/`); `typecheck` script is `next typegen && tsc --noEmit`. `middleware.ts` is gone; `proxy.ts` is added in T-006 per D24. |
| react / react-dom | 19.3.0 | create-next-app pinned exact `19.3.0`; registry has `19.3.1`. Left as installed — not a required bump. |
| typescript | 5.9.3 | Pinned `^5.9` in `devDependencies` per D22 (resolves to 5.9.3, not the TS7 `latest`). |
| tailwindcss | 4.3.3 | CSS-first; `@import "tailwindcss"` in `src/app/globals.css`. No `tailwind.config.*` and no `postcss.config.mjs` (Turbopack handles it; see next.js note above) — the packet's assumption of a `postcss.config.mjs` file didn't hold for the Turbopack-default setup. |
| shadcn CLI | 4.23.0 | `pnpm dlx shadcn@latest init -y -b radix -p nova` (non-interactive requires `-b <base>` and `-p <preset>`; `-y` alone still prompts). Base `radix`, preset `nova` (Lucide/Geist) to match CLAUDE.md's pinned `lucide-react`. Components added: `pnpm dlx shadcn@latest add button input card table badge dialog select sonner -y`. |
| vitest | 5.0.5 | `test.projects` syntax confirmed from `vitest/dist/chunks/plugin.d.*.d.ts`: root `test.projects: TestProjectConfiguration[]`, each entry `{ extends: true, test: { name, environment, include } }`. Vitest 5 exits 1 on zero matched tests by default; `test:db`/`test:security` scripts need `--passWithNoTests` to meet the "zero tests, exit 0" acceptance criterion. |
| @playwright/test | 1.64.1 | `playwright install chromium` (no `--with-deps`; this machine has no passwordless sudo, so OS-level browser deps weren't installed — CI's runner should install them with `--with-deps` since it runs as root). |
| @vitejs/plugin-react | 6.1.2 | Per stack pin; used in `vitest.config.mts` alongside `vite-tsconfig-paths`. |

**File-path conflict found and resolved:** `CLAUDE.md`'s folder conventions name the honesty-badge component `src/components/honesty.tsx`, but the T-001 packet text named it `src/components/simulated-badge.tsx`. Followed CLAUDE.md (every later packet imports against its declared paths) — component is at `src/components/honesty.tsx` exporting `SimulatedBadge` and `LimitedBadge`.

### Installed versions (T-002, 2026-10-29)

| Package | Installed version | Notes |
|---|---|---|
| supabase (CLI) | 2.122.0 | `pnpm supabase init` then `pnpm supabase start`. |

**D23 resolved — key names the installed CLI prints:** `supabase status -o json` (and `supabase start`) print **both** families: the new `PUBLISHABLE_KEY` / `SECRET_KEY` (`sb_publishable_...` / `sb_secret_...`) **and** the legacy JWT `ANON_KEY` / `SERVICE_ROLE_KEY`. Mapped to `11 §1` names as: `PUBLISHABLE_KEY` → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SECRET_KEY` → `SUPABASE_SECRET_KEY` (new names preferred, legacy ignored). `DB_URL` → `SUPABASE_DB_URL`, `API_URL` → `NEXT_PUBLIC_SUPABASE_URL`. Ports confirmed exactly as `11 §2`: API 54321, DB 54322, Studio 54323, Mailpit 54324.

**`gen types` exact command:** `supabase gen types typescript --local > src/lib/db/types.ts` (the positional `typescript` language argument still works alongside `--local`; `--lang` defaults to `typescript` either way). Output is unformatted (`npx oxfmt` suggested by the CLI); left unformatted since it's a generated/non-hand-edited file and running an unreviewed package via `npx` was denied by the sandbox.

**`config.toml` adjustments from the CLI's default:** default `[api] schemas` omits `storage` (`["public", "graphql_public"]`) — added `storage` per the packet. `[auth] site_url` defaults to `http://127.0.0.1:3000` — changed to `http://localhost:3000` per the packet. `[auth] enable_signup` defaults `true` — set `false`. `[auth.email] enable_confirmations` was already `false` by default — no change needed.

## 3. Debt register

Each shortcut: reason · demo effect · production risk · resolution trigger · follow-up.

| ID | Shortcut | Reason | Demo effect | Production risk | Trigger | Follow-up |
|---|---|---|---|---|---|---|
| DBT-01 | SMS/email simulated | No provider keys | Message log with badge | None (labeled) | Provider contract signed | F-COM-02 |
| DBT-02 | Concurrency caps per process | Serverless | Caps may be exceeded across instances; DB quota still holds | Overspend on cloud AI | First cloud key | Move cap to a DB advisory lock |
| DBT-03 | Static permission matrix | Time | Roles fixed | Per-school role needs | Second customer | F-IDN-05 |
| DBT-04 | No payment void/refund | Time | Mistakes need reversing entries by SQL | Accountant workflow gap | First real school | F-FIN-09 |
| DBT-05 | Student portal shares guardian UI | Time | Student login works, same screens | None | Phase 2 | F-STU-11 |
| DBT-06 | Honeypot + rate limit only on public form | No CAPTCHA key | Spam risk low on demo | Spam on real sites | Public launch | Add Turnstile |
| DBT-07 | Prompt built only from curriculum text; redactor regex-based | Safety by construction | Limited AI features | Leak if features widen without review | Any prompt using student data | `07 §5` review |
| DBT-08 | Accessibility smoke only | Time | Serious violations fixed; no full audit | Compliance | Phase 2 | a11y audit |
| DBT-09 | Load tests on one laptop + one region | Environment | Indicative numbers | Mis-sizing | Real usage data | F-PLT-07 |
| DBT-10 | Backup drill once, manual | Time | Known restore path | RPO/RTO undefined | Hosting a real school | Backup policy |
| DBT-11 | Demo login hints via `NEXT_PUBLIC_DEMO_LOGIN_HINTS` env flag | No anon read on `institutions` | Hint list on login page | Must be off on any non-demo deployment | First non-demo tenant | Per-institution flag read by a `security definer` function |
| DBT-12 | Enrolment does not provision a guardian login | No invite flow (email/SMS simulated) | Live-enrolled guardian cannot log in; seeded guardians can | Onboarding gap | Real SMS/email channel | Invite job + magic link (F-IDN-07 scope) |
| DBT-13 | Mid-session admissions billed the full term | Time | Live enrolment shows a full Term 2 invoice | Fee disputes | First real school | Pro-rata rule in `generate_invoice` (settings) |
| DBT-14 | Cheques counted as received when recorded | Time | No bounce handling | Reconciliation errors | First real school | Clearing state + reversal (with F-FIN-09) |
| DBT-15 | `runStructured` `feature` is a free string written to `ai_usage_events.feature` | No callers yet (T-035) | None | Unbounded/misspelled feature keys in usage reports | First caller (T-036) | Type `feature` as a literal union of real features |
| DBT-16 | `estimateCost` returns $0 for an unknown model id, silently | Never block a call on a missing price | None (cloud off) | `/ai/usage` understates spend if `AI_CLOUD_MODEL_*` is misconfigured | First cloud key | Flag unpriced models on `/ai/usage` |
| DBT-17 | "Class S" SELECT policies in 0004/0005 grant every `app.staff_roles()` member | Packet RLS classes were coarser than the `07 §2.2` matrix; found in the T-014 review (attendance was narrowed to the matrix before merge) | None visible in UI | Any staff JWT can read those tables directly via PostgREST beyond its `*.read` permission | T-042 | Diff each S-class policy against `07 §2.2`; narrow where a role has no read permission; encode in `rls-expectations.ts` |
