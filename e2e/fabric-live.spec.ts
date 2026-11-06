import { expect, test, type Locator, type Page } from "@playwright/test";

// Smoke coverage for the five Fabric workspaces (F-UI-04/08/09/11/12) while
// other lanes turn them from PlannedWorkspace placeholders into real pages.
// Logs in via POST /api/public/demo-login directly (not the UI login form —
// see e2e/fixtures.ts loginAs for that path): this spec only needs a
// session, not to exercise the login screen itself. "principal" is used for
// every page because each packet gates its most-restricted control behind
// principal (F-UI-04 intervention plans, F-UI-11 install approval, F-UI-12
// proposal approval) — one role covers every assertion below.
const SLUG = "st-josephs-demo";
const PRINCIPAL_EMAIL = "principal@demo.coolskool.test";

// PlannedWorkspace (src/modules/fabric/components/planned-workspace.tsx) is
// the "not built yet" state: the demo tenant (always true for SLUG) renders
// WorkspaceSkeleton's "This workspace arrives in packet ..."; a non-demo
// tenant would instead see "...: planned, not available yet". Either text
// means the lane hasn't landed yet — skip rather than fail.
const PLACEHOLDER_TEXT = /arrives in packet|planned, not available yet/i;
const ERROR_TEXT = /Something went wrong|could not be found/i;

async function demoLogin(page: Page, baseURL: string | undefined, email: string): Promise<void> {
  await page.request.post("/api/public/demo-login", {
    form: { email },
    headers: { origin: baseURL ?? "http://localhost:3000" },
  });
}

/** Shared assertions every workspace must pass before its page-specific controls are checked. Returns whether the page is still the placeholder. */
async function loadWorkspace(page: Page, path: string, heading: RegExp, packet: string): Promise<boolean> {
  const res = await page.goto(path);
  expect(res?.status()).toBe(200);
  await expect(page.locator("body")).not.toContainText(ERROR_TEXT);

  const isPlaceholder = (await page.getByText(PLACEHOLDER_TEXT).count()) > 0;
  test.fixme(isPlaceholder, `${packet} hasn't landed yet — still PlannedWorkspace/WorkspaceSkeleton`);

  await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
  return isPlaceholder;
}

test.describe("Fabric workspaces smoke", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await demoLogin(page, baseURL, PRINCIPAL_EMAIL);
  });

  test("students (F-UI-04): roster table or search is visible", async ({ page }) => {
    await loadWorkspace(page, `/${SLUG}/fabric/students`, /Student success/i, "F-UI-04");
    const roster: Locator = page
      .getByRole("table")
      .or(page.getByRole("searchbox"))
      .or(page.getByPlaceholder(/search/i));
    await expect(roster.first()).toBeVisible();
  });

  test("simulator (F-UI-08): assumption sliders and Save are visible", async ({ page }) => {
    await loadWorkspace(page, `/${SLUG}/fabric/simulator`, /Simulator/i, "F-UI-08");
    const slider: Locator = page.getByRole("slider").or(page.locator('input[type="range"]'));
    await expect(slider.first()).toBeVisible();
    await expect(page.getByRole("button", { name: /save/i }).first()).toBeVisible();
  });

  test("twin (F-UI-09): canvas or node list is visible", async ({ page }) => {
    await loadWorkspace(page, `/${SLUG}/fabric/twin`, /Digital twin/i, "F-UI-09");
    // Packet: React Flow canvas is ssr:false, mirrored by a `<ul>` node list
    // for keyboard/screen-reader access — either counts as "the twin rendered".
    const canvasOrList: Locator = page.locator(".react-flow").or(page.getByRole("list"));
    await expect(canvasOrList.first()).toBeVisible();
  });

  test("marketplace (F-UI-11): module cards and an install-lifecycle button are visible", async ({ page }) => {
    await loadWorkspace(page, `/${SLUG}/fabric/marketplace`, /Marketplace/i, "F-UI-11");
    await expect(page.getByRole("searchbox").or(page.getByPlaceholder(/search/i)).first()).toBeVisible();
    const lifecycleButton: Locator = page.getByRole("button", {
      name: /install|disable|uninstall|upgrade|awaiting approval|approve|request approval/i,
    });
    await expect(lifecycleButton.first()).toBeVisible();
  });

  test("studio (F-UI-12): request board and New request are visible", async ({ page }) => {
    await loadWorkspace(page, `/${SLUG}/fabric/studio`, /Custom Studio/i, "F-UI-12");
    await expect(page.getByRole("button", { name: /new request/i }).first()).toBeVisible();
  });
});
