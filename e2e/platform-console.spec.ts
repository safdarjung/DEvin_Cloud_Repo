import { expect, test } from "@playwright/test";
import { loginAs } from "./fixtures";

test("non-platform user gets a 404 on /platform and its sections", async ({ page }) => {
  await loginAs(page, "principal");
  for (const path of ["/platform", "/platform/institutions"]) {
    const res = await page.goto(path);
    expect(res?.status()).toBe(404);
    await expect(page.getByText("Platform console")).toHaveCount(0);
  }
});
