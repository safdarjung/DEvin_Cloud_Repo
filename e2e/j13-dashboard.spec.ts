import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { loginAs, SLUG } from "./fixtures";

// J-13 (08 §4) — principal dashboard tiles are non-zero. Collections,
// funnel and grade distribution are non-zero straight off a fresh
// `demo:reset` (the seed already ships a published Half-Yearly exam and
// ~70% fee collection, 05 §8). "Attendance today" is the one tile that
// depends on a live same-day submission (seed deliberately leaves "today"
// unsubmitted, scripts/seed/sections/attendance.ts) — this spec makes sure
// one exists directly via the service-role client (same "build the
// precondition the real flow would also have created" shortcut j04/j05/j10
// use), rather than depending on j06 having already run first in this
// worker, so this spec also passes standalone (`pnpm test:e2e -- e2e/
// j13-dashboard.spec.ts`).
function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);
}

function todayKolkata(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

async function ensureTodayAttendance(admin: SupabaseClient, institutionId: string): Promise<void> {
  const { data: section } = await admin
    .from("class_sections")
    .select("id, grades!inner(code)")
    .eq("institution_id", institutionId)
    .eq("name", "A")
    .eq("grades.code", "VI")
    .single();
  if (!section) throw new Error("seeded demo VI-A section not found");

  const date = todayKolkata();
  const { data: existing } = await admin
    .from("attendance_sessions")
    .select("id")
    .eq("class_section_id", section.id)
    .eq("date", date)
    .maybeSingle();
  if (existing) return; // already submitted (e.g. by j06 earlier in this worker) — nothing to do

  const { data: session, error: sessionError } = await admin
    .from("attendance_sessions")
    .insert({ institution_id: institutionId, class_section_id: section.id, date, status: "submitted", submitted_at: new Date().toISOString() })
    .select("id")
    .single();
  if (sessionError || !session) throw sessionError ?? new Error("fixture attendance session was not created");

  const { data: enrolments } = await admin
    .from("enrolments")
    .select("student_id")
    .eq("class_section_id", section.id)
    .eq("status", "active");
  if (!enrolments || enrolments.length === 0) throw new Error("seeded VI-A has no active enrolments");

  await admin.from("attendance_records").insert(
    enrolments.map((e, i) => ({
      institution_id: institutionId,
      session_id: session.id,
      student_id: e.student_id,
      status: i === 0 ? "A" : "P",
    })),
  );
}

function kpiValue(page: Page, label: string): Locator {
  // HomeKpi's value <p> is "font-bold" (the only bold <p> in a KPI card; the
  // class was "text-2xl" pre-M16-T10, HomeKpi now uses an arbitrary size).
  return page.locator('[data-slot="card"]').filter({ hasText: label }).locator("p.font-bold").first();
}

test.describe("J-13: principal dashboard tiles", () => {
  test("attendance, collections, funnel and grade distribution are all non-zero", async ({ page }) => {
    const admin = serviceClient();
    const { data: institution } = await admin.from("institutions").select("id").eq("slug", SLUG).single();
    if (!institution) throw new Error("seeded demo institution not found");

    await ensureTodayAttendance(admin, institution.id);

    await loginAs(page, "principal");
    await page.goto(`/${SLUG}/dashboard`);
    await expect(page.getByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening)/ })).toBeVisible();

    // KPI values count up from 0 after hydration — retrying assertions wait for the final value.
    await expect(kpiValue(page, "Attendance today")).toHaveText(/^\d+(\.\d+)?%$/);
    await expect(kpiValue(page, "Attendance today")).not.toHaveText("0%");

    await expect(kpiValue(page, "Collected this term")).toHaveText(/^₹/);
    await expect(kpiValue(page, "Collected this term")).not.toHaveText(/^₹0\.00$/);

    const openEnquiriesValue = await kpiValue(page, "Open enquiries").innerText();
    expect(openEnquiriesValue).toMatch(/^\d+$/);

    // AC2 ("dashboard tiles non-zero") is about the card having real content,
    // not a specific chart library — the funnel renders inline text/SVG
    // either way, so a non-empty card is the right-level assertion.
    const funnelCard = page.locator('[data-slot="card"]').filter({ hasText: "Admissions funnel" });
    await expect(funnelCard).not.toBeEmpty();

    const gradeDistCard = page.locator('[data-slot="card"]').filter({ hasText: "Exam grade distribution" });
    await expect(gradeDistCard.getByText("No published exam yet.")).toHaveCount(0);
    await expect(gradeDistCard.getByText(/\d+ results/)).toBeVisible();

    // M16-T10 — approvals, staff today and the attendance trend card are real data, not fixtures.
    const approvalsCard = page.locator('[data-slot="card"]').filter({ hasText: "Pending approvals" });
    await expect(approvalsCard.getByText(/Casual leave/).first()).toBeVisible();
    await expect(approvalsCard.getByText("No pending approvals")).toHaveCount(0);

    await expect(page.locator('[data-slot="card"]').filter({ hasText: "Staff today" })).toBeVisible();
    await expect(page.locator('[data-slot="card"]').filter({ hasText: "Attendance performance" })).toBeVisible();
  });
});
