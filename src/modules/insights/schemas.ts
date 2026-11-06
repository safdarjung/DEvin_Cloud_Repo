// M19-T13 — Zod schemas for insights.* actions.
import { z } from "zod";
import { uuid } from "../../lib/schemas/common.ts";

// Insight ID schema for single-id operations
export const InsightIdSchema = z
  .object({
    insightId: uuid,
  })
  .strict();
export type InsightIdInput = z.infer<typeof InsightIdSchema>;

// Review insight schema (optionally with a specific reviewer)
export const ReviewInsightSchema = z
  .object({
    insightId: uuid,
    reviewerId: uuid.optional(),
  })
  .strict();
export type ReviewInsightInput = z.infer<typeof ReviewInsightSchema>;

// Close insight schema (resolve or dismiss with a note)
export const CloseInsightSchema = z
  .object({
    insightId: uuid,
    note: z.string().trim().min(5).max(500),
  })
  .strict();
export type CloseInsightInput = z.infer<typeof CloseInsightSchema>;

// Record insight action schema
export const RecordInsightActionSchema = z
  .object({
    insightId: uuid,
    supersedesId: uuid.optional(),
    action: z.string().trim().min(1).max(200),
    owner: z.string().trim().min(1).max(80),
    rationale: z.string().trim().min(1).max(500),
    expectedOutcome: z.string().trim().min(1).max(300),
    status: z
      .enum(["planned", "done", "measured"])
      .default("planned"),
    actualOutcome: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .refine(
    (data) => {
      // If status is 'measured', actualOutcome must be provided
      if (data.status === "measured" && !data.actualOutcome) {
        return false;
      }
      return true;
    },
    {
      message: "actualOutcome is required when status is 'measured'",
      path: ["actualOutcome"],
    }
  );
export type RecordInsightActionInput = z.infer<
  typeof RecordInsightActionSchema
>;

// List insights schema with filtering and pagination
export const ListInsightsSchema = z
  .object({
    status: z
      .array(z.enum(["new", "reviewing", "actioned", "resolved", "dismissed"] as const))
      .max(5)
      .default(["new", "reviewing", "actioned"]),
    domain: z.enum([
      "attendance",
      "academics",
      "finance",
      "admissions",
      "operations",
      "wellbeing",
      "staff",
    ] as const).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  })
  .strict();
export type ListInsightsInput = z.infer<typeof ListInsightsSchema>;

// Insight cards schema for dashboard display
export const InsightCardsSchema = z
  .object({
    limit: z.number().int().min(1).max(6).default(3),
  })
  .strict();
export type InsightCardsInput = z.infer<typeof InsightCardsSchema>;

// Insight explanation schema for AI-generated explanations
export const InsightExplanationSchema = z
  .object({
    what: z.string().trim().min(1).max(500),
    why: z.string().trim().min(1).max(500),
    next_steps: z
      .array(z.string().trim().min(1).max(200))
      .min(1)
      .max(3),
  })
  .strict();
export type InsightExplanationInput = z.infer<
  typeof InsightExplanationSchema
>;
