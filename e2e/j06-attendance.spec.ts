import { createClient } from "@supabase/supabase-js";
import { expect, type Page, test } from "@playwright/test";

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);
}

// J-06 (08 §4) — attendance session -> submit -> absence notification. Runs
// against the seeded demo tenant (`st-josephs-demo`) rather than a
// self-contained fixture: the attendance seed (T-016) is still a stub
// (scripts/seed/sections/attendance.ts), so there is no pre-existing
// session for today — this spec exercises the first-time "open register,
// mark everyone, submit" path, not a pre-seeded one. The message-log
// assertion (confirming the in-app/SMS-simulated notification itself) is
// deferred to T-038's owner per the packet, once notifications/** lands.
//
// FOUND (seed data, not this packet): the academics seed assigns the
// "VI-A Class Teacher" staff row as `class_teacher_id` of TWO sections
// (I-A and VI-A), not just VI-A — confirmed by querying class_sections
// directly after `pnpm demo:reset`. AC1 ("teacher.vi-a sees only VI-A")
// is proved cleanly at the action layer in
// tests/db/attendance-actions.test.ts with an isolated fixture; this spec
// works around the seed bug by scoping to the VI-A row specifically
// rather than asserting there is exactly one row. Flagged for the
// academics-seed owner (T-011/seed), not fixed here (not this packet's file).
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "CoolSkool-Demo-2026";
const SLUG = "st-josephs-demo";

async function loginAs(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForLoadState("networkidle");
}

test.describe("J-06: attendance marking and submission", () => {
  function viaRow(page: Page) {
    return page.getByRole("listitem").filter({ hasText: "VI-A" }).getByRole("link", { name: "Open register" });
  }

  test("teacher.vi-a sees VI-A under /attendance", async ({ page }) => {
    await loginAs(page, "teacher.vi-a@demo.coolskool.test");
    await page.goto(`/${SLUG}/attendance`);

    await expect(page.getByRole("heading", { name: "Attendance" })).toBeVisible();
    await expect(viaRow(page)).toHaveCount(1);
  });

  test("teacher.viii-b cannot open VI-A's register directly", async ({ page }) => {
    await loginAs(page, "teacher.vi-a@demo.coolskool.test");
    await page.goto(`/${SLUG}/attendance`);
    const href = await viaRow(page).getAttribute("href");
    expect(href).toBeTruthy();

    await loginAs(page, "teacher.viii-b@demo.coolskool.test");
    const response = await page.goto(`${new URL(href!, page.url()).pathname}${new URL(href!, page.url()).search}`);
    expect(response?.status()).toBe(404);
  });

  test("marking every student and submitting shows the absence/notification feedback", async ({ page }) => {
    // e2e stability (Batch C): this test creates and submits a real
    // attendance_sessions row for VI-A/today in the shared demo tenant —
    // a second run on the same calendar day (e.g. a second full
    // `pnpm test:e2e` pass) finds that session already `submitted`, so
    // "Save"/"Submit" never render and the test times out waiting for
    // them. Delete any such row first so the register always starts
    // `open` (attendance_sessions/records carry no block_mutation guard,
    // unlike attendance_corrections — a plain service-role delete is fine).
    const admin = serviceClient();
    const { data: institution } = await admin.from("institutions").select("id").eq("slug", SLUG).single();
    const { data: section } = await admin
      .from("class_sections")
      .select("id, grades!inner(code)")
      .eq("institution_id", institution!.id)
      .eq("name", "A")
      .eq("grades.code", "VI")
      .single();
    const { data: session } = await admin
      .from("attendance_sessions")
      .select("id")
      .eq("class_section_id", section!.id)
      // The app computes "today" in the institution's timezone (Asia/Kolkata,
      // 05 §4.1 locale), not UTC — `toISOString()` alone is wrong whenever
      // UTC and Kolkata disagree on the calendar date (UTC+5:30), which is
      // most of the day.
      .eq("date", new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }))
      .maybeSingle();
    if (session) {
      // shortcut: doesn't delete attendance_corrections first (append-only,
      // block_mutation-guarded — a service-role DELETE would need the
      // allow_reset GUC, unreachable over PostgREST). Fine here: this test
      // never clicks "Correct", so the session it created has none.
      await admin.from("attendance_records").delete().eq("session_id", session.id);
      await admin.from("attendance_sessions").delete().eq("id", session.id);
    }

    await loginAs(page, "teacher.vi-a@demo.coolskool.test");
    await page.goto(`/${SLUG}/attendance`);
    await viaRow(page).click();
    await page.waitForLoadState("networkidle");

    const rows = page.getByRole("row");
    const rowCount = await rows.count();
    // Header row + at least one student row — a near-empty roster would
    // mean the academics/people seed didn't run, not that this flow is broken.
    expect(rowCount).toBeGreaterThan(1);

    const presentButtons = page.locator('[role="radiogroup"] button', { hasText: "P" });
    const presentCount = await presentButtons.count();
    for (let i = 0; i < presentCount; i++) {
      await presentButtons.nth(i).click();
    }

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/Saved attendance for \d+ students\./)).toBeVisible();

    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText(/Attendance submitted — \d+ absences?, guardians notified \(SMS simulated\)\./)).toBeVisible();
  });
});
