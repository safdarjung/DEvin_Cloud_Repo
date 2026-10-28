# CoolSkool

AI-powered operating system for educational institutions, starting with budget-conscious private schools in Tier 2/3 India.

## Status

Planning stage. No application code yet.

- `docs/planning/coolskool/00-planning-prompt.md` — the architect prompt that produces the full planning package (architecture, data model, security, testing, 20-day plan, implementation task packets).
- The planning package itself is written by that run into `docs/planning/coolskool/`.

## Intended stack

Next.js (App Router, TypeScript), Tailwind, Supabase (Auth, Postgres with RLS, Storage), Vercel, Vercel AI SDK with Anthropic (cloud) and Ollama (local), Zod, Vitest, Playwright, pnpm.

## Conventions

- Conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`, `perf:`, `ci:`.
- Never commit secrets. Environment variable names live in `.env.example` only.
