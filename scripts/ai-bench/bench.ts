#!/usr/bin/env node
// T-040 — AI benchmark CLI. Plain Node (`node --env-file-if-exists=.env.local
// scripts/ai-bench/bench.ts`), same pattern as scripts/jobs-run.ts and
// scripts/demo-reset.ts. Never touches the database (bench results are
// files only) and never logs to `ai_usage_events` — it calls providers
// directly (04 §5).
//
// shortcut: cannot import `src/lib/ai/providers.ts` here. That file starts
// with `import "server-only"`, whose real package (node_modules/server-only)
// throws unconditionally unless a bundler sets the `react-server` condition
// (Next does; plain `node` and Vitest's default config don't — see
// vitest.config.mts's alias mock for the same problem). So this script
// re-creates the two tiny factories directly from the same two packages
// `providers.ts` uses (`ai-sdk-ollama`, `@ai-sdk/anthropic`), rather than
// importing the guarded file. `src/lib/ai/providers.ts` is untouched and
// stays the source of truth for the app; this is a read-only duplicate of
// its ~10 lines of factory logic for a process that can't import it.
import { createOllama } from "ai-sdk-ollama";
import type { LanguageModel } from "ai";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { aggregateRuns, classifyFailure, localRunCostUsd, costPerKOutputTokens, type RunMetric } from "./metrics.ts";
// `pricing.ts` has no imports of its own (no `server-only`, no `@/` alias),
// so unlike `providers.ts` it is safe to import directly from plain Node.
import { estimateCost } from "../../src/lib/ai/pricing.ts";
import { gpuBaseline, startGpuSampling, averagePowerWatts, peakMemUsedMiB, checkOllamaOffload } from "./gpu.ts";
import { runQuizTask, loadFixtures as loadQuizFixtures } from "./tasks/quiz.ts";
import { runSummaryTask, loadFixtures as loadSummaryFixtures } from "./tasks/summary.ts";
import { writeReport, type BatchResult } from "./report.ts";
import pkg from "../../package.json" with { type: "json" };

const execFileAsync = promisify(execFile);

const NUM_CTX = 8192;
const SEED = 42;
const TEMPERATURE = 0;
const MAX_TOKENS: Record<"quiz" | "summary", number> = { quiz: 2048, summary: 512 };
const ABORT_MS_LOCAL = 60_000;
const ABORT_MS_CLOUD = 30_000;
const WARMUP_RUNS = 3;

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith("--")) continue;
    const key = tok.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = "true";
    }
  }
  return out;
}

interface ModelSpec {
  provider: "ollama" | "anthropic";
  id: string;
  raw: string;
}

function parseModelSpec(spec: string): ModelSpec {
  const idx = spec.indexOf(":");
  if (idx === -1) throw new Error(`--models entry must be "provider:id", got "${spec}"`);
  const provider = spec.slice(0, idx);
  const id = spec.slice(idx + 1);
  if (provider !== "ollama" && provider !== "anthropic") {
    throw new Error(`Unknown provider "${provider}" in --models entry "${spec}"`);
  }
  return { provider, id, raw: spec };
}

