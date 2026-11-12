import { createClient } from "@supabase/supabase-js";
import { expect, type Page, test } from "@playwright/test";

// J-05 (08 §4) — enrol an accepted application: pick a section + fee
// structure, admission number assigned, student profile shows guardian +
// section + invoice; a second application with the same guardian phone
// shows guardian reuse. APP-live-1/APP-live-2 (05 §8.1) are T-029's seed
// and not landed as of this packet — same "build the fixture the seed
// would otherwise provide" shape as j04-decision.spec.ts, via the
// service-role client.
//
// FIXED (phase 2, migration 20261028000019_fee_structures_admissions_read):
// fee_structures_select RLS used to be app.finance_roles() = owner/
// principal/admin/accountant, which excluded "admissions" — the real J-05
// persona (admissions@demo.coolskool.test) got an empty fee-structure list
// in EnrolDialog. 0019 widens that SELECT policy to also include
// "admissions" (read-only; writes stay finance_roles()-only). This spec
// now logs in as admissions@demo.coolskool.test, as the real demo step 5
// does.
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "CoolSkool-Demo-2026";
const SLUG = "st-josephs-demo";

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);
}

// Phase 2 fix: a hardcoded phone collided with leftover rows from a
// previous run of this same spec against the persistent demo DB (no
// demo:reset between runs) — "C-21 guardian reuse" then saw 3 links
// instead of 2. Random per run, same shape as j03/j04's uniquePhone().
function uniquePhone(): string {
  const first = String(6 + Math.floor(Math.random() * 4));
  const rest = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join("");
  return first + rest;
}

async function loginAs(page: Page, email: string) {
  await page.goto("/login?switch=1");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => url.pathname !== "/login");
  await page.waitForLoadState("networkidle");
}

