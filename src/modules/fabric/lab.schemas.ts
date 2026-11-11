// features-18 §D — Analysis lab schemas: query inputs, the two AI routes'
// request/generation schemas, the server-side clamp of AI assumptions, and
// the digit post-check on AI explanations. Lesson 9: every generated string
// is capped (<= 500) and both routes pass maxOutputTokens.
import { z } from "zod";
import { uuid } from "@/lib/schemas/common";
import type { ScenarioAssumptions } from "@/modules/fabric/types";
import { ScenarioAssumptionsSchema } from "@/modules/fabric/simulator.schemas";

export const LabQuerySchema = z.object({}).strict();

const institutionSlug = z.string().trim().min(1).max(100);

// ---------------------------------------------------------------- /api/ai/lab-scenario
export const LabScenarioRequestSchema = z
  .object({
    institutionSlug,
    text: z.string().trim().min(3).max(500),
  })
  .strict();

const SLIDER_KEYS = Object.keys(ScenarioAssumptionsSchema.shape) as (keyof ScenarioAssumptions)[];

// No min/max here on purpose: an out-of-range model number is clamped
// server-side (clampScenarioAssumptions), not rejected. null = "not mentioned".
export const LabScenarioGenerationSchema = z
  .object({
    enrolment_delta_pct: z.number().nullable(),
    staff_delta: z.number().nullable(),
    fee_change_pct: z.number().nullable(),
    cost_change_pct: z.number().nullable(),
    periods_per_day: z.number().nullable(),
    horizon_months: z.number().nullable(),
  })
  .strict();
export type LabScenarioGeneration = z.infer<typeof LabScenarioGenerationSchema>;

/** Model output -> slider values: rounded to the sliders' step of 1, clamped to their ranges; null/non-finite keys are left out. */
export function clampScenarioAssumptions(raw: LabScenarioGeneration): Partial<ScenarioAssumptions> {
  const out: Partial<ScenarioAssumptions> = {};
  for (const key of SLIDER_KEYS) {
    const value = raw[key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const range = ScenarioAssumptionsSchema.shape[key];
    out[key] = Math.min(range.maxValue ?? value, Math.max(range.minValue ?? value, Math.round(value)));
  }
  return out;
}

// ---------------------------------------------------------------- /api/ai/lab-explain
export const LAB_PANEL_KINDS = ["correlation", "anomalies", "fee_risk", "trend_breaks"] as const;
export type LabPanelKind = (typeof LAB_PANEL_KINDS)[number];

// Body is kind + ref only: every number the model sees is re-read server-side.
export const LabExplainRequestSchema = z.discriminatedUnion("kind", [
  z.object({ institutionSlug, kind: z.enum(LAB_PANEL_KINDS), ref: z.null().optional() }).strict(),
  z.object({ institutionSlug, kind: z.literal("section"), ref: uuid }).strict(),
  z.object({ institutionSlug, kind: z.literal("scenario"), ref: ScenarioAssumptionsSchema }).strict(),
]);
export type LabExplainRequest = z.infer<typeof LabExplainRequestSchema>;
export type LabExplainKind = LabExplainRequest["kind"];

export const LabExplainGenerationSchema = z
  .object({
    bullets: z.array(z.string().trim().min(1).max(200)).min(1).max(5),
    caveat: z.string().trim().min(1).max(300),
  })
  .strict();
export type LabExplainGeneration = z.infer<typeof LabExplainGenerationSchema>;

export interface LabExplainResponse {
  bullets: string[];
  caveat: string;
  /** "ai" = model narration that passed the digit check; "rules" = deterministic captions. */
  source: "ai" | "rules";
  provider: "local" | "cloud" | null;
  model: string | null;
}

const NUMBER_TOKEN = /\d+(?:[.,]\d+)*/g;

function normaliseNumber(token: string): string {
  const n = Number(token.replace(/,/g, ""));
  return Number.isFinite(n) ? String(n) : token;
}

/**
 * Digit sequences in `output` that never appear in `input` (after dropping
 * thousands separators and trailing zeros). Non-empty = the model invented
 * or re-derived a number, so the caller falls back to deterministic captions.
 * shortcut: "5,6" reads as 56 and a sign is ignored; upgrade to a tokeniser
 * if real outputs trip on it.
 */
export function findUnsupportedNumbers(output: string, input: string): string[] {
  const allowed = new Set((input.match(NUMBER_TOKEN) ?? []).map(normaliseNumber));
  return [...new Set(output.match(NUMBER_TOKEN) ?? [])].filter((token) => !allowed.has(normaliseNumber(token)));
}
