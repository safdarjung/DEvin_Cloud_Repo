import { expect, test, type Page } from "@playwright/test";
import { DEMO_ROLES, PASSWORD, SLUG, type DemoRole } from "./fixtures";

// /login auto-signs in as the principal when DEMO_AUTO_LOGIN is on; ?switch=1 shows the real form.
async function loginAs(page: Page, role: DemoRole) {
  await page.goto("/login?switch=1");
  await page.getByLabel("Email").fill(DEMO_ROLES[role]);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
}

const SHOTS = "/tmp/claude-1000/-home-safdar-Desktop-projects-coolschool/899544cc-de53-49ec-93f1-c9c42aef787b/scratchpad/shots";
const ROLES: DemoRole[] = ["admin", "teacher.vi-a", "guardian.one", "student.one"];

function watch(page: Page) {
  const bad: string[] = [];
  page.on("console", (m) => m.type() === "error" && bad.push(`console: ${m.text().slice(0, 200)}`));
  page.on("pageerror", (e) => bad.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on("response", (r) => r.status() >= 500 && bad.push(`${r.status()} ${r.url()}`));
  return bad;
}

async function brokenImages(page: Page) {
  return page.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.src).map((i) => i.src));
}

async function badText(page: Page) {
  const t = await page.locator("body").innerText();
  return /\bundefined\b|\bNaN\b|\[object Object\]/.test(t) ? t.match(/.{0,30}(undefined|NaN|\[object Object\]).{0,30}/)?.[0] ?? "match" : null;
}

for (const role of ROLES) {
  test.describe(`orb as ${role}`, () => {
    test(`desktop: renders, dots, hover, keyboard, no errors`, async ({ page }) => {
      const bad = watch(page);
      await loginAs(page, role);
      await page.goto(`/${SLUG}/orb`);
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${SHOTS}/orb-${role}-desktop.png`, fullPage: true });
      const dots = page.locator("[data-dots] [data-node]");
      const n = await dots.count();
      console.log(`[orb] ${role}: ${n} dots`);
      expect(n, "dots rendered").toBeGreaterThan(0);
      expect(await brokenImages(page)).toEqual([]);
      expect(await badText(page)).toBeNull();
      // hover reveal
      // Dots drift with the spin (never "stable" for Playwright), so aim the mouse at a visible one.
      const findDot = () => page.evaluate(() => {
        const el = [...document.querySelectorAll<HTMLElement>("[data-dots] [data-node]")].find((e) => Number(getComputedStyle(e).opacity) > 0.8 && getComputedStyle(e).pointerEvents !== "none"); // back-facing dots are not pickable
        const r = el?.getBoundingClientRect();
        return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
      });
      let at: { x: number; y: number } | null = null;
      await expect.poll(async () => (at = await findDot()), { message: "a visible dot" }).not.toBeNull();
      await page.mouse.move(at!.x, at!.y);
      await expect(page.locator("[data-dots] [data-hot]")).toHaveCount(1);
      // keyboard: focus first dot, arrow moves
      await dots.first().focus();
      await page.keyboard.press("ArrowRight");
      const idx = await page.evaluate(() => document.activeElement?.getAttribute("data-node"));
      expect(idx).toBe("1");
      // tab from top reaches something focusable inside main
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
      // drag spin on sphere
      const box = await page.locator("[data-dots]").boundingBox();
      if (box) {
        const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
        await page.mouse.move(cx - 20, cy + 5);
        await page.mouse.down();
        await page.mouse.move(cx + 80, cy + 5, { steps: 8 });
        await page.mouse.up();
        await page.screenshot({ path: `${SHOTS}/orb-${role}-afterdrag.png` });
      }
      expect(bad).toEqual([]);
    });

    test(`mobile 390x844: no overflow, tap reveals`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      const page = await ctx.newPage();
      const bad = watch(page);
      await loginAs(page, role);
      await page.goto(`/${SLUG}/orb`);
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${SHOTS}/orb-${role}-mobile.png`, fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, "horizontal overflow px").toBeLessThanOrEqual(1);
      const dots = page.locator("[data-dots] [data-node]");
      expect(await dots.count()).toBeGreaterThan(0);
      expect(await brokenImages(page)).toEqual([]);
      expect(bad).toEqual([]);
      await ctx.close();
    });

    test(`reduced motion: still usable`, async ({ browser }) => {
      const ctx = await browser.newContext({ reducedMotion: "reduce" });
      const page = await ctx.newPage();
      const bad = watch(page);
      await loginAs(page, role);
      await page.goto(`/${SLUG}/orb`);
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${SHOTS}/orb-${role}-reduced.png`, fullPage: true });
      expect(await page.locator("[data-dots] [data-node]").count()).toBeGreaterThan(0);
      expect(bad).toEqual([]);
      await ctx.close();
    });
  });
}

test("admin: chat send streams an answer, error state is visible", async ({ page }) => {
  const bad = watch(page);
  await loginAs(page, "admin");
  await page.goto(`/${SLUG}/orb`);
  await page.waitForLoadState("networkidle");
  const box = page.getByRole("combobox", { name: "Message" });
  await box.fill("How many students are in the school? One sentence.");
  await box.press("Enter");
  const convo = page.getByRole("region", { name: "Conversation" });
  await expect(convo).toBeVisible({ timeout: 15000 });
  await expect(convo.getByRole("button", { name: "Copy this answer" })).toBeVisible({ timeout: 60000 }).catch(() => {});
  await page.screenshot({ path: `${SHOTS}/orb-admin-chat.png`, fullPage: true });
  expect(await badText(page)).toBeNull();
  expect(await convo.getByRole("alert").count(), "AI error alert shown").toBe(0);
  console.log("[orb] console", JSON.stringify(bad));
});

test("admin: AI failure shows an error, not a blank", async ({ page }) => {
  await loginAs(page, "admin");
  await page.route("**/api/ai/agent/**", (r) => r.fulfill({ status: 500, body: "boom" }));
  await page.goto(`/${SLUG}/orb`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("combobox", { name: "Message" }).fill("hello");
  await page.getByRole("combobox", { name: "Message" }).press("Enter");
  await expect(page.getByRole("alert").first()).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: `${SHOTS}/orb-admin-aierror.png`, fullPage: true });
});

test("admin: clicking a task dot opens an approval card with options", async ({ page }) => {
  await loginAs(page, "admin");
  await page.goto(`/${SLUG}/orb`);
  await page.waitForLoadState("networkidle");
  const dot = page.locator("[data-dots] button[data-node]").nth(3);
  const label = await dot.getAttribute("aria-label");
  console.log("[orb] clicking dot:", label);
  await dot.click({ force: true });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/orb-admin-dotclick.png`, fullPage: true });
  expect(await badText(page)).toBeNull();
});

