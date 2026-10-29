// T-040 — writes `bench-results/<iso>-<sha>.json` (full raw aggregates) and
// `bench-results/latest.md` (the table + assumption footnotes humans read).
// 07 §5: no capability claim is made anywhere else until this file exists.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AggregateStats } from "./metrics.ts";

const execFileAsync = promisify(execFile);

export interface BatchResult {
  model: string;
  task: "quiz" | "summary";
  concurrency: number;
  stats: AggregateStats;
  costPer1kOutputTokensUsd: number;
  offload: string;
}

export interface ReportInput {
  batches: BatchResult[];
  injectionOutcomes: Array<{ model: string; obeyed: boolean }>;
  devStack: "up" | "down";
  gpuBaselineMiB: number | null;
  peakVramMiB: Record<string, number>;
  kwhUsd: number;
  hwUsdPerHour: number;
  packageVersions: Record<string, string | undefined>;
  modelDigests: string[];
}

async function gitShortSha(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--short", "HEAD"]);
    return stdout.trim();
  } catch {
    return "nogit";
  }
}

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : "n/a";
}

function buildMarkdown(input: ReportInput, sha: string): string {
  const lines: string[] = [];
  lines.push(`# AI bench results`);
  lines.push("");
  lines.push(`Generated ${new Date().toISOString()} at commit \`${sha}\`. Dev stack: **${input.devStack}**.`);
  lines.push("");
  lines.push(
    "| model | task | conc | n | validity % | TTFT p50 ms | total p50 ms | total p95 ms | out tok/s | req/s | $/1k out tok | offload |",
  );
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const b of input.batches) {
    const s = b.stats;
    lines.push(
      `| ${b.model} | ${b.task} | ${b.concurrency} | ${s.count} | ${fmt(s.validityPct)} | ${fmt(s.ttftMsP50)} | ${fmt(s.totalMsP50)} | ${fmt(s.totalMsP95)} | ${fmt(s.outTokPerSec)} | ${s.reqPerSec === null ? "n/a" : fmt(s.reqPerSec)} | ${fmt(b.costPer1kOutputTokensUsd)} | ${b.offload} |`,
    );
  }

  lines.push("");
  lines.push("## Failure modes per batch");
  lines.push("");
  for (const b of input.batches) {
    const nonZero = Object.entries(b.stats.failureModeCounts).filter(([, c]) => c > 0);
    if (nonZero.length === 0) continue;
    lines.push(`- ${b.model} / ${b.task} / c=${b.concurrency}: ${nonZero.map(([m, c]) => `${m}=${c}`).join(", ")}`);
  }
  if (!input.batches.some((b) => Object.values(b.stats.failureModeCounts).some((c) => c > 0))) {
    lines.push("- none recorded");
  }

  lines.push("");
  lines.push("## Injection fixture outcome (per model)");
  lines.push("");
  if (input.injectionOutcomes.length === 0) {
    lines.push(
      "- no run reached the injection fixture — either the summary task wasn't included, or `n` was too " +
        "small to round-robin as far as fixture 5 of 5 (`summary-5-injection.txt`).",
    );
  } else {
    const byModel = new Map<string, boolean>();
    for (const o of input.injectionOutcomes) {
      byModel.set(o.model, byModel.get(o.model) === true || o.obeyed);
    }
    for (const [model, obeyed] of byModel) {
      lines.push(`- ${model}: ${obeyed ? "OBEYED the injected instruction at least once (fail)" : "resisted every run"}`);
    }
  }

  lines.push("");
  lines.push("## Assumptions and environment (every number above depends on these)");
  lines.push("");
  lines.push(`- Electricity price: \`BENCH_KWH_USD=${input.kwhUsd}\` USD/kWh (assumption, not metered).`);
  lines.push(`- Amortized local hardware: \`BENCH_HW_USD_PER_HOUR=${input.hwUsdPerHour}\` USD/hour (assumption).`);
  lines.push(`- Cloud cost uses \`src/lib/ai/pricing.ts\`'s per-model USD/MTok table — an estimate, never a bill.`);
  lines.push(
    `- GPU baseline before any model load: ${input.gpuBaselineMiB === null ? "unavailable (no nvidia-smi)" : `${input.gpuBaselineMiB} MiB`}.`,
  );
  for (const [model, mib] of Object.entries(input.peakVramMiB)) {
    lines.push(`- Peak VRAM observed for ${model}: ${mib} MiB.`);
  }
  lines.push(`- Package versions: ${Object.entries(input.packageVersions).map(([k, v]) => `${k}@${v}`).join(", ")}.`);
  for (const d of input.modelDigests) lines.push(`- ${d}`);
  lines.push(
    "- `offload` comes from `ollama ps`: `full_gpu` means 100% GPU; `offload_partial` means some layers spilled to CPU (desktop already uses ~2.8–2.9 GB VRAM at rest — 11 §1, 12 §2) — treat throughput numbers as lower bounds when partial.",
  );
  lines.push("- No performance or capability claim outside this file is valid until this file exists with real numbers (07 §5).");
  lines.push("");

  return lines.join("\n");
}

export async function writeReport(input: ReportInput): Promise<void> {
  const sha = await gitShortSha();
  const iso = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(process.cwd(), "bench-results");

  const jsonPath = join(dir, `${iso}-${sha}.json`);
  writeFileSync(jsonPath, JSON.stringify(input, null, 2));

  const mdPath = join(dir, "latest.md");
  writeFileSync(mdPath, buildMarkdown(input, sha));

  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);
}
