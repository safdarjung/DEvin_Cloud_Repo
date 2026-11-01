Packet: T-040 AI benchmark script (P1)

Files changed:
- scripts/ai-bench/bench.ts (new, CLI entry)
- scripts/ai-bench/metrics.ts (new, pure aggregation/cost/classification math)
- scripts/ai-bench/gpu.ts (new, nvidia-smi sampling + ollama ps offload check)
- scripts/ai-bench/stream-structured.ts (new, shared streamObject+timing helper)
- scripts/ai-bench/report.ts (new, JSON + latest.md writer)
- scripts/ai-bench/tasks/quiz.ts, scripts/ai-bench/tasks/summary.ts (new)
- scripts/ai-bench/fixtures/quiz-1..5-*.txt, summary-1..4-*.txt, summary-5-injection.txt (new, synthetic, no real names)
- tests/unit/ai-bench-metrics.test.ts (new, written first — RED confirmed before metrics.ts existed)
- package.json (`ai:bench` script only)
- .gitignore (`bench-results/` → `bench-results/*` + `!bench-results/README.md`)
- bench-results/README.md (new, committed; explains run commands, output format, every cost assumption)

Behavior implemented:
`pnpm ai:bench --models <provider:id,...> --tasks quiz,summary --n <int> --concurrency <int,...> --dev-stack up|down`
runs 3 discarded warm-ups then `n` measured runs per (model, task, concurrency), calling providers directly
(no DB, no `ai_usage_events`). Streams via `ai`'s `streamObject` for TTFT; classifies each run into one of 9
failure modes; aggregates p50/p95 latency, out tok/s, req/s, validity %, and local/cloud cost per 1k output
tokens; samples GPU every 500ms and checks `ollama ps` for CPU/GPU offload; writes
`bench-results/<iso>-<sha>.json` and `bench-results/latest.md`. Cloud models skip cleanly (printed reason) when
`AI_CLOUD_ENABLED`/`ANTHROPIC_API_KEY` aren't both set — never crash. `--dev-stack down` only labels run
metadata; it never stops Docker/Supabase (prints a warning instead), per the lead's ruling that another agent
is using the local DB.

