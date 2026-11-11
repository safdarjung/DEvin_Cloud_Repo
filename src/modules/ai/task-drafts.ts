// features-18 §C2 — request/generation schemas and the deterministic helpers
// for four draft-only AI tasks: helpdesk triage, translate, form from a
// description, substitution handover note. Generation schemas cap every
// string the model writes at 500 chars and the routes always pass
// maxOutputTokens (lesson 9). Nothing here reads or writes the DB.
import { z } from "zod";
import { uuid } from "@/lib/schemas/common";
import { FormCreateSchema, FORM_MAX_FIELDS, type FormField } from "@/modules/forms/schemas";
import { HELPDESK_CATEGORIES, HELPDESK_PRIORITIES } from "@/modules/helpdesk/schemas";

const institutionSlug = z.string().trim().min(1).max(100);

// ---- Helpdesk triage ---------------------------------------------------

export const HelpdeskTriageRequestSchema = z.object({ institutionSlug, ticketId: uuid }).strict();

export const HelpdeskTriageGenerationSchema = z
  .object({
    category: z.enum(HELPDESK_CATEGORIES),
    priority: z.enum(HELPDESK_PRIORITIES),
    reply: z.string().trim().min(1).max(500),
  })
  .strict();

export interface TicketLike {
  id: string;
  subject: string;
  category: string;
}

export interface SimilarTicket extends TicketLike {
  status: string;
}

const words = (text: string): Set<string> => new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3));

/** Up to `limit` past tickets: same category first, then most subject words shared. Code picks them; the model only sees them. */
export function pickSimilarTickets(target: TicketLike, candidates: readonly SimilarTicket[], limit = 3): SimilarTicket[] {
  const own = words(target.subject);
  return candidates
    .filter((c) => c.id !== target.id)
    .map((c) => ({ c, same: c.category === target.category ? 1 : 0, overlap: [...words(c.subject)].filter((w) => own.has(w)).length }))
    .filter((s) => s.same > 0 || s.overlap > 0)
    .sort((a, b) => b.same - a.same || b.overlap - a.overlap)
    .slice(0, limit)
    .map((s) => s.c);
}

// ---- Translate -----------------------------------------------------------

export const TRANSLATE_LANGUAGES = ["hi", "mr", "gu", "ta", "te", "kn", "bn", "pa", "ur", "en"] as const;
export type TranslateLanguage = (typeof TRANSLATE_LANGUAGES)[number];
export const LANGUAGE_NAMES: Record<TranslateLanguage, string> = {
  hi: "Hindi",
  mr: "Marathi",
  gu: "Gujarati",
  ta: "Tamil",
  te: "Telugu",
  kn: "Kannada",
  bn: "Bengali",
  pa: "Punjabi",
  ur: "Urdu",
  en: "English",
};
export const TRANSLATE_MAX_CHARS = 2000;

export const TranslateRequestSchema = z
  .object({ institutionSlug, text: z.string().trim().min(1).max(TRANSLATE_MAX_CHARS), language: z.enum(TRANSLATE_LANGUAGES) })
  .strict();

// 2000 source chars can grow in Indic scripts; parts keep each string <= 500.
export const TranslateGenerationSchema = z.object({ parts: z.array(z.string().max(500)).min(1).max(12) }).strict();

// ---- Form from a description --------------------------------------------

export const FormDraftRequestSchema = z.object({ institutionSlug, description: z.string().trim().min(1).max(500) }).strict();

// A loose, generation-safe frame (no refinements, strings <= 500, every key
// present); the real rules are FormCreateSchema's, applied in toFormDraft.
export const FormDraftGenerationSchema = z
  .object({
    title: z.string().trim().max(120),
    description: z.string().trim().max(500),
    fields: z
      .array(
        z
          .object({
            type: z.enum(["text", "choice", "consent"]),
            label: z.string().trim().max(200),
            required: z.boolean(),
            options: z.array(z.string().trim().max(80)).max(10),
          })
          .strict(),
      )
      .min(1)
      .max(FORM_MAX_FIELDS),
  })
  .strict();
export type FormDraftGeneration = z.infer<typeof FormDraftGenerationSchema>;

export interface FormDraft {
  title: string;
  description?: string;
  fields: FormField[];
}

/** Model output -> builder draft, validated whole by the forms module's own FormCreateSchema; any invalid field rejects the draft. */
export function toFormDraft(gen: FormDraftGeneration): { ok: true; draft: FormDraft } | { ok: false } {
  const parsed = FormCreateSchema.safeParse({
    title: gen.title,
    description: gen.description.trim() || undefined,
    fields: gen.fields.map((f) =>
      f.type === "choice" ? { type: f.type, label: f.label, required: f.required, options: f.options } : { type: f.type, label: f.label, required: f.required },
    ),
    classSectionIds: [],
  });
  if (!parsed.success) return { ok: false };
  const { title, description, fields } = parsed.data;
  return { ok: true, draft: { title, description, fields } };
}

// ---- Substitution handover note -----------------------------------------

export const SubstitutionNoteRequestSchema = z.object({ institutionSlug, substitutionId: uuid }).strict();

export const SubstitutionNoteGenerationSchema = z.object({ note: z.string().trim().min(1).max(500) }).strict();

export interface PlanLike {
  plannedOn: string;
  title: string;
  objectives: string;
  resources: string | null;
}

/** Latest plan on or before `today`, else the next upcoming one, else null. */
export function pickLessonPlan<T extends PlanLike>(plans: readonly T[], today: string): T | null {
  const sorted = [...plans].sort((a, b) => a.plannedOn.localeCompare(b.plannedOn));
  return sorted.filter((p) => p.plannedOn <= today).at(-1) ?? sorted.find((p) => p.plannedOn > today) ?? null;
}

export function noPlanNote(slot: { sectionName: string; subjectName: string; periodName: string }): string {
  return (
    `Cover for ${slot.sectionName}, ${slot.subjectName}, ${slot.periodName}. ` +
    "No lesson plan or diary entry on record for this class and subject. " +
    "Ask the class where they stopped last time, revise that topic, and leave a short note for the class teacher."
  );
}