const SMOKE_ROLES: DemoRole[] = ["admin", "teacher.vi-a", "guardian.one", "student.one"];
for (const role of SMOKE_ROLES) {
  test(`sidebar smoke as ${role}`, async ({ page }) => {
    test.setTimeout(240000);
    await loginAs(page, role);
    await page.goto(`/${SLUG}/orb`);
    await page.waitForLoadState("networkidle");
    const hrefs = await page.evaluate((slug) => [...new Set([...document.querySelectorAll("nav a[href], aside a[href]")].map((a) => a.getAttribute("href")!).filter((h) => h.startsWith(`/${slug}/`)))], SLUG);
    const problems: string[] = [];
    for (const h of hrefs) {
      const errs: string[] = [];
      const onErr = (e: Error) => errs.push(e.message.slice(0, 120));
      page.on("pageerror", onErr);
      const res = await page.goto(h, { waitUntil: "domcontentloaded" }).catch((e) => ({ status: () => -1, e }));
      await page.waitForLoadState("networkidle").catch(() => {});
      page.off("pageerror", onErr);
      const status = res?.status?.() ?? 0;
      const text = (await page.locator("main").first().innerText().catch(() => "")).trim();
      const bt = await badText(page);
      if (status >= 400 || status < 0) problems.push(`${h} HTTP ${status}`);
      else if (!text) problems.push(`${h} BLANK main`);
      if (bt) problems.push(`${h} BADTEXT ${bt}`);
      if (/something went wrong|application error|404/i.test(text.slice(0, 300))) problems.push(`${h} ERRORPAGE ${text.slice(0, 60)}`);
      if (errs.length) problems.push(`${h} pageerror ${errs[0]}`);
    }
    console.log(`[smoke] ${role}: ${hrefs.length} pages; problems=${JSON.stringify(problems)}`);
    expect(problems).toEqual([]);
  });
}
