// T-043 L4 — public site (08 §6 / 09 Day 15,17). 50 rps for 2 min on
// `/s/st-josephs-demo`, anonymous (RLS class P, no login needed).
// Dry run: `LOAD_TARGET_URL=http://localhost:3000 pnpm load:l4 -- --duration 5 --rate 2`
import autocannon from "autocannon";
import { mkdirSync, writeFileSync } from "node:fs";
import { requireLoadTarget } from "./auth.ts";

const SLUG = "st-josephs-demo";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok.startsWith("--")) out[tok.slice(2)] = argv[i + 1];
  }
  return out;
}

async function main(): Promise<void> {
  const target = requireLoadTarget();
  const args = parseArgs(process.argv.slice(2));
  const durationSec = Number(args.duration ?? 120);
  const rate = Number(args.rate ?? 50);

  console.log(`L4: /s/${SLUG} — ${durationSec}s @ ${rate} rps`);
  const result = await autocannon({
    url: `${target}/s/${SLUG}`,
    connections: Math.max(10, rate),
    duration: durationSec,
    overallRate: rate,
  });

  const summary = {
    scenario: "L4 public site",
    durationSec,
    rate,
    requests: result.requests,
    // autocannon buckets percentiles at 90/97.5/99, not 95 — p97_5 is the
    // nearest available bucket, used here as the "p95" figure.
    latency: { p50: result.latency.p50, p95: result.latency.p97_5, max: result.latency.max },
    errors: result.errors,
    non2xx: result.non2xx,
    timeouts: result.timeouts,
    // 200/304/etc cache behaviour — observed, not asserted (packet: "cache behaviour").
    statusCodes: result.statusCodeStats,
  };

  console.log(JSON.stringify(summary, null, 2));
  mkdirSync("scripts/load/out", { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(`scripts/load/out/l4-${stamp}.json`, JSON.stringify(summary, null, 2));
  writeFileSync(
    `scripts/load/out/l4-${stamp}.md`,
    `# L4 public site\n\n| duration (s) | target rps | p50 (ms) | p95 (ms) | errors | non-2xx | timeouts |\n` +
      `|---|---|---|---|---|---|---|\n` +
      `| ${durationSec} | ${rate} | ${summary.latency.p50} | ${summary.latency.p95} | ${result.errors} | ${result.non2xx} | ${result.timeouts} |\n`,
  );
}

main().catch((err: unknown) => {
  console.error("load:l4 failed:", err);
  process.exit(1);
});
