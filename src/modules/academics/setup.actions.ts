"use server";

// M03-T9 — grade/section/subject/subject-assignment setup actions (05 §3,
// 07 §2.2 academics.manage). Upsert semantics mirror core/actions.ts's
// upsertAcademicYear/upsertTerm (M03-T8): update when `id` is given (hidden
// or cross-institution row -> not_found), else insert. No deletes (YAGNI,
// same as T8).
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import {
  GradeUpsertSchema,
  SectionUpsertSchema,
  SubjectAssignmentSetSchema,
  SubjectUpsertSchema,
  type GradeUpsertInput,
  type SectionUpsertInput,
  type SubjectAssignmentSetInput,
  type SubjectUpsertInput,
} from "@/modules/academics/setup.schemas";

type AcademicsClient = Awaited<ReturnType<typeof createClient>>;

const POSTGRES_UNIQUE_VIOLATION = "23505";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === POSTGRES_UNIQUE_VIOLATION);
}

// RLS already binds these FKs to the institution (0036); this lookup only
// turns a cross-institution or unknown id into a field-level not_found.
async function assertInInstitution(
  supabase: AcademicsClient,
  table: "class_sections" | "subjects" | "staff",
  id: string,
  institutionId: string,
  notFoundMessage: string,
): Promise<void> {
  const { data, error } = await supabase.from(table).select("id").eq("id", id).eq("institution_id", institutionId).maybeSingle();
  if (error) throwMapped(error);
  if (!data) throw new AppError("not_found", notFoundMessage);
}

export const upsertGrade = defineAction({
  name: "academics.grade.upsert",
  schema: GradeUpsertSchema,
  permission: "academics.manage",
  handler: async ({ id, code, displayName, sortKey, gradeGroup }: GradeUpsertInput, ctx) => {
    const supabase = await createClient();
    const row = { institution_id: ctx.institution.id, code, display_name: displayName, sort_key: sortKey, grade_group: gradeGroup };
    const query = id
      ? supabase.from("grades").update(row).eq("id", id).eq("institution_id", ctx.institution.id)
      : supabase.from("grades").insert(row);
    const { data, error } = await query.select("id, code, display_name, sort_key, grade_group").maybeSingle();
    if (error) {
      if (isUniqueViolation(error)) {
        throw new AppError("conflict", "A grade with this code already exists.", { code: ["Code already in use."] });
      }
      throwMapped(error);
    }
    if (!data) throw new AppError("not_found", "Grade not found.");

    await audit(ctx, { action: "academics.grade.upsert", entityType: "grade", entityId: data.id });

    return { id: data.id, code: data.code, displayName: data.display_name, sortKey: data.sort_key, gradeGroup: data.grade_group };
  },
});

export const upsertSection = defineAction({
  name: "academics.section.upsert",
  schema: SectionUpsertSchema,
  permission: "academics.manage",
  handler: async ({ id, gradeId, academicYearId, name, capacity, classTeacherId }: SectionUpsertInput, ctx) => {
    const supabase = await createClient();
    const row = {
      institution_id: ctx.institution.id,
      grade_id: gradeId,
      academic_year_id: academicYearId,
      name,
      ...(capacity !== undefined ? { capacity } : {}),
      ...(classTeacherId !== undefined ? { class_teacher_id: classTeacherId } : {}),
    };
    const query = id
      ? supabase.from("class_sections").update(row).eq("id", id).eq("institution_id", ctx.institution.id)
      : supabase.from("class_sections").insert(row);
    const { data, error } = await query.select("id, grade_id, academic_year_id, name, capacity, class_teacher_id").maybeSingle();
    if (error) {
      if (isUniqueViolation(error)) {
        throw new AppError("conflict", "A section with this name already exists for this grade and year.", {
          name: ["Name already in use for this grade and year."],
        });
      }
      throwMapped(error);
    }
    if (!data) throw new AppError("not_found", "Class section not found.");

    await audit(ctx, { action: "academics.section.upsert", entityType: "class_section", entityId: data.id });

    return {
      id: data.id,
      gradeId: data.grade_id,
      academicYearId: data.academic_year_id,
      name: data.name,
      capacity: data.capacity,
      classTeacherId: data.class_teacher_id,
    };
  },
});

export const upsertSubject = defineAction({
  name: "academics.subject.upsert",
  schema: SubjectUpsertSchema,
  permission: "academics.manage",
  handler: async ({ id, code, name, kind }: SubjectUpsertInput, ctx) => {
    const supabase = await createClient();
    const row = { institution_id: ctx.institution.id, code, name, kind };
    const query = id
      ? supabase.from("subjects").update(row).eq("id", id).eq("institution_id", ctx.institution.id)
      : supabase.from("subjects").insert(row);
    const { data, error } = await query.select("id, code, name, kind").maybeSingle();
    if (error) {
      if (isUniqueViolation(error)) {
        throw new AppError("conflict", "A subject with this code already exists.", { code: ["Code already in use."] });
      }
      throwMapped(error);
    }
    if (!data) throw new AppError("not_found", "Subject not found.");

    await audit(ctx, { action: "academics.subject.upsert", entityType: "subject", entityId: data.id });

    return { id: data.id, code: data.code, name: data.name, kind: data.kind };
  },
});

export const setSubjectAssignment = defineAction({
  name: "academics.subjectAssignment.set",
  schema: SubjectAssignmentSetSchema,
  permission: "academics.manage",
  handler: async ({ classSectionId, subjectId, teacherId }: SubjectAssignmentSetInput, ctx) => {
    const supabase = await createClient();
    await assertInInstitution(supabase, "class_sections", classSectionId, ctx.institution.id, "Class section not found.");
    await assertInInstitution(supabase, "subjects", subjectId, ctx.institution.id, "Subject not found.");
    await assertInInstitution(supabase, "staff", teacherId, ctx.institution.id, "Teacher not found.");

    const { data, error } = await supabase
      .from("subject_assignments")
      .insert({ institution_id: ctx.institution.id, class_section_id: classSectionId, subject_id: subjectId, teacher_id: teacherId })
      .select("id, class_section_id, subject_id, teacher_id")
      .single();
    if (error) {
      if (isUniqueViolation(error)) {
        throw new AppError("conflict", "This subject is already assigned for this section.", {
          subjectId: ["Already assigned for this section."],
        });
      }
      throwMapped(error);
    }

    await audit(ctx, { action: "academics.subject_assignment.set", entityType: "subject_assignment", entityId: data.id });

    return { id: data.id, classSectionId: data.class_section_id, subjectId: data.subject_id, teacherId: data.teacher_id };
  },
});
