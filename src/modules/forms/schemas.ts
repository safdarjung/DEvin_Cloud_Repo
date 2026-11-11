// Forms (features-18 #13) — Zod schemas. Relative + .ts imports: seed-script safe.
// Field rules mirror app.guard_forms_write / app.submit_form_response (0122) so errors show before the trigger.
import { z } from "zod";
import { uuid } from "../../lib/schemas/common.ts";

export const FORM_MAX_FIELDS = 30;
export const FORM_TEXT_ANSWER_MAX = 500;

const label = z.string().trim().min(1).max(200);
const required = z.boolean().optional();

export const FormFieldSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), label, required }).strict(),
  z.object({ type: z.literal("consent"), label, required }).strict(),
  z
    .object({
      type: z.literal("choice"),
      label,
      required,
      options: z
        .array(z.string().trim().min(1).max(80))
        .min(2)
        .max(10)
        .refine((o) => new Set(o).size === o.length, { message: "Options must be distinct" }),
    })
    .strict(),
]);
export type FormField = z.infer<typeof FormFieldSchema>;

const fields = z.array(FormFieldSchema).min(1).max(FORM_MAX_FIELDS);
const sectionIds = z.array(uuid).max(100).refine((a) => new Set(a).size === a.length, { message: "Duplicate sections" });
const title = z.string().trim().min(1).max(120);
const description = z.string().trim().max(1000).optional();

export const FormCreateSchema = z.object({ title, description, fields, classSectionIds: sectionIds }).strict();
export type FormCreateInput = z.infer<typeof FormCreateSchema>;

export const FormUpdateSchema = z.object({ formId: uuid, title, description, fields, classSectionIds: sectionIds }).strict();
export type FormUpdateInput = z.infer<typeof FormUpdateSchema>;

export const FormIdSchema = z.object({ formId: uuid }).strict();
export type FormIdInput = z.infer<typeof FormIdSchema>;

/** Option index for choice, string for text, boolean for consent, null when skipped. */
export const FormAnswerSchema = z.union([z.string().max(FORM_TEXT_ANSWER_MAX), z.number().int().min(0).max(9), z.boolean(), z.null()]);
export type FormAnswer = z.infer<typeof FormAnswerSchema>;

export const FormRespondSchema = z
  .object({ formId: uuid, studentId: uuid.nullable(), answers: z.array(FormAnswerSchema).min(1).max(FORM_MAX_FIELDS) })
  .strict();
export type FormRespondInput = z.infer<typeof FormRespondSchema>;

export const FormListSchema = z.object({}).strict();
export const FormMineSchema = z.object({}).strict();

/** Per-field problems (index -> message) for answers against a form's fields; empty when valid. Mirrors submit_form_response. */
export function validateFormAnswers(formFields: FormField[], answers: FormAnswer[]): Record<number, string> {
  const errors: Record<number, string> = {};
  formFields.forEach((f, i) => {
    const a = answers[i] ?? null;
    const req = f.required ?? false;
    if (a === null) {
      if (req) errors[i] = "Required.";
      return;
    }
    if (f.type === "text") {
      if (typeof a !== "string") errors[i] = "Enter text.";
      else if (a.length > FORM_TEXT_ANSWER_MAX) errors[i] = `At most ${FORM_TEXT_ANSWER_MAX} characters.`;
      else if (req && a.trim() === "") errors[i] = "Required.";
    } else if (f.type === "choice") {
      if (typeof a !== "number" || a >= f.options.length) errors[i] = "Pick an option.";
    } else if (typeof a !== "boolean") errors[i] = "Choose yes or no.";
    else if (req && !a) errors[i] = "Consent is required.";
  });
  return errors;
}
