# T-001 — Scaffold Next.js app, Tailwind, shadcn, lint, Vitest, Playwright

| Field | Value |
|---|---|
| Lane / Day | Lead / Day 1 |
| Size | 1 agent-day |
| Critical path | yes |
| Review | code-reviewer |
| Feature ids | F-IDN-01 (foundation), F-PLT-05 |
| Depends on | — |
| Migration | — |

## Business outcome
A runnable, lint-clean, type-clean Next.js 16 app with the full test toolchain wired, so every later packet starts from `pnpm dev`, `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build` all green on an empty project.

## Current repo state (verify before starting)
- Repo contains only `README.md`, `.gitignore`, `CLAUDE.md`, `docs/`: `ls -A` shows no `package.json`.
- Node ≥ 22.12 and pnpm 11: `node -v && pnpm -v`.

## Spec sections to read (only these)
- `CLAUDE.md` (root): Stack, Commands, Folder conventions.
- `04-architecture.md §2` (module layout), `§3` (rendering model, `cacheComponents: false`).
- `12-decision-log.md` D16, D17, D21, D22, D24 and §2 (versions).
- `08-testing-and-acceptance.md §1` (projects: unit/db/security, commands).

## Files to inspect first
- `.gitignore` (keep entries; do not duplicate).
- `README.md` (update the "Status" section only to say scaffold exists).

## Expected changes
- `package.json`: name `coolskool`, `engines.node >=22.12`, `packageManager` pnpm 11, scripts from `CLAUDE.md` (`db:*`, `seed`, `demo:reset`, `jobs:run`, `ai:bench` as `echo "not implemented (T-0NN)" && exit 1` stubs until their packets land).
- `next.config.ts`: `cacheComponents: false`, `typedRoutes` optional, no experimental flags.
- `tsconfig.json`: strict, `@/*` → `src/*`; `typescript@^5.9` pinned (D22).
- `src/app/layout.tsx`, `src/app/page.tsx` (placeholder redirect to `/login` later; plain page now), `src/app/globals.css` with `@import "tailwindcss";`.
- `postcss.config.mjs` with `@tailwindcss/postcss`; no `tailwind.config.*`.
- shadcn init (`pnpm dlx shadcn@latest init`) + components: button, input, card, table, badge, dialog, select, sonner/toast → `src/components/ui/*`; `src/components/simulated-badge.tsx` (`<SimulatedBadge />`, rule 7 in `CLAUDE.md`).
- `eslint.config.mjs`: flat config, Next + TS rules, `no-restricted-imports` entry for `@/lib/supabase/admin` with an allow-list comment (paths finalised in T-006).
- `vitest.config.mts`: `test.projects` → `unit` (`tests/unit/**`, node), `db` (`tests/db/**`, node), `security` (`tests/security/**`, node); `vite-tsconfig-paths`; `globalSetup` placeholder file `tests/setup/global.ts`.
- `playwright.config.ts`: baseURL `http://localhost:3000`, `webServer: pnpm dev`, chromium only, `e2e/` dir, one smoke spec `e2e/smoke.spec.ts` (home renders).
- `.env.example`: every name from `11-operations.md §1` with comments, no values.
- `.nvmrc` = `22`; `.github/` left for T-002.
- `tests/unit/sanity.test.ts` (one passing test so `pnpm test` is green).
- Append an "Installed versions" table (package → installed version) to `12-decision-log.md §2` — the only doc edit permitted in this packet.

## Must not modify
- `docs/planning/coolskool/*` except the §2 appendix above; `CLAUDE.md`; `.gitignore` semantics.

## Permissions / nav / migration numbers needed from the lead
- None.

## Security and data-integrity requirements
- No secrets anywhere; `.env.local` git-ignored (already). No `dangerouslySetInnerHTML`. No `middleware.ts` (D24 — proxy is added in T-006).

## Acceptance criteria
1. `pnpm install && pnpm lint && pnpm typecheck && pnpm build` exit 0.
2. `pnpm test` runs the `unit` project and passes; `pnpm test:db` / `pnpm test:security` run their projects with zero tests and exit 0.
3. `pnpm test:e2e` passes the smoke spec against `pnpm dev`.
4. `next.config.ts` contains `cacheComponents: false`; no `tailwind.config.*` exists; TypeScript installed is 5.9.x.
5. All scripts in `CLAUDE.md` exist in `package.json` (stubs clearly labelled with the owning packet).
6. `.env.example` lists exactly the names in `11 §1`.

## Tests (write failing tests first) and exact commands
- `tests/unit/sanity.test.ts` — asserts `true` and that `process.env.NODE_ENV` is defined.
- `e2e/smoke.spec.ts` — home page responds 200 and renders a heading.
- Commands: `pnpm test`, `pnpm test:e2e -- e2e/smoke.spec.ts`, `pnpm lint`, `pnpm typecheck`, `pnpm build`.

## Deliverables
- Scaffolded app, configs, stubs, `.env.example`, versions appended to `12 §2`, README status line, completion report.

## Assumptions and risks
- `create-next-app` prompts are answered non-interactively (`--ts --tailwind --app --src-dir --turbopack --import-alias "@/*"`); if it enables Cache Components by default, disable explicitly (D21).
- If TypeScript 7 is pulled transitively and breaks `next typegen`, pin `^5.9` (D22) and note it.
- Each new dependency beyond the stack list gets a one-line justification in the report.

## Completion report
Use the format in `CLAUDE.md`.
