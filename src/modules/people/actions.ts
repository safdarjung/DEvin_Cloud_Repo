"use server";

// M03-T10 — department/staff setup actions (05 §2, 07 §2.2 staff.write).
// Upsert semantics mirror core/actions.ts's upsertAcademicYear (M03-T8):
// update when `id` is given (hidden/cross-institution row -> not_found),
// else insert. No PII (phone/email) in audit rows (CLAUDE.md rule 8 /
// brief) — ids and non-PII fields only.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { listStudents } from "@/modules/people/queries";
import {
  DepartmentUpsertSchema,
  GuardianLinkSchema,
  GuardianUpdateSchema,
  SaveQualificationRulesSchema,
  SaveTeacherProfileSchema,
  StaffUpsertSchema,
  StudentSearchSchema,
  StudentUpdateSchema,
  type DepartmentUpsertInput,
  type SaveQualificationRulesInput,
  type SaveTeacherProfileInput,
  type GuardianLinkInput,
  type GuardianUpdateInput,
  type StaffUpsertInput,
  type StudentSearchInput,
  type StudentUpdateInput,
} from "@/modules/people/schemas";

const POSTGRES_UNIQUE_VIOLATION = "23505";
const POSTGRES_RLS_VIOLATION = "42501";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === POSTGRES_UNIQUE_VIOLATION);
}

function isRlsViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === POSTGRES_RLS_VIOLATION);
}

export const upsertDepartment = defineAction({
  name: "people.department.upsert",
  module: "people",
  schema: DepartmentUpsertSchema,
  permission: "staff.write",
  handler: async ({ id, name }: DepartmentUpsertInput, ctx) => {
    const supabase = await createClient();
    const row = { institution_id: ctx.institution.id, name };
    const query = id
      ? supabase.from("departments").update(row).eq("id", id).eq("institution_id", ctx.institution.id)
      : supabase.from("departments").insert(row);
    const { data, error } = await query.select("id, name").maybeSingle();
    if (error) {
      if (isUniqueViolation(error)) {
        throw new AppError("conflict", "A department with this name already exists.", { name: ["Name already in use."] });
      }
      throwMapped(error);
    }
    if (!data) throw new AppError("not_found", "Department not found.");

    await audit(ctx, { action: "people.department.upsert", entityType: "department", entityId: data.id });

    return { id: data.id, name: data.name };
  },
});

export const upsertStaff = defineAction({
  name: "people.staff.upsert",
  module: "people",
  schema: StaffUpsertSchema,
  permission: "staff.write",
  handler: async (
    { id, employeeNo, fullName, designation, departmentId, phone, email, isTeaching, status }: StaffUpsertInput,
    ctx,
  ) => {
    const supabase = await createClient();
    const row = {
      institution_id: ctx.institution.id,
      employee_no: employeeNo,
      full_name: fullName,
      designation,
      ...(departmentId !== undefined ? { department_id: departmentId } : {}),
      ...(phone !== undefined ? { phone } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(isTeaching !== undefined ? { is_teaching: isTeaching } : {}),
      ...(status !== undefined ? { status } : {}),
    };
    const query = id
      ? supabase.from("staff").update(row).eq("id", id).eq("institution_id", ctx.institution.id)
      : supabase.from("staff").insert(row);
    const { data, error } = await query.select("id, employee_no, full_name, designation, department_id, is_teaching, status").maybeSingle();
    if (error) {
      if (isUniqueViolation(error)) {
        throw new AppError("conflict", "A staff member with this employee number already exists.", {
          employeeNo: ["Employee number already in use."],
        });
      }
      throwMapped(error);
    }
    if (!data) throw new AppError("not_found", "Staff member not found.");

    // No phone/email in the audit row (CLAUDE.md rule, brief) — ids and
    // non-PII fields only.
    await audit(ctx, {
      action: "people.staff.upsert",
      entityType: "staff",
      entityId: data.id,
      after: { designation: data.designation, isTeaching: data.is_teaching, status: data.status },
    });

    return {
      id: data.id,
      employeeNo: data.employee_no,
      fullName: data.full_name,
      designation: data.designation,
      departmentId: data.department_id,
      isTeaching: data.is_teaching,
      status: data.status,
    };
  },
});

// M14-T7 — people.student.update / people.guardian.update / people.guardian.link
// (rulings: plain RLS updates, invoker, same shape as upsertStaff above;
// link_guardian is a thin RPC wrapper, same style as timetable/actions.ts's
// publishVersion). Never touches status/user_id/details/photo_path. Audit
// rows hold changed field names only — no values (lesson 10 / brief).

/** Picker lookup: first page (50) of active students matching a name or admission no. RLS scopes the rows. */
export const searchStudentOptions = defineAction({
  name: "people.student.search",
  module: "people",
  schema: StudentSearchSchema,
  permission: "student.read",
  handler: async ({ q }: StudentSearchInput, ctx) => {
    const { students } = await listStudents(ctx, q, 1, { status: "active" });
    return students.map((s) => ({
      id: s.id,
      label: `${[s.firstName, s.lastName].filter(Boolean).join(" ")} (${s.admissionNo}${s.sectionName ? `, ${s.gradeName ?? ""}-${s.sectionName}` : ""})`,
    }));
  },
});

export const updateStudent = defineAction({
  name: "people.student.update",
  module: "people",
  schema: StudentUpdateSchema,
  permission: "student.write",
  handler: async ({ studentId, firstName, lastName, dob, gender, admissionNo }: StudentUpdateInput, ctx) => {
    const supabase = await createClient();
    const row = {
      ...(firstName !== undefined ? { first_name: firstName } : {}),
      ...(lastName !== undefined ? { last_name: lastName } : {}),
      ...(dob !== undefined ? { dob } : {}),
      ...(gender !== undefined ? { gender } : {}),
      ...(admissionNo !== undefined ? { admission_no: admissionNo } : {}),
    };
    const { data, error } = await supabase
      .from("students")
      .update(row)
      .eq("id", studentId)
      .eq("institution_id", ctx.institution.id)
      .select("id, admission_no, first_name, last_name, dob, gender")
      .maybeSingle();
    if (error) {
      if (isUniqueViolation(error)) {
        throw new AppError("conflict", "A student with this admission number already exists.", {
          admissionNo: ["Admission number already in use."],
        });
      }
      if (isRlsViolation(error)) throw new AppError("forbidden", "You do not have access to this student.");
      throwMapped(error);
    }
    if (!data) throw new AppError("not_found", "Student not found.");

    await audit(ctx, {
      action: "people.student.update",
      entityType: "student",
      entityId: data.id,
      after: { changedFields: Object.keys(row) },
    });

    return {
      id: data.id,
      admissionNo: data.admission_no,
      firstName: data.first_name,
      lastName: data.last_name,
      dob: data.dob,
      gender: data.gender,
    };
  },
});

export const updateGuardian = defineAction({
  name: "people.guardian.update",
  module: "people",
  schema: GuardianUpdateSchema,
  permission: "student.write",
  handler: async ({ guardianId, fullName, phone, email }: GuardianUpdateInput, ctx) => {
    const supabase = await createClient();
    const row = {
      ...(fullName !== undefined ? { full_name: fullName } : {}),
      ...(phone !== undefined ? { phone } : {}),
      ...(email !== undefined ? { email } : {}),
    };
    const { data, error } = await supabase
      .from("guardians")
      .update(row)
      .eq("id", guardianId)
      .eq("institution_id", ctx.institution.id)
      .select("id, full_name, phone, email")
      .maybeSingle();
    if (error) {
      if (isUniqueViolation(error)) {
        throw new AppError("conflict", "A guardian with this phone number already exists.", {
          phone: ["Phone number already in use."],
        });
      }
      if (isRlsViolation(error)) throw new AppError("forbidden", "You do not have access to this guardian.");
      throwMapped(error);
    }
    if (!data) throw new AppError("not_found", "Guardian not found.");

    await audit(ctx, {
      action: "people.guardian.update",
      entityType: "guardian",
      entityId: data.id,
      after: { changedFields: Object.keys(row) },
    });

    return { id: data.id, fullName: data.full_name, phone: data.phone, email: data.email };
  },
});

export const linkGuardian = defineAction({
  name: "people.guardian.link",
  module: "people",
  schema: GuardianLinkSchema,
  permission: "student.write",
  handler: async ({ studentId, relationship, isPrimary, guardianId, guardian }: GuardianLinkInput) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("link_guardian", {
      p_student_id: studentId,
      p_relationship: relationship,
      p_is_primary: isPrimary ?? false,
      p_guardian_id: guardianId,
      p_full_name: guardian?.fullName,
      p_phone: guardian?.phone,
      p_email: guardian?.email,
    });
    if (error) throwMapped(error);
    const result = data as { guardian_id: string; created: boolean };

    return { guardianId: result.guardian_id, created: result.created };
  },
});