async function resolveModel(spec: ModelSpec): Promise<LanguageModel | null> {
  if (spec.provider === "ollama") {
    const ollama = createOllama({ baseURL: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434" });
    return ollama(spec.id, { options: { num_ctx: NUM_CTX, temperature: TEMPERATURE, seed: SEED } });
  }

  // cloud — skip cleanly, never crash (lead ruling: no ANTHROPIC_API_KEY here).
  const cloudEnabled = process.env.AI_CLOUD_ENABLED === "true";
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
  if (!cloudEnabled || !hasKey) {
    const reason = !cloudEnabled ? "AI_CLOUD_ENABLED is not \"true\"" : "ANTHROPIC_API_KEY is not set";
    console.log(`[skip] ${spec.raw}: cloud model skipped (${reason})`);
    return null;
  }
  const { createAnthropic } = await import("@ai-sdk/anthropic");
  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropic(spec.id);
}

async function ollamaModelDigest(modelId: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("ollama", ["list"]);
    const line = stdout.split("\n").find((l) => l.startsWith(modelId));
    if (!line) return null;
    const parts = line.trim().split(/\s+/);
    return parts[1] ?? null; // NAME, ID, SIZE, MODIFIED...
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const devStack = (args["dev-stack"] ?? "up") as "up" | "down";
  if (devStack === "down") {
    console.warn(
      "[warn] --dev-stack down only LABELS this run's metadata as taken with the dev stack down. " +
        "This script never stops Docker/Supabase itself — stop it yourself first if that's the comparison " +
        "you want, and never while another process depends on it.",
    );
  }

  const modelSpecs = (args.models ?? "ollama:qwen2.5:3b").split(",").map(parseModelSpec);
  const tasks = (args.tasks ?? "quiz,summary").split(",") as Array<"quiz" | "summary">;
  const n = Number.parseInt(args.n ?? "20", 10);
  const concurrencyLevels = (args.concurrency ?? "1,4,8").split(",").map((c) => Number.parseInt(c, 10));

  const kwhUsd = Number.parseFloat(process.env.BENCH_KWH_USD ?? "0.10");
  const hwUsdPerHour = Number.parseFloat(process.env.BENCH_HW_USD_PER_HOUR ?? "0.15");
  console.log(
    `[assumption] BENCH_KWH_USD=${kwhUsd} (electricity $/kWh) · BENCH_HW_USD_PER_HOUR=${hwUsdPerHour} (amortized local hardware $/h) — local cost numbers are estimates, never a bill (07 §5).`,
  );

  const baseline = await gpuBaseline();
  if (baseline) {
    console.log(`[gpu] baseline before any model load: ${baseline.memUsedMiB} MiB used, ${baseline.powerDrawW} W`);
  } else {
    console.log("[gpu] nvidia-smi unavailable — no GPU numbers will be recorded.");
  }

  const batches: BatchResult[] = [];
  const injectionOutcomes: Array<{ model: string; obeyed: boolean }> = [];
  const peakVramMiB: Record<string, number> = {};

  for (const spec of modelSpecs) {
    const model = await resolveModel(spec);
    if (!model) continue;

    const abortMs = spec.provider === "ollama" ? ABORT_MS_LOCAL : ABORT_MS_CLOUD;
    const seed = spec.provider === "ollama" ? SEED : undefined; // Anthropic has no seed param (packet assumption)

    const sampler = startGpuSampling(500);
    let offload: string = "unknown";

    for (const task of tasks) {
      const maxOutputTokens = MAX_TOKENS[task];
      const taskOpts = { temperature: TEMPERATURE, seed, maxOutputTokens };

      // Each task owns its own fixture shape (summary's carries
      // `isInjectionFixture`); loaded once per (model, task) and indexed by
      // `runOnce` rather than re-read from disk per run.
      const quizFixtures = task === "quiz" ? loadQuizFixtures() : null;
      const summaryFixtures = task === "summary" ? loadSummaryFixtures() : null;
      const fixtureCount = (quizFixtures ?? summaryFixtures)?.length ?? 0;
      if (fixtureCount === 0) throw new Error(`No fixtures found for task "${task}"`);

      const runOnce = async (index: number) => {
        const abortSignal = AbortSignal.timeout(abortMs);
        return quizFixtures
          ? runQuizTask(model, quizFixtures[index % quizFixtures.length], { ...taskOpts, abortSignal })
          : runSummaryTask(model, summaryFixtures![index % summaryFixtures!.length], { ...taskOpts, abortSignal });
      };

      // 3 warm-up runs, discarded, at concurrency 1 (packet: "3 warm-up runs discarded").
      for (let i = 0; i < WARMUP_RUNS; i++) {
        await runOnce(i);
      }
      if (spec.provider === "ollama" && offload === "unknown") {
        offload = await checkOllamaOffload(spec.id);
      }

      for (const concurrency of concurrencyLevels) {
        const runs: RunMetric[] = [];
        const wallStart = performance.now();
        const wallStartedAt = Date.now();

        let completed = 0;
        while (completed < n) {
          const batchSize = Math.min(concurrency, n - completed);
          const batch = await Promise.all(
            Array.from({ length: batchSize }, (_, i) => runOnce(completed + i)),
          );
          for (const r of batch) {
            // No independent semantic judge exists yet (07 §5: no claim
            // this bench can't measure) — every run is `semanticOk: null`.
            const withSemantic = { ...r, semanticOk: null };
            const failureMode = classifyFailure(withSemantic);
            runs.push({ ...withSemantic, failureMode });
            if (r.isInjectionFixture) injectionOutcomes.push({ model: spec.raw, obeyed: r.injectionObeyed });
          }
          completed += batchSize;
        }

        const wallMs = performance.now() - wallStart;
        const stats = aggregateRuns(runs, wallMs);
        const windowSamples = sampler.peek().filter((s) => s.atMs >= wallStartedAt);
        const avgPowerW = averagePowerWatts(windowSamples);
        const totalOutputTokens = runs.reduce((s, r) => s + r.outputTokens, 0);
        const totalInputTokens = runs.reduce((s, r) => s + r.inputTokens, 0);

        const costPer1kOutputTokensUsd =
          spec.provider === "ollama"
            ? costPerKOutputTokens(
                localRunCostUsd({ durationMs: wallMs, avgPowerWatts: avgPowerW, kwhUsd, hwUsdPerHour }),
                totalOutputTokens,
              )
            : costPerKOutputTokens(estimateCost("cloud", spec.id, totalInputTokens, totalOutputTokens), totalOutputTokens);

        batches.push({
          model: spec.raw,
          task,
          concurrency,
          stats,
          costPer1kOutputTokensUsd,
          offload,
        });
      }
    }

    peakVramMiB[spec.raw] = peakMemUsedMiB(sampler.stop());
  }

  const digestNotes = await Promise.all(
    modelSpecs
      .filter((s) => s.provider === "ollama")
      .map(async (s) => `${s.raw} digest=${(await ollamaModelDigest(s.id)) ?? "unknown"}`),
  );

  mkdirSync(join(process.cwd(), "bench-results"), { recursive: true });
  await writeReport({
    batches,
    injectionOutcomes,
    devStack,
    gpuBaselineMiB: baseline?.memUsedMiB ?? null,
    peakVramMiB,
    kwhUsd,
    hwUsdPerHour,
    packageVersions: {
      ai: (pkg as { dependencies: Record<string, string> }).dependencies.ai,
      "ai-sdk-ollama": (pkg as { dependencies: Record<string, string> }).dependencies["ai-sdk-ollama"],
      "@ai-sdk/anthropic": (pkg as { dependencies: Record<string, string> }).dependencies["@ai-sdk/anthropic"],
    },
    modelDigests: digestNotes,
  });
}

main().catch((err: unknown) => {
  console.error("ai:bench failed:", err);
  process.exit(1);
});
