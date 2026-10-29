// T-024 — public enquiry input (06 §W3 "Inputs (enquiry)"). Validated again
// inside `app.submit_public_enquiry` regardless (defense in depth, same
// lesson as 0007's header comment) — this schema exists to reject garbage
// before the service-role call and to shape the route's 400 field errors.
import { z } from "zod";
import { phoneIN } from "@/lib/schemas/common";

// Fixed set from 05 §4.1's default `settings.academic.grade_groups`
// (primary + middle + secondary + senior_secondary), not read from the
// `grades` table: `grades` has no anon RLS policy (05 §5 class S), and this
// route runs as anon/service-role, never a signed-in staff session.
// shortcut: an institution with a non-Roman-numeral grade naming scheme
// would reject every gradeCode here; fine for the demo's one CBSE-style
// institution — revisit if a second grade-naming scheme ships.
export const GRADE_CODES = [
  "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII",
] as const;

export const EnquiryInputSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9-]+$/, "slug must be lowercase letters, digits and hyphens"),
    childName: z.string().trim().min(1).max(120),
    guardianName: z.string().trim().min(1).max(200),
    phone: phoneIN,
    gradeCode: z.enum(GRADE_CODES).optional(),
    email: z.string().trim().email().max(200).optional(),
    message: z.string().trim().max(2000).optional(),
    // Honeypot (06 §W3, C-83): a real visitor never sees or fills this
    // field. Deliberately NOT `z.literal("")` — a bot that autofills every
    // field must still pass validation so the route (not Zod) decides the
    // honeypot outcome and returns the generic success body with no row.
    website: z.string().max(200).optional().default(""),
  })
  .strict();

export type EnquiryInput = z.infer<typeof EnquiryInputSchema>;
