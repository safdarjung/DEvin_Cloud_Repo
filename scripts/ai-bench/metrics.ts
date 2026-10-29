// T-040 — pure metrics math for `pnpm ai:bench`. No I/O, no provider
// imports, so it is trivially unit-testable (tests/unit/ai-bench-metrics.test.ts)
// and importable from a plain `node` process without the `@/` alias or
// `server-only` problems that block importing `src/lib/ai/providers.ts`
// directly from a script — see `bench.ts`'s header comment.

export type FailureMode =
  | "timeout"
  | "http"
  | "parse"
  | "schema"
  | "semantic"
  | "truncated"
  | "empty"
  | "refusal"
  | "injection_obeyed";

export interface RunMetric {
  ttftMs: number | null;
  totalMs: number;
  inputTokens: number;
  outputTokens: number;
  jsonParseOk: boolean;
  schemaOkFirst: boolean;
  schemaOkAfterRepair: boolean;
  /** null when the task has no semantic check (07 §5: bench makes no claims it can't measure). */
  semanticOk: boolean | null;
  finishReason: string;
  failureMode: FailureMode | null;
  timedOut?: boolean;
  httpError?: boolean;
  refusalDetected?: boolean;
  isInjectionFixture?: boolean;
  injectionObeyed?: boolean;
}

export type ClassifyInput = Pick<
  RunMetric,
  | "jsonParseOk"
  | "schemaOkFirst"
  | "schemaOkAfterRepair"
  | "semanticOk"
  | "finishReason"
  | "outputTokens"
  | "timedOut"
  | "httpError"
  | "refusalDetected"
  | "isInjectionFixture"
  | "injectionObeyed"
>;

/**
 * Deterministic precedence: a transport-level failure always wins over a
 * content-level one (there is no content to judge), then parse, then
 * schema, then the slower/semantic/format checks, then the fixture-specific
 * injection check last (a model can resist the injection and still pass).
 */
export function classifyFailure(input: ClassifyInput): FailureMode | null {
  if (input.timedOut) return "timeout";
  if (input.httpError) return "http";
  if (!input.jsonParseOk) return "parse";
  if (!input.schemaOkAfterRepair) return "schema";
  if (input.semanticOk === false) return "semantic";
  if (input.finishReason === "length") return "truncated";
  if (input.outputTokens === 0) return "empty";
  if (input.refusalDetected) return "refusal";
  if (input.isInjectionFixture && input.injectionObeyed) return "injection_obeyed";
  return null;
}

/** Nearest-rank percentile (p in 0..100) over a copy of `values`; does not mutate the input. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new Error("percentile: values must not be empty");
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)];
}

/** USD cost of a run normalized to a per-1,000-output-token rate. */
export function costPerKOutputTokens(runCostUsd: number, outputTokens: number): number {
  if (outputTokens <= 0) return 0;
  return (runCostUsd / outputTokens) * 1000;
}

export interface LocalCostInput {
  durationMs: number;
  avgPowerWatts: number;
  /** `BENCH_KWH_USD` (11 §1) — electricity price assumption, printed alongside every result. */
  kwhUsd: number;
  /** `BENCH_HW_USD_PER_HOUR` (11 §1) — amortized hardware cost assumption. */
  hwUsdPerHour: number;
}

/** Local inference has no API bill (07 §5); this is an estimate, never a charge. */
export function localRunCostUsd({ durationMs, avgPowerWatts, kwhUsd, hwUsdPerHour }: LocalCostInput): number {
  const hours = durationMs / 3_600_000;
  const energyKwh = (avgPowerWatts * hours) / 1000;
  return energyKwh * kwhUsd + hwUsdPerHour * hours;
}

export interface AggregateStats {
  count: number;
  validityPct: number;
  ttftMsP50: number;
  ttftMsP95: number;
  totalMsP50: number;
  totalMsP95: number;
  outTokPerSec: number;
  /** null when the caller did not supply the batch's wall-clock duration. */
  reqPerSec: number | null;
  failureModeCounts: Record<FailureMode, number>;
}

const ALL_FAILURE_MODES: FailureMode[] = [
  "timeout",
  "http",
  "parse",
  "schema",
  "semantic",
  "truncated",
  "empty",
  "refusal",
  "injection_obeyed",
];

/**
 * Aggregates one (model, task, concurrency) batch of runs.
 * `batchWallMs` is the wall-clock time the whole concurrent batch took —
 * req/s is only meaningful with that number, so it is an explicit optional
 * argument rather than derived from `totalMs` (which would only be correct
 * at concurrency 1).
 */
export function aggregateRuns(runs: readonly RunMetric[], batchWallMs?: number): AggregateStats {
  if (runs.length === 0) throw new Error("aggregateRuns: runs must not be empty");

  const ttfts = runs.map((r) => r.ttftMs).filter((v): v is number => v !== null);
  const totals = runs.map((r) => r.totalMs);
  const okCount = runs.filter((r) => r.failureMode === null).length;

  const totalOutputTokens = runs.reduce((sum, r) => sum + r.outputTokens, 0);
  const totalSeconds = runs.reduce((sum, r) => sum + r.totalMs, 0) / 1000;

  const failureModeCounts = Object.fromEntries(
    ALL_FAILURE_MODES.map((mode) => [mode, runs.filter((r) => r.failureMode === mode).length]),
  ) as Record<FailureMode, number>;

  return {
    count: runs.length,
    validityPct: (okCount / runs.length) * 100,
    ttftMsP50: ttfts.length > 0 ? percentile(ttfts, 50) : 0,
    ttftMsP95: ttfts.length > 0 ? percentile(ttfts, 95) : 0,
    totalMsP50: percentile(totals, 50),
    totalMsP95: percentile(totals, 95),
    outTokPerSec: totalSeconds > 0 ? totalOutputTokens / totalSeconds : 0,
    reqPerSec: batchWallMs ? runs.length / (batchWallMs / 1000) : null,
    failureModeCounts,
  };
}
