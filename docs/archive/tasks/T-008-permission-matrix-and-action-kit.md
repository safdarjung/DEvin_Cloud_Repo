# T-008 — Permission matrix, `requirePermission`, result envelope, `defineAction`

| Field | Value |
|---|---|
| Lane / Day | D / Day 2 |
| Size | 1 agent-day |
| Critical path | yes |
| Review | security-reviewer + lead |
| Feature ids | F-IDN-04 |
| Depends on | T-001 (merged) |
| Migration | — |

## Business outcome
One authoritative permission matrix and one way to write a server action, so every mutation in the demo validates input, checks permission, and returns the same envelope.

## Current repo state (verify before starting)
- No `src/lib/auth` or `src/lib/actions`: `ls src/lib/`.
- Zod 4 installed: `grep '"zod"' package.json`.

## Spec sections to read (only these)
- `07-security-and-ai-governance.md §2` (the matrix — copy it exactly), `§6` C-03.
- `06-workflows-and-contracts.md §1.1–1.3` (envelope, ErrorCode, action signature, common Zod primitives).
- `04-architecture.md §3` (server action contract, `defineAction` shape, correlation id).
- `CLAUDE.md` rules 2–4.

## Files to inspect first
- `tsconfig.json` (strict), `vitest.config.mts` (unit project globs).

## Expected changes
- `src/lib/auth/permissions.ts` — `Role` union, `Permission` union (string literals exactly as `07 §2`), `ROLE_PERMISSIONS: Record<Role, readonly Permission[]>`, `permissionsFor(role)`; scoped (`s`) entries are granted here and scoped by RLS/handlers.
- `src/lib/auth/require.ts` — `requirePermission(ctx, permission)` throws `AppError('forbidden')`; `hasPermission`.
- `src/lib/auth/types.ts` — `TenantContext` type (`04 §4`), used by T-007.
- `src/lib/actions/result.ts` — `ActionResult<T>`, `ErrorCode`, `AppError`, `ok()`, `fail()`, `mapSqlError(err)` parsing `code:<ErrorCode>` from Postgres `P0001` messages, else `internal` with a generated correlation id and server-side `console.error` (no PII).
- `src/lib/actions/define-action.ts` — `defineAction({ schema, permission, handler })` returning `(institutionSlug, raw) => Promise<ActionResult>`; resolves context via an injected `resolveContext` (T-007 provides `getTenantContext`; until then the kit accepts a resolver parameter with a default import path), parses with `.strict()` schemas → `validation_failed` + `fieldErrors`, checks permission (static or function of input), runs handler, maps errors.
- `src/lib/schemas/common.ts` — `uuid`, `money`, `isoDate`, `phoneIN`, `shortText`, `longText`.
- `src/lib/actions/registry.ts` — `registerAction(name, action)` map used by C-03 escalation tests (every module registers its actions).

## Must not modify
- `supabase/**`; `src/app/**`.

## Permissions / nav / migration numbers needed from the lead
- None (this packet creates the matrix file the lead then owns).

## Security and data-integrity requirements
- Unknown input keys rejected (`.strict()` on every action schema; enforce in `defineAction` by wrapping non-strict object schemas with `.strict()` or asserting at registration).
- Handler never receives the raw client `institution_id`; it uses `ctx.institution.id`.
- Error messages never include stack traces or SQL text; correlation id only.

## Acceptance criteria
1. C-03 snapshot: `ROLE_PERMISSIONS` serialised equals the table in `07 §2` (test embeds the expected matrix; a mismatch lists the differing cells).
2. `defineAction` returns `validation_failed` with `fieldErrors` for bad input, `forbidden` for a role lacking the permission, `ok` for a valid call, `internal` with correlation id for an unexpected throw (and logs once).
3. `mapSqlError` maps `code:invalid_state` → `invalid_state`, `code:conflict` → `conflict`, unknown → `internal`.
4. Every `Permission` literal referenced anywhere in `src/` exists in the matrix (grep-based unit test over `src/**/*.ts(x)` for `'[a-z]+\.[a-z.]+'` strings passed to `requirePermission`/`permission:`).
5. `pnpm typecheck` clean; no runtime dependency added.

## Tests (write failing tests first) and exact commands
- `tests/unit/permissions.test.ts` — C-03 snapshot, `permissionsFor`.
- `tests/unit/define-action.test.ts` — criteria 2–3 with a fake resolver and fake ctx.
- `tests/unit/permission-literals.test.ts` — criterion 4.
- Command: `pnpm test -- tests/unit/permissions.test.ts tests/unit/define-action.test.ts tests/unit/permission-literals.test.ts`.

## Deliverables
- Auth + action kit, common schemas, registry, tests, completion report.

## Assumptions and risks
- `permission` may be a function of input for actions whose permission depends on data (e.g. attendance correction window) — handlers still re-check scope.
- Zod 4 `.strict()` semantics confirmed via `docs-lookup` before use.

## Completion report
Use the format in `CLAUDE.md`.
