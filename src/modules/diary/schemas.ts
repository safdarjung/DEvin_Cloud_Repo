// X01-T3 — Zod schemas for diary. Relative + .ts import: seed-script safe.
import { z } from "zod";
import { uuid, isoDate } from "../../lib/schemas/common.ts";

export const DiaryPostSchema = z
  .object({
    classSectionId: uuid,
    subjectId: uuid.optional(),
    entryDate: isoDate,
    body: z.string().trim().min(1).max(2000),
    dueDate: isoDate.optional(),
    requiresAck: z.boolean().default(false),
  })
  .strict()
  .refine(
    (data) => !data.dueDate || data.dueDate >= data.entryDate,
    {
      message: "dueDate must be on or after entryDate",
      path: ["dueDate"],
    }
  );
export type DiaryPostInput = z.infer<typeof DiaryPostSchema>;

export const DiaryDeleteSchema = z
  .object({
    entryId: uuid,
  })
  .strict();
export type DiaryDeleteInput = z.infer<typeof DiaryDeleteSchema>;

export const DiaryAcknowledgeSchema = z
  .object({
    entryId: uuid,
    studentId: uuid,
  })
  .strict();
export type DiaryAcknowledgeInput = z.infer<typeof DiaryAcknowledgeSchema>;

export const DiaryForSectionSchema = z
  .object({
    classSectionId: uuid,
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .strict();
export type DiaryForSectionInput = z.infer<typeof DiaryForSectionSchema>;

export const DiaryForStudentSchema = z
  .object({
    studentId: uuid,
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .strict()
  .refine(
    (data) => !data.from || !data.to || data.from <= data.to,
    {
      message: "from must be on or before to",
      path: ["to"],
    }
  )
  .refine(
    (data) => {
      if (!data.from || !data.to) return true;
      const from = new Date(data.from);
      const to = new Date(data.to);
      const daysInclusive =
        Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      return daysInclusive <= 62;
    },
    {
      message: "query window cannot exceed 62 days",
      path: ["to"],
    }
  );
export type DiaryForStudentInput = z.infer<typeof DiaryForStudentSchema>;

export const DiaryAckStatusSchema = z
  .object({
    entryId: uuid,
  })
  .strict();
export type DiaryAckStatusInput = z.infer<typeof DiaryAckStatusSchema>;