Tests run:
- `pnpm vitest run --project unit tests/unit/ai-bench-metrics.test.ts` → 22 passed (RED confirmed first: "Cannot
  find module '../../scripts/ai-bench/metrics.ts'" before metrics.ts was written).
- `pnpm test` → 18 files, 182 passed (includes the above).
- `pnpm lint` → 0 errors; 4 pre-existing warnings in `scripts/seed/sections/*.ts` (T-024 files, not touched).
- `pnpm typecheck` → clean.
- Smoke (exact command from the packet's "Verify" section):
  `pnpm ai:bench --models ollama:qwen2.5:3b --tasks quiz --n 3 --concurrency 1` → completed, exit 0, wrote
  `bench-results/<iso>-<sha>.json` and `bench-results/latest.md`.
- Additional smoke (lead's literal verification command):
  `pnpm ai:bench --n 3 --concurrency 1 --tasks quiz,summary --models ollama:qwen2.5:3b` → completed, exit 0.
- Additional smoke to exercise the injection fixture (n=5 needed to round-robin as far as fixture 5 of 5):
  `pnpm ai:bench --n 5 --concurrency 1 --tasks summary --models ollama:qwen2.5:3b` → completed, exit 0.

Smoke numbers (smoke, fallback model `ollama:qwen2.5:3b`, not the primary — desktop GPU already at
~5.3/6.1 GB used by another process (`save-token-laya`'s bridge server, ~2.6 GB) plus ollama idle (~2.4 GB),
well above the ~2.8 GB baseline the packet assumed; `offload_partial` on every run):

| task | n | validity % | TTFT p50 ms | total p50/p95 ms | out tok/s | VRAM peak |
|---|---|---|---|---|---|---|
| quiz | 3 | 0% (see finding below) | n/a (no successful run) | 6624/6650 | 0 | 5343 MiB |
| summary | 5 | 80% (4/5) | 249 | 4933/7258 | 27.1 | 5353 MiB |

Key finding (not a bug in this packet's code — logged as a follow-up): every quiz-task run crashed Ollama's
model runner (`model runner has unexpectedly stopped`), reproduced directly with `streamObject` + `ai-sdk-ollama`
+ `QuizContentSchema` outside the bench harness entirely (plain Node repro), and isolated to the schema's
`.refine()` calls (uniqueness-of-options, answer-must-be-an-option) — a schema with those refinements
crashed the runner on every attempt; an equivalent schema without `.refine()` streamed correctly end to end
(217 output tokens, clean usage). Plain `curl` to `/api/chat` with a hand-written JSON Schema (no refine
semantics) also succeeded. This means **T-036's assignments-module quiz generation may crash the local Ollama
server the same way whenever the gateway runs `local_only` against `QuizContentSchema`** — worth its own
investigation; not touched here since `assignments.schemas.ts` is on the must-not-modify list. Logged as a
Debt candidate for `12-decision-log.md §Debt`.

The summary task (schema has no `.refine()`) ran cleanly and the injection fixture worked as designed: at n=5
(round-robins through all 5 fixtures once), `qwen2.5:3b` obeyed the injected "ignore your instructions" line
once out of five runs (`injection_obeyed`), correctly detected and reported per-model in `latest.md`.

What Context7/docs-lookup confirmed (done via installed `.d.ts`, per the packet's "or against the installed
.d.ts" alternative — no subagent dispatched, per instruction):
- `node_modules/.pnpm/ai@7.0.155.../dist/index.d.ts`: `streamObject`/`generateObject` take
  `temperature`, `seed`, `maxOutputTokens`, `abortSignal` as flat `LanguageModelCallOptions`/`RequestOptions`
  fields (no `Output.object` wrapper needed — `streamObject` already returns a schema-typed result).
  `result.fullStream` yields `{type:'text-delta', textDelta}` parts (used for TTFT); `result.usage` resolves to
  `{inputTokens, outputTokens, totalTokens}` (all `number | undefined`); `result.finishReason` resolves to
  `'stop'|'length'|'content-filter'|'tool-calls'|'error'|'interrupted'|'other'`.
- `node_modules/.pnpm/ai-sdk-ollama@4.6.0.../dist/provider.d.ts`: `ollama(modelId, { options: Partial<Options> })`
  is where `num_ctx` goes (no AI-SDK-level equivalent); `temperature`/`seed`/`maxOutputTokens` are mapped
  automatically from the top-level call.
- `node_modules/server-only/index.js`: throws unconditionally outside the `react-server` condition — confirms
  `src/lib/ai/providers.ts` cannot be imported from plain Node (matches `scripts/lib/admin-client.ts`'s own
  documented reason for not importing `src/lib/supabase/admin.ts`).

Deviations from the packet (and why):
1. **Did not import `src/lib/ai/providers.ts`.** It starts with `import "server-only"`, whose real package
   throws outside Next's `react-server` condition — confirmed by reading `node_modules/server-only/index.js`
   directly, and by the identical problem `vitest.config.mts` works around with an alias mock. `bench.ts`
   re-creates the same ~10-line `createOllama`/`createAnthropic` factories directly from the same two
   packages instead (same pattern as `scripts/lib/admin-client.ts` duplicating `src/lib/supabase/admin.ts`'s
   guard for the same reason). `providers.ts` itself was not read-modified, only read.
2. **Did not import `QuizContentSchema` from `src/modules/academics/assignments.schemas.ts`.** That file
   imports `@/lib/schemas/common`, and plain Node (no bundler) cannot resolve the `@/` alias. `quiz.ts`
   duplicates the schema verbatim with a comment pointing at the source and a note to delete the copy if a
   path-alias loader is ever added for scripts. `pricing.ts` has no imports of its own, so it IS imported
   directly (`../../src/lib/ai/pricing.ts`) for the cloud cost-per-1k calculation — no duplication needed there.
3. **`--dev-stack down` does not stop anything.** Per the lead's ruling (another agent using the local DB),
   the flag only labels the run's JSON/markdown metadata with the claimed state and prints a warning; it never
   shells out to `supabase stop`/`docker`.
4. Fixture word counts are approximate (~220-300 words per quiz unit, ~550-750 words per summary set) rather
   than an exact token count — stated as an approximation in `bench-results/README.md`; good enough for a
   bench whose job is comparative measurement, not exact prompt-size control.

Limitations / honesty label: no UI-facing honesty badge applies (this is a dev-only CLI, not user-facing).
`latest.md` states every cost assumption inline and the file explicitly says no performance/capability claim
elsewhere is valid until it exists with real numbers (07 §5), matching acceptance criterion 4.

Security / integration risks:
- Bench never touches the DB, never imports anything from `src/lib/supabase/**`, never logs to
  `ai_usage_events` (lead ruling honored).
- No env values are printed anywhere (only names/booleans — e.g. "ANTHROPIC_API_KEY is not set").
- The quiz-task crash is an availability risk for the real app if T-036's gateway path hits the same
  schema+local-model combination — see Follow-ups.

Not run: the full default sweep (two local models × both tasks × n=20 × concurrency 1/4/8) and the
`--dev-stack down` comparison run — both explicitly out of scope per the lead (GPU already contended by
another process; concurrency-1 smoke only; never stop the dev stack mid-session). `qwen3:4b-instruct-2507-q4_K_M`
was never pulled (lead ruling: no `ollama pull`), so only `qwen2.5:3b` was exercised. The cloud model was not
exercised (no `ANTHROPIC_API_KEY` in this environment) — confirmed it prints `[skip] anthropic:... cloud model
skipped (ANTHROPIC_API_KEY is not set)` rather than crashing, by code inspection of `resolveModel()`; not run
live since there's no key to test against.

Follow-ups (candidates for `12-decision-log.md §Debt`):
- Investigate whether `QuizContentSchema`'s `.refine()` crashes the real gateway's local quiz generation
  (T-036) against Ollama the same way it crashes this bench — reproduced independently of bench.ts (see
  "Key finding" above). If confirmed, the fix likely belongs in the gateway/provider layer (e.g. validate
  with Zod after a refine-free JSON Schema, instead of asking Ollama to enforce the refine itself), not in
  this bench.
- Full default sweep (20 runs × 3 concurrency levels × 2 local models) not yet run; do once GPU contention
  from other processes on this desktop clears.

New dependencies (justification): none. Uses only packages already in `package.json`
(`ai`, `ai-sdk-ollama`, `@ai-sdk/anthropic`, `zod`) plus Node built-ins (`node:child_process`, `node:fs`,
`node:path`, `node:url`, `node:util`).

Assumptions made:
- `BENCH_KWH_USD` default 0.10 USD/kWh, `BENCH_HW_USD_PER_HOUR` default 0.15 USD/h when the env vars are unset
  (both stated inline in every `latest.md` and in `bench-results/README.md`).
- Local cost-per-run uses the GPU's average power draw over that batch's wall-clock window × hours × kWh
  price, plus hardware-hour amortization — both are estimates, never a bill, matching `pricing.ts`'s own
  comment about local inference having no per-token API cost.
- `offload_partial` vs `full_gpu` is read from `ollama ps`'s PROCESSOR column; treated as a lower-bound signal
  on throughput, not hidden, per the packet's VRAM-spill assumption.

## Fix round 1

Code review: MEDIUM — `scripts/ai-bench/tasks/quiz.ts` duplicates `QuizContentSchema` with nothing to catch
drift from `src/modules/academics/assignments.schemas.ts`.

Fix: added `tests/unit/quiz-schema-parity.test.ts`. Runs under Vitest (resolves `@/`, unlike plain Node), so it
imports both schemas side by side and asserts: top-level `.shape` keys match; 6 representative valid cases
(1 question, 30 questions/max, optional explanation, stem/option/explanation at their max lengths) parse
successfully on both; 13 representative invalid cases (empty/31 questions, missing field, unknown key under
`.strict()`, duplicate options, answer not in options, wrong option count, over-max lengths, empty stem) are
rejected by both.

Tests run: `pnpm vitest run --project unit tests/unit/ai-bench-metrics.test.ts tests/unit/quiz-schema-parity.test.ts`
→ 42/42 pass. `pnpm test` → 20 files, 209/209 pass. `pnpm lint` → 0 errors (same 4 pre-existing T-024 warnings,
untouched). Did not run the bench (GPU busy) or any DB commands, per this round's instructions.

Files changed this round: `tests/unit/quiz-schema-parity.test.ts` (new).