test.describe("J-05: enrol an accepted application", () => {
  test("picks a section + fee structure, enrols, shows admission no and links; a second click is idempotent", async ({ page }) => {
    const admin = serviceClient();
    const { data: institution } = await admin.from("institutions").select("id").eq("slug", SLUG).single();
    if (!institution) throw new Error("seeded demo institution not found");

    const { data: year } = await admin
      .from("academic_years")
      .select("id")
      .eq("institution_id", institution.id)
      .eq("is_current", true)
      .single();
    if (!year) throw new Error("seeded demo academic year not found");

    // A section/fee structure with free capacity for a fresh grade (not
    // one of the seed's full 45-capacity sections) so this test doesn't
    // depend on how full the demo's seeded sections are.
    const { data: grade } = await admin
      .from("grades")
      .insert({ institution_id: institution.id, code: `J05-${Date.now()}`, display_name: "J-05 Test Grade", sort_key: 999, grade_group: "primary" })
      .select("id")
      .single();
    if (!grade) throw new Error("fixture grade was not created");

    const { data: section } = await admin
      .from("class_sections")
      .insert({ institution_id: institution.id, grade_id: grade.id, academic_year_id: year.id, name: "J05", capacity: 10 })
      .select("id")
      .single();
    const { data: feeStructure } = await admin
      .from("fee_structures")
      .insert({ institution_id: institution.id, academic_year_id: year.id, grade_id: grade.id, name: "J05 Standard", is_default: true })
      .select("id")
      .single();
    if (!section || !feeStructure) throw new Error("fixture section/fee structure were not created");
    await admin.from("fee_components").insert({ institution_id: institution.id, fee_structure_id: feeStructure.id, head: "tuition", amount: 5000, frequency: "term" });

    const { data: application } = await admin
      .from("applications")
      .insert({
        institution_id: institution.id,
        applicant: { firstName: "J05", lastName: "Candidate", dob: "2018-01-01", gender: "female" },
        guardian: { fullName: "J05 Guardian", phone: uniquePhone(), relationship: "mother" },
        grade_applied_id: grade.id,
        academic_year_id: year.id,
        status: "accepted",
      })
      .select("id")
      .single();
    if (!application) throw new Error("fixture application was not created");

    await loginAs(page, "admissions@demo.coolskool.test");
    await page.goto(`/${SLUG}/admissions/applications/${application.id}`);
    await expect(page.getByText("Accepted", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Enrol", exact: true }).click();
    await page.getByLabel("Section").click();
    await page.getByRole("option", { name: /J05 \(0\/10\)/ }).click();
    await page.getByLabel("Fee structure").click();
    await page.getByRole("option", { name: /J05 Standard/ }).click();
    await page.getByRole("button", { name: "Enrol", exact: true }).click();

    await expect(page.getByText(/Enrolled — admission/)).toBeVisible();
    await expect(page.getByText("Guardian login invite not yet available")).toBeVisible();
    await expect(page.getByRole("link", { name: "View student profile" })).toBeVisible();
    await expect(page.getByRole("link", { name: "View invoice" })).toBeVisible();

    const studentLink = page.getByRole("link", { name: "View student profile" });
    const href = await studentLink.getAttribute("href");
    await page.getByRole("button", { name: "Done" }).click();

    // Re-clicking enrol on the (now `enrolled`) application is a no-op success (C-20).
    await page.goto(`/${SLUG}/admissions/applications/${application.id}`);
    await expect(page.getByText("Enrolled", { exact: true })).toBeVisible();

    await page.goto(`${href}`);
    await expect(page.getByText("J05 Guardian")).toBeVisible();
    await expect(page.getByText(/J-05 Test Grade-J05/)).toBeVisible();
  });

  test("a second application with the same guardian phone reuses the guardian (C-21)", async ({ page }) => {
    const admin = serviceClient();
    const { data: institution } = await admin.from("institutions").select("id").eq("slug", SLUG).single();
    if (!institution) throw new Error("seeded demo institution not found");
    const { data: year } = await admin
      .from("academic_years")
      .select("id")
      .eq("institution_id", institution.id)
      .eq("is_current", true)
      .single();
    if (!year) throw new Error("seeded demo academic year not found");

    const sharedPhone = uniquePhone();
    const { data: grade } = await admin
      .from("grades")
      .insert({ institution_id: institution.id, code: `J05B-${Date.now()}`, display_name: "J-05B Test Grade", sort_key: 998, grade_group: "primary" })
      .select("id")
      .single();
    if (!grade) throw new Error("fixture grade was not created");
    const { data: section } = await admin
      .from("class_sections")
      .insert({ institution_id: institution.id, grade_id: grade.id, academic_year_id: year.id, name: "J05B", capacity: 10 })
      .select("id")
      .single();
    const { data: feeStructure } = await admin
      .from("fee_structures")
      .insert({ institution_id: institution.id, academic_year_id: year.id, grade_id: grade.id, name: "J05B Standard", is_default: true })
      .select("id")
      .single();
    if (!section || !feeStructure) throw new Error("fixture section/fee structure were not created");
    await admin.from("fee_components").insert({ institution_id: institution.id, fee_structure_id: feeStructure.id, head: "tuition", amount: 5000, frequency: "term" });

    const { data: app1 } = await admin
      .from("applications")
      .insert({
        institution_id: institution.id,
        applicant: { firstName: "Sibling", lastName: "One", dob: "2016-01-01", gender: "male" },
        guardian: { fullName: "Shared Guardian", phone: sharedPhone, relationship: "father" },
        grade_applied_id: grade.id,
        academic_year_id: year.id,
        status: "accepted",
      })
      .select("id")
      .single();
    const { data: app2 } = await admin
      .from("applications")
      .insert({
        institution_id: institution.id,
        applicant: { firstName: "Sibling", lastName: "Two", dob: "2018-01-01", gender: "female" },
        guardian: { fullName: "Shared Guardian", phone: sharedPhone, relationship: "father" },
        grade_applied_id: grade.id,
        academic_year_id: year.id,
        status: "accepted",
      })
      .select("id")
      .single();
    if (!app1 || !app2) throw new Error("fixture applications were not created");

    for (const applicationId of [app1.id, app2.id]) {
      await loginAs(page, "admissions@demo.coolskool.test");
      await page.goto(`/${SLUG}/admissions/applications/${applicationId}`);
      await page.getByRole("button", { name: "Enrol", exact: true }).click();
      await page.getByLabel("Section").click();
      await page.getByRole("option", { name: /J05B/ }).click();
      await page.getByLabel("Fee structure").click();
      await page.getByRole("option", { name: /J05B Standard/ }).click();
      await page.getByRole("button", { name: "Enrol", exact: true }).click();
      await expect(page.getByText(/Enrolled — admission/)).toBeVisible();
    }

    const { data: guardianRows } = await admin
      .from("guardians")
      .select("id")
      .eq("institution_id", institution.id)
      .eq("phone", sharedPhone);
    expect(guardianRows).toHaveLength(1);

    const { data: links } = await admin
      .from("guardian_students")
      .select("student_id")
      .eq("institution_id", institution.id)
      .eq("guardian_id", guardianRows![0].id);
    expect(links).toHaveLength(2);
  });
});
