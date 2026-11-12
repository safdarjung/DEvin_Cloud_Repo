import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { expect, type Page, test } from "@playwright/test";

function adminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);
}

const sql = postgres(process.env.SUPABASE_DB_URL!, { max: 5 });

// fullyParallel: true runs each test of this file in its own worker process,
// which independently re-executes this module's beforeAll/afterAll — every
// fixture id must be unique per worker, not a shared constant.
const runId = crypto.randomUUID();
const instId = runId;
const slug = `tenant-shell-demo-${runId}`;
const PASSWORD = "correct-horse-battery-staple";
const principalEmail = `tenant-shell-principal-${runId}@test.local`;
const guardianEmail = `tenant-shell-guardian-${runId}@test.local`;

let principalId: string;
let guardianId: string;

async function loginAs(page: Page, email: string) {
  await page.goto("/login?switch=1");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => url.pathname !== "/login");
  await page.waitForLoadState("networkidle");
}

test.describe("tenant shell (J-00 subset)", () => {
  test.beforeAll(async () => {
    const admin = adminClient();
    const [principal, guardian] = await Promise.all([
      admin.auth.admin.createUser({ email: principalEmail, password: PASSWORD, email_confirm: true }),
      admin.auth.admin.createUser({ email: guardianEmail, password: PASSWORD, email_confirm: true }),
    ]);
    if (principal.error || !principal.data.user || guardian.error || !guardian.data.user) {
      throw principal.error ?? guardian.error ?? new Error("test user creation failed");
    }
    principalId = principal.data.user.id;
    guardianId = guardian.data.user.id;

    await sql`insert into public.institutions (id, slug, name) values (${instId}, ${slug}, 'Tenant Shell Demo')`;
    const [staffPrincipal] = await sql`
      insert into public.staff (institution_id, employee_no, full_name, designation)
      values (${instId}, 'EMP-PRINCIPAL', 'Principal', 'Principal')
      returning id
    `;
    const [guardianRow] = await sql`
      insert into public.guardians (institution_id, full_name, phone)
      values (${instId}, 'Guardian', '9000000001')
      returning id
    `;
    // A guardian is never created without at least one linked child in
    // practice (every guardian membership is created alongside an
    // enrolment) — resolvePortalSelection (T-034) correctly 404s a
    // childless guardian, so this fixture must link one to exercise the
    // real /portal redirect-to-default-child path.
    const [studentRow] = await sql`
      insert into public.students (institution_id, admission_no, first_name, dob, gender)
      values (${instId}, 'ADM-TSHELL-1', 'Child', '2016-01-01', 'other')
      returning id
    `;
    await sql`
      insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
      values (${instId}, ${guardianRow.id}, ${studentRow.id}, 'mother', true)
    `;
    await sql`
      insert into public.memberships (institution_id, user_id, role, staff_id)
      values (${instId}, ${principalId}, 'principal', ${staffPrincipal.id})
    `;
    await sql`
      insert into public.memberships (institution_id, user_id, role, guardian_id)
      values (${instId}, ${guardianId}, 'guardian', ${guardianRow.id})
    `;
  });

  test.afterAll(async () => {
    await sql.begin(async (tx) => {
      await tx`select set_config('app.allow_reset', 'on', true)`;
      await tx`delete from public.audit_events where institution_id = ${instId}`;
    });
    await sql`delete from public.memberships where institution_id = ${instId}`;
    await sql`delete from public.guardian_students where institution_id = ${instId}`;
    await sql`delete from public.students where institution_id = ${instId}`;
    await sql`delete from public.staff where institution_id = ${instId}`;
    await sql`delete from public.guardians where institution_id = ${instId}`;
    await sql`delete from public.institutions where id = ${instId}`;
    const admin = adminClient();
    await admin.auth.admin.deleteUser(principalId);
    await admin.auth.admin.deleteUser(guardianId);
    await sql.end();
  });

  test("principal sees the shell with full nav and no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await loginAs(page, principalEmail);
    await page.goto(`/${slug}/dashboard`);

    await expect(page.getByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening)/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Finance" })).toBeVisible();
    await expect(page.getByRole("banner").getByText("Principal", { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("guardian sees the shell with Portal (no Settings/Jobs — staff-only) and no console errors", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await loginAs(page, guardianEmail);
    await page.goto(`/${slug}/portal`);

    // "My children" is PortalNav's actual guardian-role heading (same
    // convention j07-guardian-portal.spec.ts checks for the student role,
    // "My school") — the page never had a literal "Portal" heading; only
    // the sidebar nav link to /portal is named that.
    await expect(page.getByRole("heading", { name: "My children" })).toBeVisible();
    // Portal sections live in the sidebar (navigation "Primary"); scope to it
    // because the quick-nav bar and drawer also render links on small viewports.
    const primary = page.getByRole("navigation", { name: "Primary" });
    await expect(primary.getByRole("link", { name: "Attendance" })).toBeVisible();
    await expect(primary.getByRole("link", { name: "Overview" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Jobs" })).toHaveCount(0);
    await expect(page.getByRole("banner").getByText("Guardian", { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
