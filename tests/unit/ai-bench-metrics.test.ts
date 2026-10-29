// T-040 — pure math/classification used by the bench report. No I/O, no
// provider imports: these are the functions `scripts/ai-bench/metrics.ts`
// exports, tested the same way any other pure unit is (06 §1.3 style).
import { describe, expect, test } from "vitest";
import {
  aggregateRuns,
  classifyFailure,
  costPerKOutputTokens,
  localRunCostUsd,
  percentile,
  type RunMetric,
} from "../../scripts/ai-bench/metrics.ts";

function run(overrides: Partial<RunMetric> = {}): RunMetric {
  return {
    ttftMs: 100,
    totalMs: 1000,
    inputTokens: 300,
    outputTokens: 200,
    jsonParseOk: true,
    schemaOkFirst: true,
    schemaOkAfterRepair: true,
    semanticOk: true,
    finishReason: "stop",
    failureMode: null,
    ...overrides,
  };
}

describe("percentile", () => {
  test("returns the exact value for a single-element array", () => {
    expect(percentile([42], 50)).toBe(42);
  });

  test("computes p50 and p95 on a sorted sample the same way regardless of input order", () => {
    const values = [5, 1, 4, 2, 3];
    expect(percentile(values, 50)).toBe(3);
    expect(percentile(values, 95)).toBe(5);
  });

  test("throws on an empty array instead of returning a silent NaN", () => {
    expect(() => percentile([], 50)).toThrow();
  });
});

describe("classifyFailure", () => {
  test("returns null for a clean successful run", () => {
    expect(classifyFailure(run())).toBeNull();
  });

  test("classifies an aborted run as timeout regardless of other fields", () => {
    expect(classifyFailure(run({ timedOut: true, jsonParseOk: false }))).toBe("timeout");
  });

  test("classifies a transport/HTTP error", () => {
    expect(classifyFailure(run({ httpError: true }))).toBe("http");
  });

  test("classifies unparsable output as parse before checking schema", () => {
    expect(classifyFailure(run({ jsonParseOk: false, schemaOkAfterRepair: false }))).toBe("parse");
  });

  test("classifies output that parses but never matches the schema as schema", () => {
    expect(classifyFailure(run({ schemaOkFirst: false, schemaOkAfterRepair: false }))).toBe("schema");
  });

  test("classifies a schema-valid but semantically wrong answer as semantic", () => {
    expect(classifyFailure(run({ semanticOk: false }))).toBe("semantic");
  });

  test("classifies a length-capped finish reason as truncated", () => {
    expect(classifyFailure(run({ finishReason: "length" }))).toBe("truncated");
  });

  test("classifies zero output tokens as empty", () => {
    expect(classifyFailure(run({ outputTokens: 0 }))).toBe("empty");
  });

  test("classifies a detected refusal", () => {
    expect(classifyFailure(run({ refusalDetected: true }))).toBe("refusal");
  });

  test("classifies an injection fixture the model obeyed, even though the schema is valid", () => {
    expect(classifyFailure(run({ isInjectionFixture: true, injectionObeyed: true }))).toBe(
      "injection_obeyed",
    );
  });

  test("an injection fixture the model resisted is not a failure", () => {
    expect(classifyFailure(run({ isInjectionFixture: true, injectionObeyed: false }))).toBeNull();
  });
});

describe("costPerKOutputTokens", () => {
  test("scales a known USD cost to a per-1k-output-token rate", () => {
    expect(costPerKOutputTokens(0.004, 2000)).toBeCloseTo(0.002, 6);
  });

  test("returns 0 when there are no output tokens, instead of dividing by zero", () => {
    expect(costPerKOutputTokens(0.004, 0)).toBe(0);
  });
});

describe("localRunCostUsd", () => {
  test("combines energy cost and hardware-hour cost with the documented assumptions", () => {
    // 100 W for 36 s = 1 Wh = 0.001 kWh; at $0.10/kWh that's $0.0001.
    // Hardware: $1/h for 36s = $0.01.
    const cost = localRunCostUsd({
      durationMs: 36_000,
      avgPowerWatts: 100,
      kwhUsd: 0.1,
      hwUsdPerHour: 1,
    });
    expect(cost).toBeCloseTo(0.0001 + 0.01, 6);
  });

  test("is zero when both assumption inputs are zero", () => {
    const cost = localRunCostUsd({
      durationMs: 36_000,
      avgPowerWatts: 100,
      kwhUsd: 0,
      hwUsdPerHour: 0,
    });
    expect(cost).toBe(0);
  });
});

describe("aggregateRuns", () => {
  test("computes p50/p95 latency, validity %, out tok/s, and the failure breakdown", () => {
    const runs: RunMetric[] = [
      run({ ttftMs: 100, totalMs: 1000, outputTokens: 200 }),
      run({ ttftMs: 200, totalMs: 2000, outputTokens: 200 }),
      run({ ttftMs: 300, totalMs: 3000, outputTokens: 200, failureMode: "schema", semanticOk: false }),
    ];

    const stats = aggregateRuns(runs);

    expect(stats.count).toBe(3);
    expect(stats.validityPct).toBeCloseTo((2 / 3) * 100, 6);
    expect(stats.ttftMsP50).toBe(200);
    expect(stats.totalMsP50).toBe(2000);
    expect(stats.outTokPerSec).toBeGreaterThan(0);
    expect(stats.failureModeCounts.schema).toBe(1);
  });

  test("computes req/s from the supplied wall-clock batch duration", () => {
    const runs: RunMetric[] = [run(), run(), run(), run()];
    const stats = aggregateRuns(runs, 2000);
    expect(stats.reqPerSec).toBeCloseTo(2, 6);
  });

  test("req/s is null when no batch wall-clock duration is supplied", () => {
    const stats = aggregateRuns([run()]);
    expect(stats.reqPerSec).toBeNull();
  });

  test("throws on an empty run list instead of producing NaN statistics", () => {
    expect(() => aggregateRuns([])).toThrow();
  });
});
