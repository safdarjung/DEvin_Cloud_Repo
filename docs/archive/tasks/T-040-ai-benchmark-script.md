# T-040 — AI benchmark script (P1)

| Field | Value |
|---|---|
| Lane / Day | D / Day 13 |
| Size | 1 agent-day |
| Critical path | no (first fallback-ladder item) |
| Review | code-reviewer |
| Feature ids | F-AI-06, F-PLT-07 (inputs) |
| Depends on | T-035 (merged) |
| Migration | — |

## Business outcome
A reproducible `pnpm ai:bench` produces the measurements (latency, throughput, JSON validity, cost, VRAM) that every later hardware-sizing or local-vs-cloud claim must cite — and until it runs, no claim is made.

## Current repo state (verify before starting)
- Gateway providers: `grep -n "getLocalModel\|getCloudModel" src/lib/ai/providers.ts`.
- `nvidia-smi` available: `nvidia-smi --query-gpu=name,memory.used --format=csv,noheader`.
- `tsx` or equivalent runner for scripts: `grep -n '"seed":' package.json` (reuse the same runner).

## Spec sections to read (only these)
`12-decision-log.md §2` (Local models, Ollama structured outputs, Anthropic pricing rows) · `11-operations.md §8` (sizing primitives), `§1` (`BENCH_*` env names) · `08 §6 L5` · `07 §5` (benchmarks make no claims; injection fixture) · `04 §5` (bench calls providers directly, bypassing institution quota but logging nothing to `ai_usage_events`).

## Files to inspect first
`src/lib/ai/providers.ts` (reuse model factories) · `src/lib/ai/pricing.ts` · `src/modules/ai/quiz.schemas.ts` (reuse `QuizContentSchema`).

## Expected changes
- `scripts/ai-bench/bench.ts` — CLI: `--models ollama:<tag>,anthropic:<id>` `--tasks quiz,summary` `--n 20` `--concurrency 1,4,8` `--dev-stack up|down`; 3 warm-up runs discarded; `temperature 0`, `seed 42` (local), `num_ctx 8192`, `maxTokens` 2048/512, abort 60 s local / 30 s cloud.
- `scripts/ai-bench/tasks/{quiz,summary}.ts` — quiz: ≈300-token unit → `QuizContentSchema` (10 questions); summary: ≈1,200-token remarks → `{ bullets: string[5] }`; five fixture variants each in `scripts/ai-bench/fixtures/`, one summary fixture with an embedded injection line.
- `scripts/ai-bench/metrics.ts` — per run: `ttft_ms`, `total_ms`, in/out tokens, `out_tok_per_s`, `json_parse_ok`, `schema_ok_first`, `schema_ok_after_repair`, `semantic_ok`, `finish_reason`, `failure_mode` (timeout, http, parse, schema, semantic, truncated, empty, refusal, injection_obeyed).
- `scripts/ai-bench/gpu.ts` — samples `nvidia-smi` every 500 ms (memory, power); baseline before model load; `ollama ps` offload check.
- `scripts/ai-bench/report.ts` — aggregates per (model, task, concurrency): p50/p95, TTFT p50, tok/s, validity %, req/s, cost per 1k (cloud from `pricing.ts`; local from `BENCH_KWH_USD` × energy + `BENCH_HW_USD_PER_HOUR`, both printed as assumptions); writes `bench-results/<iso>-<sha>.json` and `bench-results/latest.md`.
- `package.json` — `ai:bench`; `.gitignore` — `bench-results/` except a committed `README.md`.
- `tests/unit/ai-bench-metrics.test.ts`.

## Must not modify
`src/lib/ai/**` · institution data (bench never touches the DB).

## Permissions / nav / migration numbers needed from the lead
None.

## Security and data-integrity requirements
- Cloud models run only when `AI_CLOUD_ENABLED=true` and a key exists; otherwise cloud entries are skipped with a printed reason.
- Fixtures are synthetic; no real names. Prompts are not written to results, only metrics.
- Results carry model digests (`ollama show`), package versions, dev-stack state, and GPU baseline so numbers are comparable.

## Acceptance criteria
1. `pnpm ai:bench --models ollama:qwen2.5:3b --tasks quiz --n 3 --concurrency 1` completes and writes JSON + markdown.
2. Full default run (two local models, two tasks, 20 runs, three concurrency levels) completes with the dev stack down; a second run with the stack up is recorded separately.
3. `latest.md` shows the metrics table and the assumption footnotes; injection fixture outcome is reported per model.
4. No document in `docs/planning/coolskool` states a performance claim until `latest.md` exists (checked in report).

## Tests (write failing tests first) and exact commands
- `tests/unit/ai-bench-metrics.test.ts` (aggregation math, cost formula, failure classification) → `pnpm test -- tests/unit/ai-bench-metrics.test.ts`
- `pnpm ai:bench --models ollama:qwen2.5:3b --tasks quiz --n 3 --concurrency 1` (smoke)

## Deliverables
Bench scripts, fixtures, report writer, unit test, `bench-results/README.md`, first `latest.md` attached in the report (or stated as not run).

## Assumptions and risks
- Desktop already uses ≈2.9 GB VRAM; 4 GB models may spill to CPU — the `ollama ps` check marks such runs as `offload_partial` rather than hiding them.
- Anthropic has no seed parameter; variance is noted.

## Completion report
Use the format in `CLAUDE.md`.
