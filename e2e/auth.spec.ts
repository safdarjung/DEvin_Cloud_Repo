import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

const TEST_EMAIL = `e2e-auth-${crypto.randomUUID()}@test.local`;
const TEST_PASSWORD = "correct-horse-battery-staple";

function adminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);
}

test.describe("auth (J-00 subset)", () => {
  let userId: string;

  test.beforeAll(async () => {
    const { data, error } = await adminClient().auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) throw error ?? new Error("test user was not created");
    userId = data.user.id;
  });

  test.afterAll(async () => {
    await adminClient().auth.admin.deleteUser(userId);
  });

  test("visiting a tenant path unauthenticated redirects to /login?next=<path>", async ({
    page,
  }) => {
    // With demo login hints on, /login auto-signs visitors in by design; the redirect-with-next contract only holds when hints are off.
    test.skip(process.env.NEXT_PUBLIC_DEMO_LOGIN_HINTS === "true", "demo auto-login is on");
    await page.goto("/st-josephs-demo/dashboard");
    const url = new URL(page.url());
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("next")).toBe("/st-josephs-demo/dashboard");
  });

  test("an absolute-URL next is ignored (no off-site redirect)", async ({ page, baseURL }) => {
    await page.goto("/login?switch=1&next=https://evil.example");
    await page.getByLabel("Email").fill(TEST_EMAIL);
    await page.getByLabel("Password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForLoadState("networkidle");

    expect(page.url().startsWith(baseURL!)).toBe(true);
    expect(page.url()).not.toContain("evil.example");
  });

  test("wrong password shows a generic error", async ({ page }) => {
    await page.goto("/login?switch=1");
    await page.getByLabel("Email").fill(TEST_EMAIL);
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByText("Invalid email or password.")).toBeVisible();
  });

  test("login succeeds, sets a session cookie, and logout clears it", async ({
    page,
    context,
  }) => {
    await page.goto("/login?switch=1");
    await page.getByLabel("Email").fill(TEST_EMAIL);
    await page.getByLabel("Password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForLoadState("networkidle");

    const cookiesAfterLogin = await context.cookies();
    expect(cookiesAfterLogin.some((c) => c.name.startsWith("sb-"))).toBe(true);

    await page.request.post("/logout");
    const cookiesAfterLogout = await context.cookies();
    expect(cookiesAfterLogout.some((c) => c.name.startsWith("sb-"))).toBe(false);
  });
});
