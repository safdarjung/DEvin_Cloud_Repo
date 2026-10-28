# T-035 — AI gateway, policy, quota, redaction, providers, usage log

| Field | Value |
|---|---|
| Lane / Day | D / Day 5–6 |
| Size | 1.5 agent-days |
| Critical path | no (T-036, T-040 depend on it) |
| Review | security-reviewer + lead |
| Feature ids | F-AI-01, F-AI-02, F-AI-03, F-AI-05 |
| Depends on | T-007, T-005 (merged) |
| Migration | — |

## Business outcome
Every model call in CoolSkool goes through one gateway that enforces the institution's AI policy, quotas, and redaction, logs usage without prompt bodies, and can never reach the cloud under `local_only`.

## Current repo state (verify before starting)
- `ai_usage_events` table and RLS: `grep -n "ai_usage_events" supabase/migrations/20261028000003_platform.sql`.
- `institutions.ai_policy` and `settings.ai`: `grep -n "ai_policy" supabase/migrations/20261028000002_core.sql`; `grep -n '"ai"' src/modules/core/schemas.ts`.
- No `ai` package yet: `grep -n '"ai"' package.json` → empty.

## Spec sections to read (only these)
`04-architecture.md §5` · `06-workflows-and-contracts.md §W10, §W11, §1.1` · `07-security-and-ai-governance.md §5, §1 T8–T9, §6 C-62/C-63` · `12-decision-log.md D9` and §2 rows AI SDK / Ollama providers / Anthropic pricing · `05 §2.1` (`ai_usage_events`), `§4.1` (`ai` key) · `11 §1` (AI env names).

## Files to inspect first
`src/lib/auth/context.ts` (`TenantContext` shape) · `src/lib/actions/result.ts` (`AppError`, codes) · `src/modules/core/schemas.ts` (`InstitutionSettingsSchema.ai`).

## Expected changes
- `src/lib/ai/policy.ts` — `resolvePlan({ aiPolicy, cloudEnabled, hasCloudKey }) → ('local'|'cloud')[]` (pure).
- `src/lib/ai/providers.ts` — `getLocalModel()` via `ai-sdk-ollama` (`OLLAMA_BASE_URL`, `OLLAMA_MODEL`); `getCloudModel(tier)` does `await import('@ai-sdk/anthropic')` lazily; exported factory spies for tests.
- `src/lib/ai/redact.ts` — `redact(text, denyNames?) → { text, count }` (phone IN, email, 12-digit, name list).
- `src/lib/ai/usage.ts` — `checkLimits(ctx, feature)` (daily tokens from `ai_usage_events` in institution timezone, per-user per-minute, per-process semaphore from `settings.ai`), `logUsage(event)` (metadata only).
- `src/lib/ai/pricing.ts` — USD/MTok table for configured cloud models; `estimateCost`.
- `src/lib/ai/gateway.ts` — `runStructured<T>({ ctx, feature, schema, instructions, prompt, denyNames? }) → Promise<ActionResult<{ data: T; provider; model; fallback }>>` using `generateText` + `Output.object`; timeouts 60 s local / 30 s cloud; one repair retry appending the Zod error; maps failures to `ai_unavailable | ai_policy_blocked | quota_exceeded | rate_limited | ai_invalid_output`.
- `src/modules/ai/queries.ts` — `usageSummary(ctx, range)`; page `src/app/(tenant)/[institution]/ai/usage/page.tsx` (`ai.usage.read`).
- `package.json` — add `ai`, `@ai-sdk/anthropic`, `ai-sdk-ollama` (versions per `12 §2`).
- `tests/unit/{ai-policy,ai-redact,ai-gateway}.test.ts`, `tests/db/ai-usage.test.ts`.

## Must not modify
`src/lib/auth/**` · `src/lib/actions/**` · migrations · any `src/modules/**` other than `ai`.

## Permissions / nav / migration numbers needed from the lead
Nav: `{ href: '/ai/usage', label: 'AI usage', permission: 'ai.usage.read' }`. Three new dependencies (justify: official AI SDK + Anthropic provider; community Ollama provider has no official alternative).

## Security and data-integrity requirements
- `local_only` plan never includes `cloud`; the cloud module import is inside `if (step === 'cloud')` only (C-62 spies the factory and asserts zero calls).
- Cloud step requires `AI_CLOUD_ENABLED === 'true'` and `ANTHROPIC_API_KEY`; otherwise the plan drops `cloud` (C-63: no fetch).
- Redaction runs before any cloud call and its count is logged; the prompt itself is never persisted or logged.
- Quota and rate checks happen before provider calls; failures are logged with `ok = false` and `error_code`.
- Output is returned only after Zod parse succeeds.

## Acceptance criteria
1. Policy table: 3 policies × key present/absent × switch on/off produce the plans in `06 §W11`.
2. With Ollama stopped and `local_only`, `runStructured` returns `ai_unavailable` within the timeout and logs one failed usage event.
3. Exceeding `daily_token_quota` returns `quota_exceeded` without calling a provider; 11th request in a minute returns `rate_limited`.
4. Invalid JSON on first attempt triggers exactly one repair retry; second failure → `ai_invalid_output`.
5. `/ai/usage` shows tokens, cost estimate (labeled estimate), provider split for admins; `forbidden` for a teacher.

## Tests (write failing tests first) and exact commands
- `tests/unit/ai-policy.test.ts` (C-60, C-61) → `pnpm test -- tests/unit/ai-policy.test.ts`
- `tests/unit/ai-gateway.test.ts` with mocked `generateText` (C-62, C-63, retry, limits) → `pnpm test -- tests/unit/ai-gateway.test.ts`
- `tests/unit/ai-redact.test.ts` → `pnpm test -- tests/unit/ai-redact.test.ts`
- `tests/db/ai-usage.test.ts` (C-64: metadata only, RLS) → `pnpm test:db -- tests/db/ai-usage.test.ts`
- Manual smoke against local Ollama with `qwen3:4b-instruct-2507-q4_K_M` (record TTFT in report; no claims).

## Deliverables
Six `src/lib/ai` files, usage page, dependency additions, four test files, completion report.

## Assumptions and risks
- If `ai-sdk-ollama` fails `Output.object` on AI SDK 7, switch to `ollama-ai-provider-v2` and record in `12` via the lead (one-line justification).
- Per-process semaphore is DBT-02; documented in the usage page footer.

## Completion report
Use the format in `CLAUDE.md`.
