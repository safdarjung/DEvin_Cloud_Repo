import { expect, test, type Browser, type Page } from "@playwright/test";
import { DEMO_ROLES, PASSWORD, SLUG, type DemoRole } from "./fixtures";

// Smoke for the pages/flows added in the "eighteen features" build. Part A walks every
// target route the role's rendered sidebar links to; part B runs six short real flows.
// Created records are prefixed "E2E smoke" (lab bookings carry that purpose).

const STAFF_ROUTES = [
  "behaviour", "health", "clubs", "hostel", "finance/expenses", "finance/concessions", "canteen", "inventory",
  "helpdesk", "forms", "alumni", "payroll", "labs", "achievements", "safety", "compliance", "resources", "duties",
  "staff", "library", "visitors", "certificates", "exams/seating", "finance/fee-plans", "documents",
  "students/lifecycle", "fabric/workflows", "fabric/lab", "fabric/simulator", "fabric/twin", "fabric/studio",
  "fabric/marketplace", "settings/modules", "setup", "orb",
];
const PORTAL_ROUTES = ["behaviour", "health", "clubs", "canteen", "helpdesk", "forms", "achievements", "safety", "resources"].map((r) => `portal/${r}`);
const TARGETS = new Set([...STAFF_ROUTES, ...PORTAL_ROUTES].map((r) => `/${SLUG}/${r}`));

// Known React duplicate-key warning (also on /ptm).
const IGNORED_CONSOLE = /same key|duplicate key/i;

test.use({ actionTimeout: 20_000, navigationTimeout: 120_000 });

const ROLES: DemoRole[] = ["principal", "admin", "accountant", "teacher.vi-a", "guardian.one", "student.one"];

// Own helper: with demo auto-login on, plain /login signs in as the default demo and redirects, so use ?switch=1.
async function loginAs(page: Page, role: DemoRole): Promise<void> {
  await page.goto("/login?switch=1");
  await page.getByLabel("Email").fill(DEMO_ROLES[role]);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(new RegExp(`/${SLUG}`), { timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
}

async function sidebarTargets(page: Page): Promise<string[]> {
  const hrefs = await page.locator('nav[aria-label="Primary"] a[href]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""));
  const seen = new Set<string>();
  for (const h of hrefs) {
    const path = h.split("?")[0]!.replace(/\/$/, "");
    if (TARGETS.has(path)) seen.add(h);
  }
  return [...seen];
}

test.describe("A. render smoke per role", () => {
  for (const role of ROLES) {
    test(`${role}: sidebar-linked new pages render cleanly`, async ({ page }, testInfo) => {
      test.setTimeout(600_000);
      await loginAs(page, role);
      const links = await sidebarTargets(page);
      const problems: string[] = [];
      let visited = 0;
      let current = "";
      const consoleErrors: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error" && !IGNORED_CONSOLE.test(m.text())) consoleErrors.push(`${current} :: ${m.text().slice(0, 300)}`);
      });
      page.on("pageerror", (e) => consoleErrors.push(`${current} :: PAGEERROR ${e.message.slice(0, 300)}`));

      for (const href of links) {
        current = href;
        visited++;
        const before = consoleErrors.length;
        const res = await page.goto(href, { waitUntil: "load", timeout: 120_000 });
        await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
        const status = res?.status() ?? 0;
        const issues: string[] = [];
        if (status >= 400 || status === 0) issues.push(`HTTP ${status}`);
        const body = (await page.locator("body").innerText()).slice(0, 20_000);
        if (/Something went wrong|Application error/i.test(body)) issues.push("error boundary text");
        // /orb has a screen-reader-only <h1>, so it is attached (not necessarily visible); every other page needs a visible heading.
        if (href.split("?")[0]!.endsWith("/orb")) {
          if ((await page.getByRole("heading", { level: 1 }).count()) === 0) issues.push("no h1 on /orb");
        } else if (!(await page.getByRole("heading").first().isVisible().catch(() => false))) issues.push("no visible heading");
        issues.push(...consoleErrors.slice(before).map((e) => `console: ${e}`));
        if (issues.length) {
          const shot = testInfo.outputPath(`${role}-${href.replace(/\W+/g, "_")}.png`);
          await page.screenshot({ path: shot, fullPage: true }).catch(() => undefined);
          problems.push(`${href} -> ${issues.join(" | ")} [${shot}]`);
        }
      }
      testInfo.annotations.push({ type: "visited", description: `${role}: ${visited} routes` });
      console.log(`[smoke] ${role}: visited ${visited}, failed ${problems.length}`);
      expect(visited, "sidebar linked at least one target route").toBeGreaterThan(0);
      expect(problems, problems.join("\n")).toEqual([]);
    });
  }

  async function expectRefused(page: Page, path: string) {
    const res = await page.goto(`/${SLUG}/${path}`, { waitUntil: "load" });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    const redirected = !new URL(page.url()).pathname.endsWith(`/${path}`);
    const refusedStatus = (res?.status() ?? 0) >= 400;
    const leaksPage = await page.getByRole("heading", { name: new RegExp(`^${path}$`, "i") }).first().isVisible().catch(() => false);
    expect(redirected || refusedStatus || !leaksPage, `${path} was served at ${page.url()} (status ${res?.status()})`).toBe(true);
  }

  test("teacher is refused on /payroll", async ({ page }) => {
    await loginAs(page, "teacher.vi-a");
    await expectRefused(page, "payroll");
  });

  test("guardian is refused on staff /health", async ({ page }) => {
    await loginAs(page, "guardian.one");
    await expectRefused(page, "health");
  });
});

async function newPageAs(browser: Browser, role: DemoRole): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await loginAs(page, role);
  return page;
}

