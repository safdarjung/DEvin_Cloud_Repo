import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { generateQuizWithRetry, isOllamaReachable, loginAs, SLUG } from "./fixtures";

// J-08 (08 §4, 06 §W6) — teacher.x-a opens the "Quadratic Equations" unit
// (X/Mathematics, UNIT-X-MATH-3 in the test data map), generates a quiz via
// the local model, edits a question, saves as a draft, publishes; guardian
// sees it. Runs against the seeded demo tenant — the unit, grade, subject
// and teacher-section assignment are all real seed data (scripts/seed/lib/
// subjects.ts), only the generated/saved assignment itself is created live.
// 08 §4 J-08 risk: the UI has no navigation link into
// `/assignments/units/[unitId]` (that page only exists at T-036's direct
// URL), so this spec reaches it the same way the real demo operator would
// have to today — by URL, with the unit id looked up once via the
// service-role client, same shape as every other spec's "ids the UI
// doesn't expose yet" workaround (e.g. j06's session lookup).
function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);
}

test.describe("J-08: AI quiz generation, review, save, publish", () => {
  test("teacher generates, edits, saves as draft, publishes; guardian sees it", async ({ page }) => {
    if (!(await isOllamaReachable())) {
      test.skip(true, "OLLAMA_BASE_URL is unreachable — local AI engine is offline, skipping J-08 per packet risk note");
      return;
    }
    // Local generation on a 3B laptop model: generous timeout, this test
    // only (packet: "never pull models" — OLLAMA_MODEL is set by whoever
    // runs this command, e.g. `OLLAMA_MODEL=qwen2.5:3b pnpm test:e2e`). Up
    // to 3 generation attempts (generateQuizWithRetry) at 60s each.
    test.setTimeout(240_000);

    const admin = serviceClient();
    const { data: institution } = await admin.from("institutions").select("id").eq("slug", SLUG).single();
    if (!institution) throw new Error("seeded demo institution not found");

    const { data: grade } = await admin.from("grades").select("id").eq("institution_id", institution.id).eq("code", "X").single();
    const { data: subject } = await admin.from("subjects").select("id").eq("institution_id", institution.id).eq("code", "MATH").single();
    if (!grade || !subject) throw new Error("seeded demo grade X / subject MATH not found");

    const { data: unit } = await admin
      .from("curriculum_units")
      .select("id, title")
      .eq("institution_id", institution.id)
      .eq("grade_id", grade.id)
      .eq("subject_id", subject.id)
      .eq("title", "Quadratic Equations")
      .single();
    if (!unit) throw new Error("seeded 'Quadratic Equations' curriculum unit not found");

    // A fresh title per run so re-running this spec within the same reset
    // (two specs touching assignments, or a dev re-run) doesn't collide
    // with a previous draft of the same name sitting in the list.
    const title = `Quadratic Equations quiz (e2e ${Date.now()})`;

    await loginAs(page, "teacher.x-a");
    await page.goto(`/${SLUG}/assignments/units/${unit.id}`);
    await expect(page.getByRole("heading", { name: unit.title })).toBeVisible();

    await generateQuizWithRetry(page);
    await expect(page.getByText(/Generated locally|Generated in cloud/)).toBeVisible();

    await page.getByLabel("Title").fill(title);
    // Each question renders as its own `div.rounded-lg.border` block (the
    // Title field above it isn't one) — scope to the first block's first
    // plain <input> (the stem) rather than a bare `.first()` over every
    // input on the page, which would hit the Title field instead.
    const firstQuestionBlock = page.locator("div.rounded-lg.border.border-border").first();
    await firstQuestionBlock.locator("input").first().fill("Edited: solve the quadratic equation x^2 - 5x + 6 = 0");

    await page.getByRole("button", { name: "Save as draft" }).click();
    await page.waitForURL(/\/assignments\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByText("Status: draft")).toBeVisible();

    await page.goto(`/${SLUG}/assignments`);
    const row = page.getByRole("row").filter({ hasText: title });
    await row.getByRole("button", { name: "Publish" }).click();
    await expect(row.getByText("published")).toBeVisible();

    await loginAs(page, "guardian.one");
    await page.goto(`/${SLUG}/assignments`);
    await expect(page.getByRole("link", { name: title })).toBeVisible();
  });
});
