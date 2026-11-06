// F-UI-12 (live-fabric studio lane) — Zod schemas for studio.* actions and
// the AI proposal's structured output. Every object is .strict().
import { z } from "zod";
import { uuid } from "@/lib/schemas/common";

export const STUDIO_BUDGET_RANGES = ["under_50k", "50k_2l", "2l_10l", "above_10l", "unknown"] as const;
export const STUDIO_RESOLUTIONS = [
  "existing_feature",
  "configuration",
  "combine_modules",
  "integration",
  "new_module",
  "platform_change",
] as const;

export const SubmitStudioRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    problem: z.string().trim().min(1).max(2000),
    desiredOutcome: z.string().trim().min(1).max(2000),
    userRoles: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
    existingSystems: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
    integrations: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
    constraints: z.string().trim().max(1000).default(""),
    budgetRange: z.enum(STUDIO_BUDGET_RANGES),
    timeline: z.string().trim().min(1).max(100),
    successCriteria: z.string().trim().min(1).max(1000),
  })
  .strict();
export type SubmitStudioRequestInput = z.infer<typeof SubmitStudioRequestSchema>;

export const StudioRequestIdSchema = z.object({ requestId: uuid }).strict();
export type StudioRequestIdInput = z.infer<typeof StudioRequestIdSchema>;

export const DecideStudioRequestSchema = z
  .object({
    requestId: uuid,
    decision: z.enum(["approve", "reject"]),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type DecideStudioRequestInput = z.infer<typeof DecideStudioRequestSchema>;

/** `runStructured`'s schema for the `studio_proposal` AI feature — every string capped well under the 500-char gateway lesson. */
export const StudioProposalSchema = z
  .object({
    resolution: z.enum(STUDIO_RESOLUTIONS),
    interpretation: z.string().trim().min(1).max(500),
    clarifyingQuestions: z.array(z.string().trim().min(1).max(300)).max(5).default([]),
    features: z.array(z.string().trim().min(1).max(200)).min(1).max(8),
    workflows: z.array(z.string().trim().min(1).max(300)).max(5).default([]),
    uxOutline: z.array(z.string().trim().min(1).max(200)).max(5).default([]),
    technicalRequirements: z.array(z.string().trim().min(1).max(200)).max(8).default([]),
    integrationRequirements: z.array(z.string().trim().min(1).max(200)).max(8).default([]),
    permissionRequirements: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
    costEstimatePaise: z.number().int().min(0),
    timelineWeeks: z.number().int().min(1).max(104),
    risks: z.array(z.string().trim().min(1).max(300)).max(5).default([]),
    acceptanceCriteria: z.array(z.string().trim().min(1).max(300)).min(1).max(5),
  })
  .strict();
export type StudioProposalInput = z.infer<typeof StudioProposalSchema>;
