# Task 2: M01-T2 Bearer-token server client — report

## What

Added `withBearerToken<T>(token, fn)` to `src/lib/supabase/server.ts`: module-private
`AsyncLocalStorage<string>` (`node:async_hooks`), opt-in only. Inside its scope:
- `createClient()` returns a plain `createSupabaseClient<Database>()` with
  `global.headers.Authorization = Bearer <token>` and
  `auth: { persistSession: false, autoRefreshToken: false }`, and never calls `cookies()`.
- `getClaims()` calls `supabase.auth.getClaims(token)` (explicit JWT arg — verifies via
  JWKS/network, never decode-only), same `error || !data` null-fallback as before.

Outside the scope, both functions are byte-for-byte the prior cookie-based behavior
(checked via `getStore() === undefined` guard).

## Files

- `src/lib/supabase/server.ts` (edit) — +31/-1
- `tests/db/bearer-client.test.ts` (new)

## RED

Command: `pnpm test:db -- tests/db/bearer-client.test.ts` (run against the file with the
server.ts change reverted to HEAD).

Result: 4 failed as expected —
```
TypeError: withBearerToken is not a function
 ❯ tests/db/bearer-client.test.ts:38:26  (getClaims inside withBearerToken returns the token's user)
 ❯ tests/db/bearer-client.test.ts:44:26  (garbage token -> getClaims null)
 ❯ tests/db/bearer-client.test.ts:52:24  (createClient under a teacher token reads memberships as that teacher only)
 ❯ tests/db/bearer-client.test.ts:70:11  (scope does not leak after fn resolves)
Test Files  1 failed | 51 passed (52)
Tests  4 failed | 357 passed (361)
Duration  421.67s
```

**Concern (process, not code):** `pnpm test:db -- tests/db/bearer-client.test.ts` did not
filter — it ran the whole 52-file `tests/db/**` suite (read-only tests, each file owns/cleans
its own fixture institution per CLAUDE.md convention, so no corruption, but it is wider than
"run only your own db test file" and cost ~7 min). Verified with
`pnpm exec vitest list --project db --passWithNoTests tests/db/bearer-client.test.ts`
that the filter argument itself is correct; the mismatch is specific to going through the
`pnpm test:db --` wrapper in this environment (pnpm/vitest 5.0.5 arg-forwarding quirk, not
investigated further — out of this packet's scope). For GREEN I used the equivalent direct
form `pnpm exec vitest run --project db --passWithNoTests tests/db/bearer-client.test.ts`,
confirmed via `list` to match only the 4 target tests before running.

## GREEN

Command: `pnpm exec vitest run --project db --passWithNoTests tests/db/bearer-client.test.ts`
(implementation restored).

```
Test Files  1 passed (1)
     Tests  4 passed (4)
  Duration  1.41s
```

## Other checks

- `pnpm lint` → clean (no output, exit 0).
- `pnpm typecheck` (`next typegen && tsc --noEmit`, whole repo) → clean, exit 0. Confirms
  `createClient()`'s union return type (`SupabaseClient<Database>` from either branch) is
  still usable by every existing caller (`getClaims`, `getTenantContext`, route handlers, etc.)
  without any caller-side changes.

## Self-review

- Scope: only `src/lib/supabase/server.ts` + new `tests/db/bearer-client.test.ts` touched.
  `git status --short` shows no other files changed by this work.
- Existing comments in `server.ts` (the `getClaims` JSDoc, the `setAll` try/catch comment,
  the `createAnonClient` T-024 comment) kept verbatim.
- `getClaims()` always verifies via `supabase.auth.getClaims(...)` — never
  `jwt.decode`/manual base64 parsing — satisfies "JWT must be verified, never decode-only."
- Scope is opt-in: neither `createClient` nor `getClaims` reads the `Authorization` header
  globally; only `withBearerToken` sets the ALS value. The dispatcher (later task) is the
  only intended caller.
- No new dependency (`node:async_hooks` is Node builtin).
- Test mirrors `tests/security/csrf.test.ts`'s file-wide `vi.mock("next/headers")` with an
  empty jar, so the "scope does not leak" case gets a real null, not a stale session cookie.

## Concerns

- The `pnpm test:db --` filter-forwarding issue above is worth a follow-up ticket if other
  packets hit it — it silently runs the full suite instead of the single intended file.
- `getClaims(token)` on a fresh unauthenticated plain client still performs a real network/JWKS
  verification per call (no session to lean on) — expected and matches the brief, just noting
  it's a per-request verification cost in the future dispatcher path, not a caching layer (none
  was asked for here).

## Assumptions

- "byte-for-byte unchanged" outside scope interpreted as: same cookie-reading path, same
  `createServerClient` client, same `getClaims()` no-arg call — verified structurally, not
  via a snapshot diff tool.
