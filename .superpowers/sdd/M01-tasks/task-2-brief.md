### Task 2: M01-T2 Bearer-token server client
READ: BRIEF-COMMON.md; `src/lib/supabase/server.ts`; `src/lib/auth/context.ts`; `tests/helpers/roles.ts`
FILES: `src/lib/supabase/server.ts` (edit); `tests/db/bearer-client.test.ts` (new)
EXPORTS: `withBearerToken<T>(token: string, fn: () => Promise<T>): Promise<T>` — `AsyncLocalStorage` (node:async_hooks), module-private store. While a token is in scope: `createClient()` returns plain supabase-js (`global.headers.Authorization = Bearer <token>`, `auth: { persistSession: false, autoRefreshToken: false }`) and never calls `cookies()`; `getClaims()` calls `supabase.auth.getClaims(token)` (verifies the JWT; never decode-only). Outside the scope behaviour is byte-for-byte unchanged. Scope is opt-in only (never read the `Authorization` header globally — only the dispatcher calls `withBearerToken`). Keep `createClient`'s return type usable by every existing caller (typecheck whole repo).
TEST FIRST: cases — "getClaims inside withBearerToken returns the token's user"; "garbage token → getClaims null"; "createClient under a teacher token reads memberships as that teacher only (RLS)"; "scope does not leak after fn resolves" (call outside with `next/headers` mocked to an empty cookie jar → getClaims null). Get tokens via `inst.clientAs(role).auth.getSession()`.
ACCEPT: `pnpm test:db -- tests/db/bearer-client.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

