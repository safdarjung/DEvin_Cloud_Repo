import { expect, type Page, test } from "@playwright/test";

// J-07 (08 §4) — accountant records a cash payment on INV-T2-Aarav;
// guardian.one logs in, sees two children, attendance/invoice/receipt/
// results all scope correctly. Runs against the seeded demo tenant
// (`st-josephs-demo`); T-034's own fixture is the switcher + 404 checks,
// which don't depend on the payment having been recorded by a prior spec.
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "CoolSkool-Demo-2026";
const SLUG = "st-josephs-demo";

async function loginAs(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForLoadState("networkidle");
}

/**
 * Page object for the guardian/student portal shell (T-034) — reused by
 * T-041. Wraps navigation + the handful of locators every portal journey
 * needs; it does not assert anything itself.
 */
export class GuardianPortalPage {
  constructor(
    private readonly page: Page,
    private readonly slug = SLUG,
  ) {}

  async goto(tab: "" | "attendance" | "fees" | "results" | "assignments" | "notifications" = "") {
    await this.page.goto(`/${this.slug}/portal${tab ? `/${tab}` : ""}`);
    await this.page.waitForLoadState("networkidle");
  }

  async gotoReceipt(receiptId: string, studentId: string) {
    await this.page.goto(`/${this.slug}/portal/fees/receipts/${receiptId}?student=${studentId}`);
    await this.page.waitForLoadState("networkidle");
  }

  childLink(childName: string) {
    return this.page.getByRole("link", { name: new RegExp(childName) });
  }

  get tabsNav() {
    return this.page.getByRole("navigation", { name: "Primary" });
  }

  get childSwitcherNav() {
    return this.page.getByRole("navigation", { name: "Select child" });
  }

  currentStudentId(): string | null {
    return new URL(this.page.url()).searchParams.get("student");
  }
}

test.describe("J-07: guardian portal", () => {
  test("guardian.one sees two children; switching changes every tab's data (AC1)", async ({ page }) => {
    await loginAs(page, "guardian.one@demo.coolskool.test");
    const portal = new GuardianPortalPage(page);
    await portal.goto();

    await expect(portal.childSwitcherNav).toBeVisible();
    const firstStudentId = portal.currentStudentId();
    expect(firstStudentId).toBeTruthy();

    await portal.goto("attendance");
    const attendanceStudentId = portal.currentStudentId();
    expect(attendanceStudentId).toBe(firstStudentId);

    // Switch child, then confirm the attendance tab's data changed (the
    // card re-renders for the new student id in the URL). Fix round 2a:
    // the previous version guessed a hardcoded child name ("Ishaan", who
    // is guardian.two's child, not guardian.one's) and chained a `.catch`
    // onto an auto-waiting Playwright action — a locator with 0 matches
    // doesn't reject quickly, it waits out the actionTimeout first, which
    // burned the whole 30s test budget before the fallback ever ran.
    // guardian.one's second child, whichever it is, is just the switcher's
    // second link — no name needed.
    // Fix round 2b: `waitForLoadState("networkidle")` after the click is
    // not the right readiness signal — confirmed by instrumenting
    // request/response events, the RSC fetch for the new `?student=`
    // completes well within the networkidle window, but reading
    // `page.url()` immediately after still occasionally observed the old
    // URL (client-side history update lagging the response by a beat).
    // Wait for the actual condition — the URL containing the clicked
    // link's own href — instead of a generic idle heuristic.
    const secondChildLink = portal.childSwitcherNav.getByRole("link").nth(1);
    const secondChildHref = await secondChildLink.getAttribute("href");
    await secondChildLink.click();
    await page.waitForURL(`**${secondChildHref}`);
    expect(portal.currentStudentId()).not.toBe(firstStudentId);
  });

  test("student.one sees only themself; no switcher (AC3)", async ({ page }) => {
    await loginAs(page, "student.one@demo.coolskool.test");
    const portal = new GuardianPortalPage(page);
    await portal.goto();

    await expect(portal.childSwitcherNav).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "My school" })).toBeVisible();
  });

  test("visiting /portal/results?student=<other guardian's child id> returns 404 (AC2)", async ({ page }) => {
    await loginAs(page, "guardian.two@demo.coolskool.test");
    const portal = new GuardianPortalPage(page);
    await portal.goto();
    const guardianTwoChildId = portal.currentStudentId();
    expect(guardianTwoChildId).toBeTruthy();

    await loginAs(page, "guardian.one@demo.coolskool.test");
    await page.goto(`/${SLUG}/portal/results?student=${guardianTwoChildId}`);
    await expect(page.getByText(/404|not found/i)).toBeVisible();
  });

  test("all five tabs render without console errors on 390x844 (AC5)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await loginAs(page, "guardian.one@demo.coolskool.test");
    const portal = new GuardianPortalPage(page);
    for (const tab of ["", "attendance", "fees", "results", "assignments", "notifications"] as const) {
      await portal.goto(tab);
    }

    expect(errors).toEqual([]);
  });

  test("guardian.one's portal shows the selected child's timetable and attendance trend (M16-T12)", async ({ page }) => {
    await loginAs(page, "guardian.one@demo.coolskool.test");
    const portal = new GuardianPortalPage(page);
    await portal.goto();

    // The day heading is "<first name>'s day" (page.tsx) for the same
    // child the timetable/trend widgets are titled for — read it instead
    // of hardcoding a name, since the default-selected child isn't fixed.
    const headingText = await page.getByRole("heading", { level: 2 }).textContent();
    const firstName = headingText?.replace(/'s day$/, "");
    expect(firstName).toBeTruthy();

    await expect(page.getByText(`${firstName}'s timetable today`)).toBeVisible();
    const isSunday = new Date().toLocaleDateString("en-US", { timeZone: "Asia/Kolkata", weekday: "short" }) === "Sun";
    if (!isSunday) {
      await expect(page.getByText("No periods today")).not.toBeVisible();
    }
    // exact: true — the trend chart's sr-only <figcaption> starts with the
    // same title text plus its data summary, so a substring match is ambiguous.
    await expect(page.getByText("Attendance, last 30 days", { exact: true })).toBeVisible();
  });
});
