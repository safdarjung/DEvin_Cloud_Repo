import { expect, test } from "@playwright/test";

// FabricOS overview (/product/overview; the home until 2026-11-14): structure, honesty labels, keyboard paths and layout.

test.describe("FabricOS landing", () => {
  // The home page compiles a 3D scene on first hit in dev; allow for it.
  test.describe.configure({ timeout: 120_000 });

  test("the overview responds 200 and has exactly one h1", async ({ page }) => {
    const res = await page.goto("/product/overview");
    expect(res?.status()).toBe(200);
    await expect(page.locator("h1")).toHaveCount(1);
  });

  test("every in-page nav anchor resolves to a section on the page", async ({ page }) => {
    await page.goto("/product/overview");
    const hrefs = await page.locator('header nav[aria-label="Primary"] a, footer a').evaluateAll((as) =>
      as.map((a) => a.getAttribute("href") ?? "").filter((h) => h.startsWith("/product/overview#")),
    );
    expect(hrefs.length).toBeGreaterThan(5);
    for (const h of new Set(hrefs)) {
      await expect(page.locator(`[id="${h.split("#")[1]}"]`), `missing target for ${h}`).toHaveCount(1);
    }
  });

  test("FAQ answers are in the server HTML", async ({ request }) => {
    const html = await (await request.get("/product/overview", { timeout: 90_000 })).text();
    expect(html).toContain("Frequently asked questions");
    expect(html).toContain("How is FabricOS different from traditional ERP software?");
    expect(html).toContain("Traditional ERP software asks an institution to adapt to fixed modules.");
    expect(html).toContain("We start with a conversation about how your institution works");
  });

  test("agent demo steps through without any network calls", async ({ page }) => {
    await page.goto("/product/overview");
    const demo = page.locator("[data-agent-demo]");
    await demo.scrollIntoViewIfNeeded();
    await expect(demo.getByText("Illustrative example. Not live data.")).toBeVisible();

    await demo.getByRole("button", { name: "Pause walkthrough" }).click().catch(() => {});
    const requests: string[] = [];
    page.on("request", (r) => {
      if (!/\/_next\/|\.(mp4|webm|woff2?|png|jpg|webp|avif|svg)(\?|$)/.test(r.url())) requests.push(r.url());
    });

    await expect(async () => {
      await demo.getByRole("button", { name: "Agent understanding" }).click();
      await expect(demo.getByRole("button", { name: "Agent understanding" })).toHaveAttribute("aria-current", "step", { timeout: 1000 });
    }).toPass({ timeout: 30_000 });
    for (let i = 0; i < 4; i++) await demo.getByRole("button", { name: "Next step" }).click();
    await expect(demo.getByRole("button", { name: "Result" })).toHaveAttribute("aria-current", "step");
    await expect(demo.getByText("Nothing is sent without the teacher.")).toBeVisible();
    await expect(demo.getByRole("button", { name: "Next step" })).toBeDisabled();
    expect(requests).toEqual([]);
  });

  test("use-case tabs are keyboard operable", async ({ page }) => {
    await page.goto("/product/overview");
    const first = page.getByRole("tab", { name: "Education and Training" });
    await first.scrollIntoViewIfNeeded();
    await first.focus();
    await expect(first).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#use-cases").getByRole("tabpanel")).toContainText("Available today");

    const second = page.getByRole("tab", { name: "Professional Institutes" });
    // Retry until hydrated: keys pressed before hydration do nothing.
    await expect(async () => {
      await first.focus();
      await page.keyboard.press("Home");
      await page.keyboard.press("ArrowRight");
      await expect(second).toBeFocused({ timeout: 1000 });
    }).toPass({ timeout: 30_000 });
    await expect(second).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#use-cases").getByRole("tabpanel")).toContainText("Configured with you");

    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: "Other Institutions" })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    await expect(first).toHaveAttribute("aria-selected", "true");
  });

  test("trust proposal buttons only change local state", async ({ page }) => {
    await page.goto("/product/overview");
    const card = page.locator(`#human-control`);
    await card.getByRole("button", { name: "Approve" }).scrollIntoViewIfNeeded();
    await expect(async () => {
      await card.getByRole("button", { name: "Approve" }).click();
      await expect(card.getByRole("status")).toHaveText("Approved. Queued to send.", { timeout: 1000 });
    }).toPass({ timeout: 30_000 });
    await card.getByRole("button", { name: "Decline" }).click();
    await expect(card.getByRole("status")).toHaveText("Declined. Nothing sent.");
  });

  test.describe("small screen", () => {
    test.use({ viewport: { width: 360, height: 780 } });
    test("no horizontal scroll at 360px", async ({ page }) => {
      await page.goto("/product/overview");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });

  test.describe("reduced motion", () => {
    test.use({ reducedMotion: "reduce" });
    test("all section headings are visible without scrolling animations", async ({ page }) => {
      await page.goto("/product/overview");
      const h2s = page.locator("main h2");
      expect(await h2s.count()).toBeGreaterThanOrEqual(12);
      for (const h of await h2s.all()) {
        await h.scrollIntoViewIfNeeded();
        await expect(h).toBeVisible();
        await expect(h).toHaveCSS("opacity", "1");
      }
    });
  });

  test("/tour still renders its h1", async ({ page }) => {
    await page.goto("/tour");
    await expect(page.getByRole("heading", { level: 1, name: "Walk through a school day" })).toBeVisible();
  });
});
