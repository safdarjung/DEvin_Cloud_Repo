// T-0NN — AI dashboard briefing schemas (06 §W6 pattern, mirrors
// `quiz.schemas.ts`). Input is the SAME institution-wide aggregates
// `DashboardPage` already computed via `getDashboardData` — the client
// echoes these numbers back, so this schema validates numbers only, never
// free text. No PII ever enters this request (CLAUDE.md rule 6).
import { z } from "zod";

export const DashboardBriefingRequestSchema = z
  .object({
    institutionSlug: z.string().trim().min(1).max(100),
    // Omitted when the caller lacks `attendance.read` (RLS would yield zeros).
    attendancePercent: z.number().min(0).max(100).optional(),
    sectionsAtRiskCount: z.number().int().min(0).optional(),
    openEnquiries: z.number().int().min(0),
    enrolledCount: z.number().int().min(0),
    // Institution-wide fee totals in paise; null when the caller lacks
    // `finance.read` (same rule as `DashboardDTO.collections`).
    collections: z
      .object({
        collectedPaise: z.number().int().min(0),
        duePaise: z.number().int().min(0),
      })
      .nullable(),
  })
  .strict();

export type DashboardBriefingRequestInput = z.infer<typeof DashboardBriefingRequestSchema>;

// Briefing headline schema (M25-T6): 1–200 chars, strict. Replaces the
// legacy `DashboardBriefingOutputSchema` (deleted per rulings "Route") —
// the route now narrates only the headline, not a free-form summary.
export const BriefingHeadlineSchema = z
  .object({
    headline: z.string().trim().min(1).max(200),
  })
  .strict();

export type BriefingHeadlineOutput = z.infer<typeof BriefingHeadlineSchema>;
