// Textbooks + curriculum materials (0139) — Zod schemas. Relative + .ts
// imports: seed-script safe. Limits mirror the 0139 checks and the
// documents module (10 MB cap, PDF/JPEG/PNG, 0067 bucket).
import { z } from "zod";
import { uuid } from "../../lib/schemas/common.ts";
import { ALLOWED_MIMES, MAX_DOCUMENT_SIZE_BYTES } from "../documents/schemas.ts";
import { httpsUrl } from "../resources/schemas.ts";

export const MAX_CHAPTER = 99;
const chapterNo = z.number().int().min(1).max(MAX_CHAPTER);
const title = z.string().trim().min(1).max(160);

// ---- textbook mapping -------------------------------------------------------

export const SuggestNcertSchema = z.object({}).strict();
export type SuggestNcertInput = z.infer<typeof SuggestNcertSchema>;

export const AddTextbookSchema = z
  .object({
    gradeId: uuid,
    subjectId: uuid,
    book: z.discriminatedUnion("source", [
      z.object({ source: z.literal("ncert"), code: z.string().trim().regex(/^[a-z0-9]{3,12}$/), schoolUrl: httpsUrl.optional() }).strict(),
      z
        .object({
          source: z.literal("custom"),
          title,
          publisher: z.string().trim().min(1).max(120).optional(),
          url: httpsUrl.optional(),
          chapters: chapterNo.optional(),
        })
        .strict(),
    ]),
  })
  .strict();
export type AddTextbookInput = z.infer<typeof AddTextbookSchema>;

export const TextbookIdSchema = z.object({ textbookId: uuid }).strict();
export type TextbookIdInput = z.infer<typeof TextbookIdSchema>;

/** The school's own link on a book (an e-book, a scan); null clears it. NCERT rows keep their official link separately. */
export const SetTextbookLinkSchema = z.object({ textbookId: uuid, url: httpsUrl.nullable() }).strict();
export type SetTextbookLinkInput = z.infer<typeof SetTextbookLinkSchema>;

/** Whole books run past the 10 MB cap of other files; textbook PDFs only (migration 0142). */
export const MAX_TEXTBOOK_FILE_BYTES = 52428800;
export const RequestTextbookFileSchema = z
  .object({ textbookId: uuid, fileName: z.string().trim().min(1).max(200), sizeBytes: z.number().int().min(1).max(MAX_TEXTBOOK_FILE_BYTES) })
  .strict();
export type RequestTextbookFileInput = z.infer<typeof RequestTextbookFileSchema>;

/** The school's own chapter names ("1" -> "Patterns in Mathematics"); an empty string clears one. */
export const SetChapterTitlesSchema = z
  .object({
    textbookId: uuid,
    titles: z.record(z.string().regex(/^[1-9][0-9]?$/), z.string().trim().max(120)).refine((r) => Object.keys(r).length <= MAX_CHAPTER, { message: "Too many chapters" }),
  })
  .strict();
export type SetChapterTitlesInput = z.infer<typeof SetChapterTitlesSchema>;

/** chapterNo null removes the unit's link. */
export const SetUnitChapterSchema = z
  .object({ unitId: uuid, textbookId: uuid.optional(), chapterNo: chapterNo.nullable() })
  .strict()
  .refine((v) => v.chapterNo === null || v.textbookId !== undefined, { message: "Choose a book", path: ["textbookId"] });
export type SetUnitChapterInput = z.infer<typeof SetUnitChapterSchema>;

// ---- curriculum materials ----------------------------------------------------

export const MATERIAL_MIMES = ALLOWED_MIMES;
export const MAX_MATERIAL_BYTES = MAX_DOCUMENT_SIZE_BYTES;

const target = z.object({ gradeId: uuid, subjectId: uuid, unitId: uuid.optional() }).strict();

/** No target: an unfiled private file (the chat attach flow files it afterwards). */
export const RequestMaterialUploadSchema = z
  .object({
    fileName: z.string().trim().min(1).max(200),
    mime: z.enum(MATERIAL_MIMES),
    sizeBytes: z.number().int().min(1).max(MAX_MATERIAL_BYTES),
    title: title.optional(),
    target: target.optional(),
    /** Staff only: keep a filed upload private instead of sharing it with the class. */
    private: z.boolean().optional(),
  })
  .strict();
export type RequestMaterialUploadInput = z.infer<typeof RequestMaterialUploadSchema>;

export const MaterialIdSchema = z.object({ materialId: uuid }).strict();
export type MaterialIdInput = z.infer<typeof MaterialIdSchema>;

export const SHARE_OPTIONS = ["private", "class", "suggest"] as const;

/** Files an uploaded material: staff choose private|class, students private|suggest (suggest = offer it to the subject teacher). */
export const AttachMaterialSchema = z
  .object({
    materialId: uuid,
    gradeId: uuid,
    subjectId: uuid,
    unitId: uuid.optional(),
    share: z.enum(SHARE_OPTIONS),
    title: title.optional(),
  })
  .strict();
export type AttachMaterialInput = z.infer<typeof AttachMaterialSchema>;

export const SuggestMaterialSchema = z.object({ materialId: uuid, suggest: z.boolean() }).strict();
export type SuggestMaterialInput = z.infer<typeof SuggestMaterialSchema>;

export const ReviewMaterialSchema = z.object({ materialId: uuid, decision: z.enum(["approve", "decline"]) }).strict();
export type ReviewMaterialInput = z.infer<typeof ReviewMaterialSchema>;
