# T-006 — Auth: Supabase SSR clients, proxy, login/logout, demo login hints

| Field | Value |
|---|---|
| Lane / Day | B / Day 2 |
| Size | 1 agent-day |
| Critical path | yes |
| Review | security-reviewer + lead |
| Feature ids | F-IDN-02 |
| Depends on | T-002 (merged) |
| Migration | — |

## Business outcome
Demo users log in with email and password, sessions refresh silently, and the service-role client cannot be misused — the entry door for every demo step.

## Current repo state (verify before starting)
- No supabase clients yet: `ls src/lib/supabase 2>/dev/null | wc -l` → 0.
- No `middleware.ts`/`proxy.ts`: `ls src/proxy.ts src/middleware.ts 2>/dev/null`.
- `.env.local` populated from `pnpm db:start` output.

## Spec sections to read (only these)
- `04-architecture.md §3` (request paths, proxy = session refresh only).
- `07-security-and-ai-governance.md §1` T7, T13, `§4` (admin client guard).
- `11-operations.md §1` (env names), `§3` (demo accounts, login page hint rule).
- `12-decision-log.md` D7, D8, D23, D24 and §2 rows "@supabase/ssr", "Next.js".

## Files to inspect first
- `.env.example`; `eslint.config.mjs` (`no-restricted-imports` placeholder from T-001); `src/app/layout.tsx`.

## Expected changes
- `src/lib/supabase/client.ts` — `createBrowserClient<Database>(url, publishableKey)`.
- `src/lib/supabase/server.ts` — `createServerClient` with `cookies()` `getAll/setAll` (async cookies API); exported `createClient()` and `getClaims()` wrapper.
- `src/lib/supabase/admin.ts` — `import 'server-only'`; factory using `SUPABASE_SECRET_KEY`; throws unless `process.env.SERVICE_ROLE_CALLER` ∈ {`seed`,`reset`,`jobs`,`test`}; ESLint `no-restricted-imports` finalised to allow only `scripts/**`, `src/modules/jobs/**`, `tests/**`.
- `src/proxy.ts` — `export async function proxy(request)` + `config.matcher` excluding static assets and `/s/`, `/api/public`; calls `updateSession` (refresh cookies, `getClaims()`); redirects unauthenticated requests under `/(tenant)` paths to `/login?next=`. No role or membership logic.
- `src/app/(auth)/login/page.tsx` + `actions.ts` — email/password `signInWithPassword` server action returning the envelope; `next` redirect validation (same-origin path only); demo accounts panel rendered only when the single institution has `is_demo = true` (query via anon-safe RPC `app.demo_login_hint()` created here? — no new migration: read `institutions` with the user-less server client is blocked by RLS, so expose the hint via env `NEXT_PUBLIC_DEMO_LOGIN_HINTS=true` set by seed docs; record as assumption).
- `src/app/(auth)/logout/route.ts` — POST signs out and redirects to `/login`.
- `src/app/page.tsx` — redirects to `/login` when unauthenticated, else to the institution picker (T-007 completes it; stub redirect to `/login` for now).

## Must not modify
- `supabase/**`; `docs/**`.

## Permissions / nav / migration numbers needed from the lead
- None.

## Security and data-integrity requirements
- Never call `getSession()` server-side for trust decisions; use `getClaims()`.
- Open-redirect guard on `next`; login errors are generic ("Invalid email or password").
- Admin client never imported by a client component or a page (lint + guard test).
- Demo password never hard-coded in `src/`; hint panel shows emails only.

## Acceptance criteria
1. Login with a user created via the admin API in a test succeeds and sets cookies; wrong password shows the generic error.
2. Visiting `/st-josephs-demo/dashboard` unauthenticated redirects to `/login?next=/st-josephs-demo/dashboard`; after login, lands there (T-007 renders it; until then expect 404 after redirect — assert the redirect only).
3. `next=https://evil.example` is ignored (lands on `/`).
4. `pnpm lint` fails when a test file imports `@/lib/supabase/admin` from `src/app/**` (prove with a temporary file, then delete it; report the lint output).
5. Admin factory throws when `SERVICE_ROLE_CALLER` is unset (unit test).
6. `src/middleware.ts` does not exist; `src/proxy.ts` exports `proxy`.

## Tests (write failing tests first) and exact commands
- `tests/unit/admin-client-guard.test.ts` — criterion 5.
- `tests/unit/login-redirect.test.ts` — `next` validator.
- `e2e/auth.spec.ts` — J-00 subset: login, redirect, logout.
- Commands: `pnpm test -- tests/unit/admin-client-guard.test.ts tests/unit/login-redirect.test.ts`, `pnpm test:e2e -- e2e/auth.spec.ts`.

## Deliverables
- Clients, proxy, login/logout, lint rule, tests, completion report.

## Assumptions and risks
- `@supabase/ssr` 0.12 API as in `12 §2`; confirm `getClaims` exists via `docs-lookup`.
- Demo hint via `NEXT_PUBLIC_DEMO_LOGIN_HINTS` is a shortcut; add a DBT row proposal in the report.

## Completion report
Use the format in `CLAUDE.md`.
