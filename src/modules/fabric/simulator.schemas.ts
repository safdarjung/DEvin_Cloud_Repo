import { z } from "zod";
import { uuid } from "@/lib/schemas/common";

// Ranges mirror the F-UI-08 packet's slider bounds exactly.
export const ScenarioAssumptionsSchema = z
  .object({
    enrolment_delta_pct: z.number().min(-20).max(30),
    staff_delta: z.number().min(-10).max(15),
    fee_change_pct: z.number().min(-10).max(25),
    cost_change_pct: z.number().min(-5).max(20),
    periods_per_day: z.number().int().min(6).max(9),
    horizon_months: z.number().int().min(6).max(24),
  })
  .strict();

export const CreateScenarioSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    rationale: z.string().trim().max(500).default(""),
    assumptions: ScenarioAssumptionsSchema,
    status: z.enum(["draft", "proposed"]).default("draft"),
  })
  .strict();
export type CreateScenarioInput = z.infer<typeof CreateScenarioSchema>;

export const UpdateScenarioSchema = z
  .object({
    id: uuid,
    name: z.string().trim().min(1).max(80).optional(),
    rationale: z.string().trim().max(500).optional(),
    assumptions: ScenarioAssumptionsSchema.optional(),
    status: z.enum(["draft", "proposed"]).optional(),
  })
  .strict();
export type UpdateScenarioInput = z.infer<typeof UpdateScenarioSchema>;

export const DecideScenarioSchema = z
  .object({
    id: uuid,
    decision: z.enum(["approved", "rejected"]),
  })
  .strict();
export type DecideScenarioInput = z.infer<typeof DecideScenarioSchema>;

export const DeleteScenarioSchema = z.object({ id: uuid }).strict();
export type DeleteScenarioInput = z.infer<typeof DeleteScenarioSchema>;
