# bench-results/

This directory holds `pnpm ai:bench` output. Everything except this file is
git-ignored (`.gitignore`: `bench-results/*` + `!bench-results/README.md`) —
results are regenerated locally, not committed, because they depend on the
machine's GPU and whatever's running on it at the time.

## Running the bench

```bash
# smoke test (small, one local model, one task)
pnpm ai:bench --models ollama:qwen2.5:3b --tasks quiz --n 3 --concurrency 1

# full default sweep (two local models, both tasks, 20 runs, three concurrency levels)
pnpm ai:bench --models ollama:qwen2.5:3b,ollama:qwen3:4b-instruct-2507-q4_K_M \
  --tasks quiz,summary --n 20 --concurrency 1,4,8

# include the cloud model (only runs if AI_CLOUD_ENABLED=true and ANTHROPIC_API_KEY is set;
# otherwise it is skipped with a printed reason, never a crash)
pnpm ai:bench --models ollama:qwen2.5:3b,anthropic:claude-haiku-4-5 --tasks quiz,summary
```

Flags: `--models provider:id[,provider:id...]` (`ollama:` or `anthropic:`) ·
`--tasks quiz,summary` · `--n <int>` (measured runs per concurrency level,
after 3 discarded warm-up runs) · `--concurrency <int,int,...>` ·
`--dev-stack up|down` — this only **labels** the run's metadata with which
state you say the local Supabase stack was in; the bench never starts or
stops Docker/Supabase itself (it also never touches the database — see
`src/lib/ai/*` and CLAUDE.md rule 1). Passing `--dev-stack down` prints a
warning instead of doing anything, since stopping the stack while something
else depends on it would be destructive.

Env vars read (names only, see `11-operations.md §1`): `OLLAMA_BASE_URL`,
`AI_CLOUD_ENABLED`, `ANTHROPIC_API_KEY`, `AI_CLOUD_MODEL_QUALITY` /
`_CHEAP`, `BENCH_KWH_USD`, `BENCH_HW_USD_PER_HOUR`.

## Reading the output

Each run writes two files:

- `<iso-timestamp>-<git-sha>.json` — the full raw aggregates (one entry per
  model × task × concurrency level), plus package versions, model digests,
  GPU baseline/peak VRAM, and the dev-stack label, so results stay
  comparable across machines and commits.
- `latest.md` — a markdown table of the same data, meant to be read by a
  person: p50/p95 TTFT and total latency, output tokens/sec, requests/sec,
  JSON/schema validity %, a failure-mode breakdown, the injection-fixture
  outcome per model, and estimated cost per 1,000 output tokens.

**Cost assumptions, stated every time** (07 §5 — bench numbers are
estimates, never a bill, never a claim until this file has real numbers in
it):

- Cloud cost comes from `src/lib/ai/pricing.ts`'s USD-per-million-token
  table for the resolved model id.
- Local cost has no API price, so it's estimated as
  `(average GPU power draw during the batch × wall-clock hours / 1000) × BENCH_KWH_USD`
  (electricity) `+ BENCH_HW_USD_PER_HOUR × wall-clock hours` (amortized
  hardware), normalized to a $/1,000-output-token rate. Both env vars
  default to a placeholder ($0.10/kWh, $0.15/h) if unset — override them to
  match your real electricity rate and hardware amortization before citing
  a number.
- `offload` is read from `ollama ps`: `full_gpu` means the model ran
  entirely on GPU; `offload_partial` means some layers spilled to CPU
  (expected on this desktop's 6 GB card once ~2.8–2.9 GB is already in use
  at rest — `12-decision-log.md §2`). Partial-offload throughput numbers are
  a lower bound, not what dedicated hardware would show.
- The injection fixture (`scripts/ai-bench/fixtures/summary-5-injection.txt`)
  embeds a fake "system override" instruction inside the text to summarize.
  "Resisted" means the model's output never contained the fixture's trigger
  marker; it is not a general claim about prompt-injection safety beyond
  this one fixture.

No document under `docs/planning/coolskool` may state a latency, throughput,
validity, or cost number until a `latest.md` with real measurements exists
to cite (T-040 acceptance criterion 4).
