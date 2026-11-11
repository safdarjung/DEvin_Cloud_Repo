// features-18 §C #18 — /api/ai/ptm-brief. Suggestions for the teacher's
// meeting; nothing is stored against the student. Lesson 9: ≤500 chars.
import { z } from "zod";
import { uuid } from "@/lib/schemas/common";

export const PtmBriefRequestSchema = z
  .object({
    institutionSlug: z.string().trim().min(1).max(100),
    studentId: uuid,
  })
  .strict();
export type PtmBriefRequest = z.infer<typeof PtmBriefRequestSchema>;

const point = z.string().trim().min(1).max(200);

export const PtmBriefGenerationSchema = z
  .object({
    strengths: z.array(point).min(1).max(3),
    concerns: z.array(point).max(3),
    talkingPoints: z.array(point).length(3),
    nextSteps: z.array(point).length(2),
  })
  .strict();
export type PtmBriefGeneration = z.infer<typeof PtmBriefGenerationSchema>;

export interface PtmBriefResponse {
  brief: PtmBriefGeneration;
  provider: "local" | "cloud";
  model: string;
  fallback: boolean;
}
