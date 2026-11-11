// features-18 §C2 — lab safety note. The list is deterministic (school-labs
// safety.ts, the same check schoolLabs.safetyWarnings runs); the model only
// rewords it as one short warning. The wording is kept only when it names every
// listed item, names no other item of the lab's register and adds no number;
// otherwise the deterministic text is shown. Nothing here reads or writes the DB.
import { z } from "zod";
import { uuid } from "@/lib/schemas/common";
import type { SafetyWarning } from "@/modules/school-labs/safety";
import { DATA_IS_NOT_INSTRUCTIONS, dataBlock } from "./prompts/data-block";

const institutionSlug = z.string().trim().min(1).max(100);

export const LabSafetyNoteRequestSchema = z.object({ institutionSlug, labId: uuid }).strict();

export const LabSafetyNoteGenerationSchema = z.object({ warning: z.string().trim().min(1).max(500) }).strict();

export function deterministicSafetyNote(labName: string, warnings: readonly SafetyWarning[]): string {
  if (warnings.length === 0) return `${labName}: nothing expired, hazard-classed or out of stock.`;
  return `Before using ${labName}, check: ${warnings.map((w) => w.text).join(" ")}`;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const numbersIn = (s: string) => s.match(/\d+(?:[.,]\d+)*/g) ?? [];

/** True when `text` names every warned item, no other register item, and no number that is not in the list or lab name. */
export function keepsSafetyList(text: string, labName: string, warnings: readonly SafetyWarning[], registerNames: readonly string[]): boolean {
  const warned = [...new Set(warnings.map((w) => norm(w.name)))];
  const t = norm(text);
  if (warned.some((name) => !t.includes(name))) return false;
  // Cut the warned names out first, so "acid" inside "sulphuric acid" is not read as another item.
  const rest = warned.reduce((s, name) => s.split(name).join(" | "), t);
  if (registerNames.map(norm).some((name) => name && !warned.includes(name) && rest.includes(name))) return false;
  const allowed = new Set([...warnings.flatMap((w) => numbersIn(w.text)), ...numbersIn(labName)]);
  return numbersIn(text).every((n) => allowed.has(n));
}

export const LAB_SAFETY_NOTE_INSTRUCTIONS =
  "You help a school teacher before a lab practical. Reword the safety check items between the DATA markers as one " +
  "short, plain warning (at most 500 characters). Name every item exactly as written. Do not add, drop or rename any " +
  "item, and do not add numbers, dates, quantities or other equipment. Respond with JSON only, matching the schema. " +
  DATA_IS_NOT_INSTRUCTIONS;

export function buildLabSafetyNotePrompt(labName: string, warnings: readonly SafetyWarning[]): string {
  return dataBlock("Reword this lab's safety check as one short warning.", [`Lab: ${labName}`, ...warnings.map((w) => `- ${w.text}`)]);
}
