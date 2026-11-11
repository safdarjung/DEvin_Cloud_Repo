// Resources (features-18 #23) — Zod schemas. Relative + .ts imports: seed-script safe.
// URL and kind rules mirror resources_kind_source_check and the url regex in 0131.
import { z } from "zod";
import { uuid } from "../../lib/schemas/common.ts";

export const RESOURCE_KINDS = ["link", "file", "video", "note"] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

// Same pattern as the DB check: lowercase https scheme, a host, optional path/query/fragment, no spaces.
const HTTPS_URL = /^https:\/\/[^\s/?#]+([/?#]\S*)?$/;
export const RESOURCE_URL_MAX = 2000;

/** True for a string safe to use as an href: https only. Used again at render time (defense in depth). */
export function isSafeHttpsUrl(url: string): boolean {
  return url.length <= RESOURCE_URL_MAX && HTTPS_URL.test(url);
}

/** Trim, lowercase only the scheme (HTTPS:// -> https://), then require https. http://, javascript:, data: etc. fail. */
export const httpsUrl = z
  .string()
  .trim()
  .transform((s) => s.replace(/^https:\/\//i, "https://"))
  .refine(isSafeHttpsUrl, { message: "Enter a full https:// link." });

const sectionIds = z.array(uuid).max(100).refine((a) => new Set(a).size === a.length, { message: "Duplicate sections" });

export const ResourceCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    kind: z.enum(RESOURCE_KINDS),
    url: httpsUrl.optional(),
    subjectId: uuid,
    curriculumUnitId: uuid.optional(),
    description: z.string().trim().min(1).max(2000).optional(),
    classSectionIds: sectionIds,
  })
  .strict()
  .superRefine((v, ctx) => {
    const needsUrl = v.kind === "link" || v.kind === "video";
    if (needsUrl && !v.url) ctx.addIssue({ code: "custom", path: ["url"], message: "A link is required." });
    if (!needsUrl && v.url) ctx.addIssue({ code: "custom", path: ["url"], message: "Only link and video resources take a URL." });
    if (v.kind === "note" && !v.description) ctx.addIssue({ code: "custom", path: ["description"], message: "A note needs text." });
  });
export type ResourceCreateInput = z.infer<typeof ResourceCreateSchema>;

export const ResourceAttachFileSchema = z.object({ resourceId: uuid, documentId: uuid }).strict();
export type ResourceAttachFileInput = z.infer<typeof ResourceAttachFileSchema>;

export const ResourcePublishSchema = z.object({ resourceId: uuid, published: z.boolean() }).strict();
export type ResourcePublishInput = z.infer<typeof ResourcePublishSchema>;

export const ResourceIdSchema = z.object({ resourceId: uuid }).strict();
export type ResourceIdInput = z.infer<typeof ResourceIdSchema>;

export const ResourceBrowseSchema = z.object({ subjectId: uuid.optional() }).strict();
export type ResourceBrowseInput = z.infer<typeof ResourceBrowseSchema>;

export const PortalResourcesSchema = z.object({ studentId: uuid }).strict();
export const ResourceSummarySchema = z.object({}).strict();
