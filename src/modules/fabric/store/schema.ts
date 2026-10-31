// F-BE-04 — structural Zod schema for imported/persisted demo state. Checks
// shape (version literal, record/array fields) and caps every string at
// 4000 chars; it does not re-validate each row against its full
// src/modules/fabric/types.ts shape (that contract is enforced by callers
// via TypeScript, not by this JSON boundary check).
import { z } from "zod";

const MAX_STRING = 4000;
const str = z.string().max(MAX_STRING);

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
const jsonPrimitive = z.union([str, z.number(), z.boolean(), z.null()]);
const jsonValue: z.ZodType<Json> = z.lazy(() =>
  z.union([jsonPrimitive, z.array(jsonValue), z.record(str, jsonValue)]),
);
const row = z.record(str, jsonValue);

export const DemoStateSchema = z.object({
  version: z.literal(1),
  hydrated: z.boolean(),
  layouts: z.record(str, z.array(str)),
  installs: z.array(row),
  scenarios: z.array(row),
  requests: z.array(row),
  proposals: z.array(row),
  workflows: z.array(row),
  memories: z.array(row),
  goals: z.array(row),
  interventions: z.array(row),
  insightStatus: z.record(str, str),
  insightActions: z.array(row),
  notes: z.record(str, str),
});

export type DemoStateInput = z.infer<typeof DemoStateSchema>;
