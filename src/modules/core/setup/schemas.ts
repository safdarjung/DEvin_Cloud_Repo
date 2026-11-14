// F18 §H — automated school setup: /start body, the v1 institutions body
// (0127: invite code only) and the core.setup.* action inputs.
import { z } from "zod";
import { isoDate } from "@/lib/schemas/common";
import { CreateInstitutionSchema, SETUP_STEPS } from "@/modules/core/schemas";
import { BOARDS, GRADE_LADDER, MAX_SECTIONS_PER_GRADE } from "./templates";

// Real codes are upper-case Crockford base32 (scripts/invite-create.ts); the
// SQL hashes btrim(code), case-sensitive. Length beyond 200 is a shape error;
// every other bad code gets the one generic SQL `forbidden`.
export const InviteCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .transform((code) => code.toUpperCase());

const SLUG_FORMAT = /^[a-z0-9](-?[a-z0-9])*$/; // create_institution (0064)

// POST /api/v1/institutions after 0127: create_institution_with_invite takes
// only code, name and slug, so timezone/yearStart are no longer accepted.
export const CreateInstitutionWithInviteSchema = CreateInstitutionSchema.pick({ name: true, slug: true })
  .extend({ code: InviteCodeSchema })
  .strict();

// POST /api/public/start. Password: Supabase's own floor is 6
// (supabase/config.toml); an owner account gets 8, and bcrypt reads 72 bytes.
export const StartSchoolSchema = z
  .object({
    code: InviteCodeSchema,
    schoolName: CreateInstitutionSchema.shape.name,
    slug: CreateInstitutionSchema.shape.slug.pipe(z.string().regex(SLUG_FORMAT, "use lowercase letters, digits and single hyphens")),
    ownerName: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    password: z.string().min(8).max(72),
  })
  .strict();
export type StartSchoolInput = z.infer<typeof StartSchoolSchema>;

export const ApplyTemplateSchema = z
  .object({
    board: z.enum(BOARDS),
    fromGrade: z.enum(GRADE_LADDER),
    toGrade: z.enum(GRADE_LADDER),
    sectionsPerGrade: z.number().int().min(1).max(MAX_SECTIONS_PER_GRADE),
    /** Defaults to 1 April of the current academic year, like create_institution. */
    yearStart: isoDate.optional(),
  })
  .strict()
  .refine((v) => GRADE_LADDER.indexOf(v.fromGrade) <= GRADE_LADDER.indexOf(v.toGrade), {
    message: "The last grade must come after the first grade.",
    path: ["toGrade"],
  });
export type ApplyTemplateInput = z.infer<typeof ApplyTemplateSchema>;

export const SaveBrandingSchema = z
  .object({
    /** `<institution_id>/logo.<ext>`; the action checks the id is the caller's school. */
    logoPath: z.string().max(100).regex(/^[0-9a-f-]{36}\/logo\.(png|jpg|jpeg|webp)$/, "not a logo path").optional(),
    primaryColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "use a #rrggbb colour")
      .transform((c) => c.toLowerCase())
      .optional(),
  })
  .strict()
  .refine((v) => v.logoPath !== undefined || v.primaryColor !== undefined, { message: "Nothing to save." });
export type SaveBrandingInput = z.infer<typeof SaveBrandingSchema>;

// The school's display name (sidebar, dashboards, report cards, website).
export const SaveSchoolNameSchema = z.object({ name: z.string().trim().min(2, "Enter the school's name.").max(120) }).strict();
export type SaveSchoolNameInput = z.infer<typeof SaveSchoolNameSchema>;

// "todo" clears the mark, so a skipped step can be resumed.
export const SetProgressSchema = z
  .object({ step: z.enum(SETUP_STEPS), state: z.enum(["done", "dismissed", "todo"]) })
  .strict();
export type SetProgressInput = z.infer<typeof SetProgressSchema>;
