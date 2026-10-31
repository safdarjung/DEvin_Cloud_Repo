// M03-T9 — grade/section/subject/subject-assignment setup schemas (05 §3,
// 07 §2.2 academics.manage). Columns exactly as 0005 (grades.{code,
// display_name, sort_key, grade_group}, subjects.{code,name,kind}) — the
// task brief's shorthand {name, level} / {name, code?} doesn't match the
// actual not-null columns, so this follows the real schema and
// tests/helpers/factories.ts (createGrade/createSubject), which already
// agree on these field names.
import { z } from "zod";
import { shortText, uuid } from "@/lib/schemas/common";

export const GradeUpsertSchema = z
  .object({
    id: uuid.optional(),
    code: shortText,
    displayName: shortText,
    sortKey: z.number().int(),
    gradeGroup: shortText,
  })
  .strict();
export type GradeUpsertInput = z.infer<typeof GradeUpsertSchema>;

export const SectionUpsertSchema = z
  .object({
    id: uuid.optional(),
    gradeId: uuid,
    academicYearId: uuid,
    name: shortText,
    capacity: z.number().int().positive().optional(),
    classTeacherId: uuid.optional(),
  })
  .strict();
export type SectionUpsertInput = z.infer<typeof SectionUpsertSchema>;

const SUBJECT_KINDS = ["scholastic", "co_scholastic", "skill", "language"] as const;

export const SubjectUpsertSchema = z
  .object({
    id: uuid.optional(),
    code: shortText,
    name: shortText,
    kind: z.enum(SUBJECT_KINDS),
  })
  .strict();
export type SubjectUpsertInput = z.infer<typeof SubjectUpsertSchema>;

// `set` — no `id`: identity is the (classSectionId, subjectId) pair (0005's
// unique constraint). No status/soft-delete column exists on
// subject_assignments to "reactivate" — a repeat of the same pair is a
// straight conflict (see brief's own "duplicate subject assignment ->
// conflict" test case; "reactivate" in the brief doesn't match 0005).
export const SubjectAssignmentSetSchema = z
  .object({
    classSectionId: uuid,
    subjectId: uuid,
    teacherId: uuid,
  })
  .strict();
export type SubjectAssignmentSetInput = z.infer<typeof SubjectAssignmentSetSchema>;
