# Project status

Product: Fabric (public name) / CoolSkool (repo, package `coolskool`). AI-assisted school operating system for budget-conscious Indian private schools. Multi-tenant, Supabase RLS.

## Stack (package.json)
Next.js 16.4.3, React 19.3.0, Tailwind v4, shadcn + radix-ui, Supabase (`@supabase/ssr`, `supabase-js`), AI SDK `ai` 7.0.155 (`@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/groq`, `ai-sdk-ollama`), Zod 4, Vitest 5, Playwright, pnpm 11.

## What is live on main (per docs/planning/fabric/HANDOFF.md, .superpowers/sdd/)
- V1 M01-M18 + plug-in modules (MOD), M19 insights, M21 forecasts, M22 agents, X01 student leave + diary, X02 certificates + ID cards, X03 library, X05 WhatsApp, X06 exam seating, X07 visitors + gate pass, X08 PTM + surveys.
- Hosted Supabase holds every migration on main (HANDOFF, 2026-11-05).
- Counts in repo: 156 `defineAction(` call sites, 81 migration files (0001-0099 on main + 0100), tests/unit 133 files, tests/db 230, tests/security 13, 22 Playwright specs in e2e/.

## Not merged (WIP on remote branches, ungated)
lane-c (M20 mastery, M25 partial), lane-g (M23 workflows, 11/22), lane-i (X04 late fees, M25-T8), lane-j (M24 assistant, no review/gate). Source: HANDOFF.md "Paused 2026-11-05". M27 seed/security/V2 gate not run.

## This branch (feat/fabric-public-wave1, uncommitted)
Wave 1: marketing site `src/app/(marketing)` (15 public pages + 5 legal), `/select`, `/api/public/lead` + migration 0100 `platform_leads`, PWA (manifest, `public/sw.js`, `/offline`), SEO files (sitemap, robots, `llms.txt`, `for-agents.md`, JSON-LD), mobile bottom nav, `global-error`, `not-found`, route loading/error boundaries.
- Migration 0100 is NOT pushed to hosted. Owner runs: `pnpm exec supabase db push --linked --include-all`.

## UI-only
12 `/fabric/*` pages (agents, data, finance-intel, insights, learning, marketplace, operations, simulator, students, studio, trust, twin) render fixtures from `src/modules/fabric/demo`. No backend.

## Not implemented
AI credits wallet, BYOK, speech/TTS/STT, scenario/what-if engine (the `/fabric/simulator` page is fixture UI), health endpoint, error monitoring. See docs/KNOWN_LIMITATIONS.md.

## Verification state
- Last recorded gates are in .superpowers/sdd/gate-*.txt (e.g. M15, 2026-11-04: unit 1480, db 862/863, security 2225). Not re-run on this branch.
- Local vitest does not start (see KNOWN_LIMITATIONS). Local Docker absent; db/security suites run in CI only.
- Not measured: Lighthouse/CWV, real-device tests, WCAG audit.

## Docs index
docs/PRODUCT_GUIDE.md, FEATURE_MATRIX.md, ARCHITECTURE.md, DEPLOYMENT.md, SECURITY_PRIVACY.md, SEO_STRATEGY.md, AI_AND_BILLING.md, KNOWN_LIMITATIONS.md, DESIGN_SYSTEM.md.

Last verified: 2026-11-06 against branch feat/fabric-public-wave1

## Wave 1 migrations (branch feat/fabric-public-wave1)
- 0100 platform_leads (book-demo/contact; /api/public/lead returns an error until pushed to hosted).
- 0101 reserve_marketing_slugs (NOT VALID check; query hosted institutions for colliding slugs before pushing).
Both are owner-run: `pnpm exec supabase db push --linked --include-all`.

## Wave 2 (branch feat/fabric-public-wave1, uncommitted)
- Built on real backends (UI only, no backend changes): /fabric/insights, /fabric/agents, finance-intel, operations, learning, trust, data; dashboard + teacher /today insight/forecast widgets on non-demo tenants; Fabric nav gated by permission + module flag.
- Not built (no backend): simulator, twin, studio, marketplace purchasing, students success/interventions. Non-demo tenants see a "Planned" notice; demo tenants keep the skeleton. Mastery heatmap, budgets, late fees, workflows, connectors, model registry, consent: "Planned" placeholders.
- Unverified: never run against a real database (no Docker/.env.local here); vitest does not start locally; no 390px or dark-theme browser check of these pages.
- Known: finance-intel defaulters use listTermOptions()[0], which may not be the current term.
