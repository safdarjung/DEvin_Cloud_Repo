// Approval-card fields that people should pick, not type (owner, 2026-11-12: "we don't want the user
// typing stuff he can select from options"). A strict list becomes a select or radio group; an open
// list (units, positions, visit purposes) stays typeable with suggestions to pick from. School-specific
// lists (admission stages, grading scales) come from the school's own settings. Pure.
import type { TenantContext } from "@/lib/auth/types";
import type { TaskFieldView } from "./types";

type Patch = Partial<TaskFieldView>;

const pick = (options: readonly string[], optionLabels?: readonly string[]): Patch => ({ kind: "enum", options, ...(optionLabels ? { optionLabels } : {}) });
const suggest = (suggestions: readonly string[]): Patch => ({ suggestions });
/** "visit_scheduled" -> "Visit scheduled". */
export const humanCode = (code: string): string => code.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());

const GENDERS = ["Male", "Female", "Other"];
const UNITS = ["pcs", "box", "pack", "set", "kg", "g", "litre", "ml", "metre", "ream", "bottle", "dozen"];
const HOUSE_COLOURS: readonly (readonly [string, string])[] = [
  ["#DC2626", "Red"], ["#2563EB", "Blue"], ["#16A34A", "Green"], ["#CA8A04", "Yellow"], ["#EA580C", "Orange"], ["#7C3AED", "Purple"],
];
const POSITIONS = ["Winner", "1st", "2nd", "3rd", "Runner-up", "Participation", "Special mention"];
const VISIT_PURPOSES = ["Meeting a teacher", "Meeting the principal", "Fee payment", "Admission enquiry", "Student pickup", "Delivery", "Maintenance work", "Interview"];
const GRADE_GROUPS = ["Pre-primary", "Primary", "Middle", "Secondary", "Senior secondary"];

type Settings = { admissions?: { stages?: unknown }; exams?: { grading_scales?: unknown } };

/** Field patches for one task's card, by field path ("*" for array items). */
export function choicePatches(ctx: Pick<TenantContext, "institution">, action: string): Record<string, Patch> {
  const settings = (ctx.institution.settings ?? {}) as Settings;
  switch (action) {
    case "admissions.enquiry.status": {
      const stages = Array.isArray(settings.admissions?.stages) ? (settings.admissions.stages as unknown[]).filter((s): s is string => typeof s === "string") : [];
      return stages.length ? { "/status": pick(stages, stages.map(humanCode)) } : {};
    }
    case "admissions.enquiry.convert":
      return { "/applicant/gender": pick(GENDERS) };
    case "exam.create": {
      const scales = settings.exams?.grading_scales && typeof settings.exams.grading_scales === "object" ? Object.keys(settings.exams.grading_scales) : [];
      return scales.length ? { "/gradingScaleKey": pick(scales, scales.map(humanCode)) } : {};
    }
    case "form.create":
      return { "/fields/*/type": pick(["text", "consent", "choice"], ["Short answer", "Consent (tick box)", "Multiple choice"]) };
    case "announcement.create":
      return { "/audiences/*/type": pick(["school", "role", "grade", "section"], ["Whole school", "Everyone in a role", "A grade", "A section"]) };
    case "inventory.item.create":
    case "inventory.item.update":
    case "schoolLabs.equipment.create":
      return { "/unit": suggest(UNITS) };
    case "clubs.house.create":
      return { "/colour": pick(HOUSE_COLOURS.map(([hex]) => hex), HOUSE_COLOURS.map(([, name]) => name)) };
    case "achievement.record":
      return { "/position": suggest(POSITIONS) };
    case "visitors.checkIn":
      return { "/purpose": suggest(VISIT_PURPOSES) };
    case "academics.grade.upsert":
      return { "/gradeGroup": suggest(GRADE_GROUPS) };
    default:
      return {};
  }
}
