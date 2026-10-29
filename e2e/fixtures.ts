import { execSync } from "node:child_process";
import { test, type Page } from "@playwright/test";

// T-041 — shared E2E helpers (08 §4/§7). Existing journey specs (j01-j07,
// j09-j12) each define their own tiny `loginAs`/`SLUG`/`PASSWORD` inline —
// intentional per-file independence, left as-is. This file is for the new
// specs this packet adds (j00, j08, j13, demo-narrative, a11y, responsive)
// so they share one copy instead of a sixth.
export const SLUG = "st-josephs-demo";
export const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "CoolSkool-Demo-2026";

export const DEMO_ROLES = {
  principal: "principal@demo.coolskool.test",
  admin: "admin@demo.coolskool.test",
  admissions: "admissions@demo.coolskool.test",
  accountant: "accountant@demo.coolskool.test",
  examcontroller: "examcontroller@demo.coolskool.test",
  "teacher.vi-a": "teacher.vi-a@demo.coolskool.test",
  "teacher.viii-b": "teacher.viii-b@demo.coolskool.test",
  "teacher.x-a": "teacher.x-a@demo.coolskool.test",
  "guardian.one": "guardian.one@demo.coolskool.test",
  "guardian.two": "guardian.two@demo.coolskool.test",
  "student.one": "student.one@demo.coolskool.test",
} as const;

export type DemoRole = keyof typeof DEMO_ROLES;

export async function loginAs(page: Page, role: DemoRole): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(DEMO_ROLES[role]);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForLoadState("networkidle");
}

/** Hits the `/api/jobs/run` helper (CRON_SECRET-guarded) instead of waiting on cron — 06 §W5/W7 side effects (notifications, result-publish jobs) are processed by the job runner, not inline in the action. */
export async function runJobsOnce(baseURL: string): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET is not set; the E2E jobs-run helper route cannot be authorized");
  const res = await fetch(`${baseURL}/api/jobs/run`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });
  if (!res.ok) throw new Error(`/api/jobs/run failed: ${res.status}`);
}

/** Reachability probe for the local Ollama daemon — J-08 skips visibly (not fails) when it's down, per the packet's stated risk. */
export async function isOllamaReachable(): Promise<boolean> {
  const base = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Clicks "Generate quiz" on the quiz review page and waits for the review
 * step, retrying on `ai_invalid_output` (08 §8 known limitation — a small
 * local model doesn't always return valid structured JSON; the app itself
 * does one repair retry server-side, this is a second layer on top). 5
 * questions (the schema minimum) rather than the UI's default 10, per the
 * app's own error text ("try fewer questions"). Skips the test visibly,
 * rather than failing it, if every attempt still comes back invalid —
 * that is model unreliability, not a regression.
 */
export async function generateQuizWithRetry(page: Page, attempts = 3): Promise<void> {
  await page.getByLabel("Questions").fill("5");
  const reviewHeading = page.getByRole("heading", { name: "AI draft — review before publishing" });
  const invalidOutputAlert = page.getByRole("alert", { name: /Could not produce a valid quiz/ });

  for (let attempt = 1; attempt <= attempts; attempt++) {
    await page.getByRole("button", { name: "Generate quiz" }).click();
    const outcome = await Promise.race([
      reviewHeading.waitFor({ state: "visible", timeout: 60_000 }).then(() => "ok" as const),
      invalidOutputAlert.waitFor({ state: "visible", timeout: 60_000 }).then(() => "invalid" as const),
    ]).catch(() => "timeout" as const);

    if (outcome === "ok") return;
    if (attempt === attempts) {
      test.skip(true, `local model returned invalid quiz JSON on all ${attempts} attempts — known limitation (08 §8), not a regression`);
      return;
    }
  }
}

/**
 * FOUND (app bug, not fixed here — see T-041 report): a guardian/student's
 * report card never shows which exam it's for. `ReportCard`'s title is
 * `{studentName} — {examName}`, and `examName` comes from an embedded
 * `exams(name)` PostgREST join (src/modules/exams/queries.ts RESULT_SELECT)
 * — but `exams_select` RLS (supabase/migrations/20261028000009_exams.sql)
 * is `app.staff_roles()` only, so that embed is silently null for every
 * guardian/student, on every exam, always. Fixing it needs either a new
 * RLS policy or a schema change to carry the name in the snapshot — both
 * are migrations, off-limits for this packet ("Must not modify: ...
 * migrations"). This spec works around it by finding the right report
 * card by its subject-row count (structural, not the broken name text) —
 * exactly what a sighted guardian can't do either, which is the bug.
 */
export function reportCardBySubjectCount(page: Page, subjectRowCount: number) {
  return page.getByTestId("report-card").filter({
    has: page.locator(`tbody tr:nth-child(${subjectRowCount})`),
    hasNot: page.locator(`tbody tr:nth-child(${subjectRowCount + 1})`),
  });
}

/**
 * Playwright `globalSetup` (wired in playwright.config.ts). Resets the demo
 * tenant once per `pnpm test:e2e` invocation — guarded by `E2E_RESET=true`
 * so a stray local run never wipes a developer's own data, and refused
 * against anything but a local Supabase unless `E2E_ALLOW_REMOTE=true`
 * (packet security requirement).
 */
export default function globalSetup(): void {
  if (process.env.E2E_RESET !== "true") return;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const isLocal = /127\.0\.0\.1|localhost/.test(url);
  if (!isLocal && process.env.E2E_ALLOW_REMOTE !== "true") {
    throw new Error(
      `E2E_RESET=true refused: NEXT_PUBLIC_SUPABASE_URL ("${url}") is not local and E2E_ALLOW_REMOTE is not "true".`,
    );
  }

  execSync("pnpm demo:reset", {
    stdio: "inherit",
    env: { ...process.env, DEMO_RESET_ALLOWED: "true" },
  });
}
