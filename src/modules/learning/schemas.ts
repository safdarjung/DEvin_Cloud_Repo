// Phase 5 — learning analytics query inputs. Every object is .strict().
import { z } from "zod";
import { uuid } from "@/lib/schemas/common";

/** Student or guardian reads; studentId defaults to the signed-in student. */
export const MyLearningSchema = z
  .object({
    studentId: uuid.optional(),
    subjectId: uuid.optional(),
  })
  .strict();
export type MyLearningInput = z.infer<typeof MyLearningSchema>;

export const SectionSubjectSchema = z
  .object({
    classSectionId: uuid,
    subjectId: uuid,
  })
  .strict();
export type SectionSubjectInput = z.infer<typeof SectionSubjectSchema>;

export const TestSectionSchema = z
  .object({
    testId: uuid,
    classSectionId: uuid,
  })
  .strict();
export type TestSectionInput = z.infer<typeof TestSectionSchema>;
