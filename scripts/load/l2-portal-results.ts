// T-043 L2 — result-day guardian load (08 §6 / 09 Day 15,17). Baseline
// 1.7 rps for 10 min, then peak 10 rps for 5 min, on
// `/[institution]/portal/results`, via autocannon's programmatic API
// (named in the packet) with real guardian session cookies.
//
// Deviation: the packet's "200 guardian sessions reused round-robin"
// assumes 200 guardian logins. The seed (05 §8.1, another lane's contract,
// not touched here) only creates 2 named guardian logins (guardian.one,
// guardian.two) — ~2,400 other `guardians` rows exist with no `auth.users`
// row at all, so no password to sign in with. This script round-robins
// the 2 real sessions across connections instead of 200; documented in the
// result file. Request volume (rps) is unaffected — only session identity
// diversity is reduced.
import autocannon from "autocannon";
import { mkdirSync, writeFileSync } from "node:fs";
import { requireLoadTarget, loginCookieHeader } from "./auth.ts";

const SLUG = "st-josephs-demo";
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "CoolSkool-Demo-2026";
const GUARDIAN_EMAILS = ["guardian.one@demo.coolskool.test", "guardian.two@demo.coolskool.test"];

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok.startsWith("--")) out[tok.slice(2)] = argv[i + 1];
  }
  return out;
}

/**
 * The portal results page 307-redirects a guardian with multiple children
 * to `?student=<id>` (its default selection) — autocannon doesn't follow
 * redirects, so a plain `path` would only ever measure the redirect itself.
 * Resolved once per login, outside the measured window.
 */
async function resolveResultsPath(baseUrl: string, cookie: string): Promise<string> {
  const defaultPath = `/${SLUG}/portal/results`;
  const res = await fetch(`${baseUrl}${defaultPath}`, { headers: { cookie }, redirect: "manual" });
  if (res.status === 307 || res.status === 308) {
    const location = res.headers.get("location");
    if (location) return location.startsWith("http") ? new URL(location).pathname + (new URL(location).search ?? "") : location;
  }
  return defaultPath;
}

async function runPhase(
  label: string,
  baseUrl: string,
  sessions: Array<{ cookie: string; path: string }>,
  durationSec: number,
  rate: number,
) {
  let idx = 0;
  const instance = autocannon({
    url: baseUrl,
    connections: Math.max(10, sessions.length),
    duration: durationSec,
    overallRate: rate,
    setupClient(client) {
      const session = sessions[idx % sessions.length];
      idx += 1;
      client.setRequests([{ method: "GET", path: session.path, headers: { cookie: session.cookie } }]);
    },
  });
  console.log(`L2 ${label}: ${durationSec}s @ ${rate} rps`);
  const result = await instance;
  return {
    label,
    durationSec,
    rate,
    requests: result.requests,
    // autocannon buckets percentiles at 90/97.5/99, not 95 — p97_5 is the
    // nearest available bucket, used here as the "p95" figure.
    latency: { p50: result.latency.p50, p95: result.latency.p97_5, max: result.latency.max },
    errors: result.errors,
    non2xx: result.non2xx,
    timeouts: result.timeouts,
  };
}

async function main(): Promise<void> {
  const target = requireLoadTarget();
  const args = parseArgs(process.argv.slice(2));
  const d1 = Number(args.d1 ?? 600);
  const r1 = Number(args.r1 ?? 1.7);
  const d2 = Number(args.d2 ?? 300);
  const r2 = Number(args.r2 ?? 10);

  const cookies = await Promise.all(GUARDIAN_EMAILS.map((email) => loginCookieHeader(email, PASSWORD)));
  const sessions = await Promise.all(cookies.map(async (cookie) => ({ cookie, path: await resolveResultsPath(target, cookie) })));

  const baseline = await runPhase("baseline", target, sessions, d1, r1);
  const peak = await runPhase("peak", target, sessions, d2, r2);

  const result = {
    scenario: "L2 result-day guardian load",
    deviation: "2 real guardian logins round-robinned across connections, not 200 (seed only names 2).",
    baseline,
    peak,
  };

  console.log(JSON.stringify(result, null, 2));
  mkdirSync("scripts/load/out", { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(`scripts/load/out/l2-${stamp}.json`, JSON.stringify(result, null, 2));
  writeFileSync(
    `scripts/load/out/l2-${stamp}.md`,
    `# L2 result-day guardian load\n\n| phase | duration (s) | target rps | p50 TTFB (ms) | p95 TTFB (ms) | errors | non-2xx | timeouts |\n` +
      `|---|---|---|---|---|---|---|---|\n` +
      [baseline, peak]
        .map(
          (p) =>
            `| ${p.label} | ${p.durationSec} | ${p.rate} | ${p.latency.p50} | ${p.latency.p95} | ${p.errors} | ${p.non2xx} | ${p.timeouts} |`,
        )
        .join("\n") +
      `\n\nDeviation: ${result.deviation}\n`,
  );
}

main().catch((err: unknown) => {
  console.error("load:l2 failed:", err);
  process.exit(1);
});
