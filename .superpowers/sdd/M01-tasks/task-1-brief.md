### Task 1: M01-T1 ErrorCode→HTTP envelope
READ: BRIEF-COMMON.md; `src/lib/actions/result.ts`
FILES: `src/lib/http/api-envelope.ts` (new)
EXPORTS: `HTTP_STATUS: Record<ErrorCode, number>` (use `satisfies`, exhaustive): unauthenticated 401, forbidden 403, not_found 404, validation_failed 422, conflict 409, invalid_state 409, rate_limited 429, quota_exceeded 429, ai_unavailable 503, ai_policy_blocked 403, ai_invalid_output 502, dependency_failed 502, internal 500 · `apiResponse(result: ActionResult<unknown>, status?: number): Response` (status overrides the mapped code — T4 uses it for 400/413; else 200 on ok, else `HTTP_STATUS[code]`; JSON body = the envelope unchanged; `cache-control: no-store`) · `bearerToken(request: Request): string | null` (case-insensitive `Bearer <token>`, trims, null on empty/malformed).
TEST FIRST: `tests/unit/api-envelope.test.ts` — every ErrorCode maps to a 4xx/5xx; ok result → 200 with body `{ok:true,data}`; fail result keeps fieldErrors; bearerToken parses `bearer abc`, rejects `Basic x` / `Bearer ` / missing.
ACCEPT: `pnpm test -- tests/unit/api-envelope.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

