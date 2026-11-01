Packet: M01-T4 POST /api/v1/actions/[name]

Files changed:
- src/app/api/v1/actions/[name]/route.ts (new)
- tests/db/api-actions-route.test.ts (new)

Behavior implemented:
- `runtime="nodejs"`, `dynamic="force-dynamic"`, `POST(request, { params })` (params is a Promise, Next 16).
- Order: `isCrossSiteRequest` -> 403 forbidden · `readJsonBody(request, 1_000_000)` -> 413 validation_failed (too large) / 400 validation_failed (bad JSON) · outer Zod `{ institution?: string, input?: unknown }` -> 400 on shape mismatch · slug = `x-institution` header ?? `body.institution`, checked against `/^[a-z0-9-]+$/` + length 1-100 -> 422 (default `apiResponse` mapping, no override needed) · side-effect import of `../all-actions` then `getRegisteredActions().get(name)` -> 404 not_found (default mapping) · runs `action(slug, input)` — exactly 2 args, never a 3rd — inside `withBearerToken(token, …)` when `bearerToken(request)` is non-null, else plain (cookie path) · catches thrown digests: `NEXT_REDIRECT*` -> 401 unauthenticated, `NEXT_HTTP_ERROR_FALLBACK;404*` -> 404 not_found, anything else -> 500 internal, correlation id logged server-side only (`console.error`), never raw error text in the response.
- `controlFlowStatus()` is a small local re-implementation of define-action.ts's private `isNextControlFlowSignal` (can't import a non-exported function) — same two digest prefixes, same semantics.

Tests run: `pnpm test:db tests/db/api-actions-route.test.ts` -> 8 passed, 0 failed (confirmed RED first: temporarily moved route.ts aside, test import failed with "Cannot find package"; restored, reran, GREEN).
Cases covered: admissions bearer adds note -> 200 + row updated (raw SQL check on `public.enquiries.notes`); teacher bearer -> 403; accountant bearer -> 403; no token -> 401; bearer of admissions-role member of institution A called against institution B's slug -> 404 (membership lookup inside `getTenantContext` fails -> `notFound()`); unknown action name -> 404; empty input against `admissions.enquiry.note`'s schema -> 422 with `fieldErrors`; `Origin: https://evil.example` -> 403.

Also ran: `pnpm lint` -> clean. `pnpm typecheck` -> clean (`next typegen && tsc --noEmit`, no errors).

Tests not run and why: full `pnpm test:db` suite (52 files) not run — brief says run only the one file; I'm not the DB owner for other packets' fixtures. `pnpm test`/`test:security`/`test:e2e` not run — out of scope for this packet (no unit/e2e files touched).

Limitations / honesty label: N/A — no UI, no simulated/limited surface; this is a pure API dispatcher.

Security / integration risks:
- Dispatcher CSRF case (brief's own callout): this route is the one `isCrossSiteRequest` check that now guards EVERY registered action over HTTP, unlike `/api/public/enquiry` and `/api/ai/quiz`, which each run their own copy. A bearer-token caller (mobile/CLI/server-to-server) never sends `Origin`/`Sec-Fetch-Site`, so `isCrossSiteRequest` correctly lets those through — the guard only blocks ambient-cookie (browser session) cross-site POSTs, which is the intended threat model (07 §lesson 2 shape). Confirmed with the `Origin: https://evil.example` test case.
- `action(slug, input)` is called with exactly 2 arguments everywhere — the 3rd-argument `overrideCtx` bypass in define-action.ts (gated on `process.env.VITEST === "true"`) is structurally unreachable from this route in production regardless, since no code path here ever supplies a 3rd argument.
- The outer body Zod schema (`{ institution?, input? }`) is intentionally not `.strict()` — unknown extra top-level body keys are ignored, not rejected, since the wire contract only promises these two fields are read; action-level input validation (`.strict()` schemas per action) is unaffected and still the real boundary.
- 500 path never leaks raw error text to the client — only a correlation id; full error goes to `console.error` server-side, same convention as `/api/public/enquiry` and `define-action.ts`.

Follow-ups: none identified beyond this task's scope.

New dependencies (justification): none.

Assumptions made:
- Slug validation failure maps to the default `apiResponse` 422 status (no explicit status override) since `HTTP_STATUS.validation_failed === 422` already; this matches the brief's "→ 422" instruction without hardcoding a redundant literal.
- "404 not_found" for unknown action name and "forbidden"/"not_found" from control-flow digests likewise rely on `apiResponse`'s default mapping where it already matches (404 for not_found, 403 I did pass explicitly for the CSRF/forbidden case since that's reached before any `ActionResult`-shaped value exists).
- Used `admissions.enquiry.note` (`addEnquiryNote`) as the one concrete action under test, per the brief's listed fixture files (admissions-actions.test.ts pattern, AddEnquiryNoteSchema `{enquiryId: uuid, text: longText}`, permission `admissions.enquiry.write` — admissions/owner/principal/admin have it, teacher/accountant don't).
- Did not add a test for the `x-institution` header path specifically (only `body.institution` is exercised) — the brief's TEST FIRST list didn't call for a header-vs-body slug-source case, and the same `isValidSlug`/lookup code path handles both identically; flagged here rather than silently added as an untested branch.
