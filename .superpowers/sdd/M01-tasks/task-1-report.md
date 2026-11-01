# Task 1 report: M01-T1 ErrorCode→HTTP envelope

## What
New `src/lib/http/api-envelope.ts`: `HTTP_STATUS` (exhaustive `Record<ErrorCode, number>` via `satisfies`), `apiResponse(result, status?)`, `bearerToken(request)`. No other files touched.

## Files
- `src/lib/http/api-envelope.ts` (new)
- `tests/unit/api-envelope.test.ts` (new, test-first)

## RED
```
$ pnpm test -- tests/unit/api-envelope.test.ts
Error: Cannot find package '@/lib/http/api-envelope' imported from .../tests/unit/api-envelope.test.ts
 FAIL  |unit| tests/unit/api-envelope.test.ts [ tests/unit/api-envelope.test.ts ]
 Test Files  1 failed | 73 passed (74)
      Tests  901 passed (901)
```

## GREEN
```
$ pnpm test -- tests/unit/api-envelope.test.ts
 Test Files  74 passed (74)
      Tests  912 passed (912)
```
(11 new tests in api-envelope.test.ts: all 13 ErrorCodes 4xx/5xx + exact mapping, ok→200+cache-control, fail→mapped status+fieldErrors preserved, status-arg override on fail and on ok, bearerToken: lowercase scheme, standard scheme+trim, non-bearer rejected, empty-token rejected, missing-header null.)

## Lint / typecheck
```
$ pnpm lint        → clean (eslint, no output)
$ pnpm typecheck   → next typegen + tsc --noEmit, clean
```

## Self-review
- `HTTP_STATUS` built with `satisfies Record<ErrorCode, number>` — adding an ErrorCode without updating this file fails typecheck (exhaustiveness per brief).
- `apiResponse`: `status` param overrides both the 200-ok default and the mapped-fail default, per brief ("status overrides the mapped code"). Covered by both override tests.
- `bearerToken`: regex `^Bearer\s+(.*)$` with `/i` flag — case-insensitive scheme, any whitespace run as separator, trims result, empty-after-trim → null. Matches brief's four cases exactly.
- Comment density matches `result.ts`: one header comment per file explaining the "why", one short comment per exported function.
- Used Next's built-in `Response.json` (platform feature, no new dep) for the JSON+status+headers response, consistent with "use platform feature over hand-rolled".

## Concerns
None found. `fail()`'s fieldErrors is optional (only present when passed) — test covers both the no-fieldErrors (validation_failed without) and fieldErrors-present shape; envelope passes the whole `result.error` object through unchanged, so this is preserved by construction, not special-cased.

## Assumptions
- "exhaustive" = TS `satisfies` compile-time check, not a runtime assertion (no runtime list needed, matches how `result.ts` itself does `KNOWN_ERROR_CODES` only for runtime narrowing from unknown strings — not applicable here since the type already is `ErrorCode`).