// 0155: a staff member saves their own teaching profile (the first sign-in form). leave.request is held
// by every staff role and by no student or guardian; save_own_teacher_profile only ever writes the
// caller's own staff row (found through their membership).
export const saveOwnTeacherProfile = defineAction({
  name: "people.teacherProfile.saveOwn",
  schema: SaveTeacherProfileSchema,
  module: "core",
  permission: "leave.request",
  handler: async (input: SaveTeacherProfileInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("save_own_teacher_profile", {
      p_institution_id: ctx.institution.id,
      p_qualifications: input.qualifications,
      p_subject_ids: input.subjectIds,
      p_grade_ids: input.gradeIds,
      // null clears it; generated RPC arg types cannot say an argument may be null.
      p_experience_years: input.experienceYears as number,
    });
    if (error) throwMapped(error);
    const saved = data as { staff_id: string; highest_qualification: string | null };
    await audit(ctx, { action: "people.teacher_profile.saved", entityType: "staff", entityId: saved.staff_id, metadata: { highest: saved.highest_qualification } });
    revalidatePath(`/${ctx.institution.slug}`, "layout");
    return saved;
  },
});

// 0155: the school's rule for the highest class each qualification level may teach.
export const saveQualificationRules = defineAction({
  name: "people.qualificationRules.save",
  schema: SaveQualificationRulesSchema,
  module: "core",
  permission: "institution.settings.manage",
  handler: async ({ maxGradeByLevel }: SaveQualificationRulesInput, ctx) => {
    const supabase = await createClient();
    const { data: grades, error: gradesError } = await supabase.from("grades").select("code").eq("institution_id", ctx.institution.id);
    if (gradesError) throwMapped(gradesError);
    const known = new Set((grades ?? []).map((g) => g.code));
    const unknown = Object.values(maxGradeByLevel).filter((code) => !known.has(code));
    if (unknown.length) throw new AppError("validation_failed", `This school has no class ${unknown.join(", ")}.`);
    const { error } = await supabase.rpc("patch_institution_settings", { p_institution_id: ctx.institution.id, p_patch: { staff: { max_grade_by_level: maxGradeByLevel } } });
    if (error) throwMapped(error);
    await audit(ctx, { action: "people.qualification_rules.saved", entityType: "institution", entityId: ctx.institution.id, metadata: { maxGradeByLevel } });
    revalidatePath(`/${ctx.institution.slug}/staff/qualifications`);
    return { maxGradeByLevel };
  },
});