const stamp = Date.now();

test.describe("B. flows", () => {
  test("1 admin records an inventory item and stock-in", async ({ page }) => {
    const name = `E2E smoke item ${stamp}`;
    await loginAs(page, "admin");
    await page.goto(`/${SLUG}/inventory?tab=items`);
    await page.locator("#n-new").fill(name);
    await page.locator("#u-new").fill("pcs");
    await page.getByRole("button", { name: "Add item" }).click();
    await expect(page.getByText("Item added")).toBeVisible();
    await page.goto(`/${SLUG}/inventory?tab=movements`);
    await page.locator("#mv-item").selectOption({ label: name });
    await page.locator("#mv-kind").selectOption("in");
    await page.locator("#mv-qty").fill("7");
    await page.getByRole("button", { name: "Record", exact: true }).click();
    await expect(page.getByText("Movement recorded")).toBeVisible();
    await page.goto(`/${SLUG}/inventory?tab=stock`);
    const row = page.getByRole("row", { name: new RegExp(name) });
    await expect(row).toBeVisible();
    await expect(row.getByRole("cell", { name: "7 pcs", exact: true })).toBeVisible();
  });

  test("2 accountant records an expense", async ({ page }) => {
    const note = `E2E smoke expense ${stamp}`;
    await loginAs(page, "accountant");
    await page.goto(`/${SLUG}/finance/expenses`);
    await page.locator("#ex-amt").fill("1234.50");
    await page.locator("#ex-note").fill(note);
    await page.getByRole("button", { name: "Record expense" }).click();
    await expect(page.getByText("Expense recorded")).toBeVisible();
    await page.goto(`/${SLUG}/finance/expenses?q=${encodeURIComponent(note)}`);
    const row = page.getByRole("row", { name: new RegExp(note) });
    await expect(row).toBeVisible();
    await expect(row).toContainText("₹1,234.50");
  });

  test("3 guardian raises a ticket, admin replies, guardian sees reply", async ({ browser }) => {
    const subject = `E2E smoke ticket ${stamp}`;
    const reply = `E2E smoke reply ${stamp}`;
    const g = await newPageAs(browser, "guardian.one");
    await g.goto(`/${SLUG}/portal/helpdesk`);
    await g.locator("#hd-subject").fill(subject);
    await g.locator("#hd-body").fill("E2E smoke body: please ignore.");
    await g.getByRole("button", { name: "Raise ticket" }).click();
    await expect(g.getByText("Ticket raised")).toBeVisible();

    const a = await newPageAs(browser, "admin");
    await a.goto(`/${SLUG}/helpdesk`);
    await a.getByRole("link", { name: subject }).first().click();
    await a.waitForURL(/ticket=/);
    await a.locator("#hd-reply").fill(reply);
    await a.getByRole("button", { name: "Send reply" }).click();
    await expect(a.getByText("Reply sent")).toBeVisible();

    await g.goto(`/${SLUG}/portal/helpdesk`);
    await g.getByRole("link", { name: subject }).first().click();
    await expect(g.getByText(reply)).toBeVisible();
  });

  test("3b guardian with two children opens a ticket from the list", async ({ browser }) => {
    const g = await newPageAs(browser, "guardian.one");
    await g.goto(`/${SLUG}/portal/helpdesk`);
    await g.getByRole("link", { name: /E2E smoke ticket/ }).first().click();
    await expect(g.getByRole("link", { name: "Back to my tickets" })).toBeVisible();
  });

  test("4 teacher books a lab; a duplicate booking shows the conflict", async ({ page }) => {
    await loginAs(page, "teacher.vi-a");
    const d = new Date(Date.now() + (60 + Math.floor(Math.random() * 300)) * 864e5);
    while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
    const date = d.toISOString().slice(0, 10);
    await page.goto(`/${SLUG}/labs?section=schedule&date=${date}`);
    const periods = await page.locator("#bk-period option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    expect(periods.length).toBeGreaterThan(0);
    const fill = async (period: string) => {
      await page.locator("#bk-date").fill(date);
      await page.locator("#bk-period").selectOption(period);
      await page.locator("#bk-section").selectOption({ index: 1 });
      await page.locator("#bk-subject").selectOption({ index: 1 });
      await page.locator("#bk-purpose").fill("E2E smoke booking");
      await page.getByRole("button", { name: "Book lab" }).click();
    };
    let booked: string | null = null;
    for (const p of periods) {
      await fill(p);
      const ok = await page.getByText("Lab booked").first().waitFor({ timeout: 8_000 }).then(() => true, () => false);
      if (ok) { booked = p; break; }
    }
    expect(booked, "some period accepted the booking").not.toBeNull();
    await page.goto(`/${SLUG}/labs?section=schedule&date=${date}`);
    await fill(booked!);
    await expect(page.getByText(/already booked/i).first()).toBeVisible();
  });

  test("5 principal sees price and indicative monthly total in the marketplace", async ({ page }) => {
    await loginAs(page, "principal");
    await page.goto(`/${SLUG}/fabric/marketplace`);
    await expect(page.getByText(/₹[\d,]+ \/ month/).first()).toBeVisible();
    await expect(page.getByText(/Monthly total for installed modules/)).toBeVisible();
    await expect(page.getByText("Indicative price").first()).toBeVisible();
  });

  test("6 /start rejects a wrong invite code", async ({ page }) => {
    await page.goto("/start");
    await page.locator("#code").fill("WRONG-CODE-0000");
    await page.locator("#schoolName").fill("E2E smoke school");
    await page.locator("#ownerName").fill("E2E Smoke");
    await page.locator("#email").fill("e2e-smoke@example.invalid");
    await page.locator("#password").fill("E2eSmoke-Pass-1");
    await page.getByRole("button", { name: /start|create|continue|submit/i }).click();
    await expect(page.getByText(/invite code is not valid/i)).toBeVisible();
    await expect(page).toHaveURL(/\/start/);
  });
});
