// T-024 — public enquiry input (06 §W3 "Inputs (enquiry)"). Validated again
// inside `app.submit_public_enquiry` regardless (defense in depth, same
// lesson as 0007's header comment) — this schema exists to reject garbage
// before the service-role call and to shape the route's 400 field errors.
//
// T-025 — editor action schemas (06 §W3 edit/publish). `BlocksSchema` is
// imported from blocks.ts, never redefined here, so the editor and the
// public renderer can't drift (blocks.ts header comment).
import { z } from "zod";
import { longText, phoneIN, shortText, uuid } from "@/lib/schemas/common";
import { BlocksSchema } from "./blocks";
import { WebsiteThemeSchema, type WebsiteTheme } from "./theme";

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

const SLUG_PATTERN = /^[a-z0-9-]+$/;

export const CreatePageSchema = z
  .object({
    slug: z.string().trim().min(1).max(100).regex(SLUG_PATTERN, "slug must be lowercase letters, digits and hyphens"),
    title: shortText,
  })
  .strict();

export type CreatePageInput = z.infer<typeof CreatePageSchema>;

export const SavePageVersionSchema = z
  .object({
    pageId: uuid,
    blocks: BlocksSchema,
  })
  .strict();

export type SavePageVersionInput = z.infer<typeof SavePageVersionSchema>;

export const PublishPageSchema = z
  .object({
    pageId: uuid,
    versionId: uuid,
  })
  .strict();

export type PublishPageInput = z.infer<typeof PublishPageSchema>;

export const SetWebsiteLiveSchema = z
  .object({
    isLive: z.boolean(),
  })
  .strict();

export type SetWebsiteLiveInput = z.infer<typeof SetWebsiteLiveSchema>;

// `audience` (05 §2.8) is editor-authored JSON with no RLS enforcement yet
// (DBT-22, known debt — not fixed by this packet). A bounded list of role
// names is enough shape to stop garbage without pretending it's enforced.
const NoticeAudienceSchema = z.array(z.string().trim().min(1).max(40)).max(20).optional();

export const UpsertNoticeSchema = z
  .object({
    id: uuid.optional(),
    title: shortText,
    body: longText,
    publishAt: z.string().datetime(),
    expiresAt: z.string().datetime().optional(),
    isPublic: z.boolean(),
    audience: NoticeAudienceSchema,
  })
  .strict();

export type UpsertNoticeInput = z.infer<typeof UpsertNoticeSchema>;

export const UpsertEventSchema = z
  .object({
    id: uuid.optional(),
    title: shortText,
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime().optional(),
    location: z.string().trim().max(300).optional(),
    isPublic: z.boolean(),
  })
  .strict();

export type UpsertEventInput = z.infer<typeof UpsertEventSchema>;

// The theme form posts the whole look; the schema lives with its renderer
// helpers in theme.ts so the public site re-validates with the same rules.
export const SaveWebsiteThemeSchema = WebsiteThemeSchema;

export type SaveWebsiteThemeInput = WebsiteTheme;
