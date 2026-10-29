# CoolSkool

AI-powered operating system for educational institutions, starting with budget-conscious private schools in Tier 2/3 India.

## Status

Scaffold + local dev (T-001, T-002) in place: Next.js 16 app, Tailwind v4, shadcn/ui, ESLint, Vitest, Playwright, Supabase local dev, type generation, and CI all wired and green.

## Local setup

```
pnpm install
pnpm db:start            # supabase start (Docker); prints local keys → copy into .env.local
pnpm db:reset            # applies migrations, regenerates types, runs seed
pnpm dev                 # http://localhost:3000
```

See `docs/planning/coolskool/11-operations.md §1-2` for environment variable names, ports, and the Ollama model pull.

- `docs/planning/coolskool/00-README.md` — index of the planning package (brief, architecture, data model, workflows, security, testing, 20-day plan, backlog, operations, decision log).
- `docs/planning/coolskool/tasks/` — one packet per implementation task (T-001 … T-045).
- `docs/planning/coolskool/00-planning-prompt.md` — the architect prompt that produced the package.
- `CLAUDE.md` — operating instructions for implementation agents.

## Intended stack

Next.js (App Router, TypeScript), Tailwind, Supabase (Auth, Postgres with RLS, Storage), Vercel, Vercel AI SDK with Anthropic (cloud) and Ollama (local), Zod, Vitest, Playwright, pnpm.

## Conventions

- Conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`, `perf:`, `ci:`.
- Never commit secrets. Environment variable names live in `.env.example` only.
