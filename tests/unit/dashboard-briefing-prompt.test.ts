// T-0NN — dashboard briefing prompt builder. No nonce-delimiter test here
// (unlike `quiz-prompt.test.ts`) because the inputs are server-computed
// numbers only, not attacker-reachable free text — see the comment in
// `src/modules/ai/prompts/dashboard-briefing.ts`.
import { describe, expect, test } from "vitest";
import { buildDashboardBriefingPrompt, DASHBOARD_BRIEFING_INSTRUCTIONS } from "@/modules/ai/prompts/dashboard-briefing";
import type { DashboardBriefingRequestInput } from "@/modules/ai/dashboard-briefing.schemas";

const base: DashboardBriefingRequestInput = {
  institutionSlug: "demo",
  attendancePercent: 92.5,
  sectionsAtRiskCount: 2,
  openEnquiries: 14,
  enrolledCount: 310,
  collections: { collectedPaise: 50_000_00, duePaise: 80_000_00 },
};

describe("buildDashboardBriefingPrompt", () => {
  test("includes attendance, at-risk, enquiry, and enrollment numbers", () => {
    const prompt = buildDashboardBriefingPrompt(base);
    expect(prompt).toContain("92.5%");
    expect(prompt).toContain("2");
    expect(prompt).toContain("14");
    expect(prompt).toContain("310");
  });

  test("includes collections figures when present", () => {
    const prompt = buildDashboardBriefingPrompt(base);
    expect(prompt).toContain(String(base.collections?.collectedPaise));
    expect(prompt).toContain(String(base.collections?.duePaise));
  });

  test("omits any collections line when collections is null", () => {
    const prompt = buildDashboardBriefingPrompt({ ...base, collections: null });
    expect(prompt.toLowerCase()).not.toContain("collection");
  });

  test("omits attendance and at-risk lines when absent (never says 0%)", () => {
    const rest = { ...base, attendancePercent: undefined, sectionsAtRiskCount: undefined };
    const prompt = buildDashboardBriefingPrompt(rest);
    expect(prompt.toLowerCase()).not.toContain("attendance");
    expect(prompt).not.toContain("0%");
    expect(prompt).toContain("14");
  });

  test("never mentions a student or guardian by name (institution-wide aggregates only)", () => {
    const prompt = buildDashboardBriefingPrompt(base);
    expect(prompt).not.toMatch(/student|guardian/i);
  });

  test("instructions tell the model to invent no numbers and return JSON only", () => {
    expect(DASHBOARD_BRIEFING_INSTRUCTIONS).toMatch(/never invent/i);
    expect(DASHBOARD_BRIEFING_INSTRUCTIONS).toMatch(/JSON only/i);
  });
});
