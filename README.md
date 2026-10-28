# CoolSkool

AI-powered operating system for educational institutions, starting with budget-conscious private schools in Tier 2/3 India.

## Status

Planning package complete (2026-10-28); awaiting review before implementation starts. No application code yet.

- `docs/planning/coolskool/00-README.md` — index of the planning package (brief, architecture, data model, workflows, security, testing, 20-day plan, backlog, operations, decision log).
- `docs/planning/coolskool/tasks/` — one packet per implementation task (T-001 … T-045).
- `docs/planning/coolskool/00-planning-prompt.md` — the architect prompt that produced the package.
- `CLAUDE.md` — operating instructions for implementation agents.

## Intended stack

Next.js (App Router, TypeScript), Tailwind, Supabase (Auth, Postgres with RLS, Storage), Vercel, Vercel AI SDK with Anthropic (cloud) and Ollama (local), Zod, Vitest, Playwright, pnpm.

## Conventions

- Conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`, `perf:`, `ci:`.
- Never commit secrets. Environment variable names live in `.env.example` only.
