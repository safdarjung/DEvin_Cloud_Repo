// T-0NN — dashboard briefing prompt. Unlike `prompts/quiz.ts`, this prompt
// uses no nonce-delimited data block: every value below is a number the
// server itself computed (`getDashboardData`) and the client only echoed
// back through a Zod schema of numeric fields — there is no
// attacker-controlled free text here for a delimiter to guard.
import type { DashboardBriefingRequestInput } from "@/modules/ai/dashboard-briefing.schemas";

export const DASHBOARD_BRIEFING_INSTRUCTIONS =
  "You write a 2-3 sentence plain-English briefing for a school principal from " +
  "institution-wide KPI numbers. Be concise and factual, and refer only to the " +
  "numbers given — never invent a number that was not provided. Respond with " +
  "JSON only, matching the schema — no markdown fences, no commentary.";

export function buildDashboardBriefingPrompt(input: DashboardBriefingRequestInput): string {
  const { attendancePercent, sectionsAtRiskCount, openEnquiries, enrolledCount, collections } = input;

  const lines: string[] = [];
  if (attendancePercent !== undefined) lines.push(`Attendance today: ${attendancePercent}%.`);
  if (sectionsAtRiskCount !== undefined) lines.push(`Sections below the attendance threshold today: ${sectionsAtRiskCount}.`);
  lines.push(
    `Open admissions enquiries: ${openEnquiries}. Enrolled this academic year: ${enrolledCount}.`,
  );
  if (collections) {
    lines.push(`Fee collections this term: ${collections.collectedPaise} of ${collections.duePaise} paise due.`);
  }
  return lines.join("\n");
}
