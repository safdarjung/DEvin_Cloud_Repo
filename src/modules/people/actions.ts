"use server";

// M03-T10 — department/staff setup actions (05 §2, 07 §2.2 staff.write).
// Upsert semantics mirror core/actions.ts's upsertAcademicYear (M03-T8):
// update when `id` is given (hidden/cross-institution row -> not_found),
// else insert. No PII (phone/email) in audit rows (CLAUDE.md rule 8 /
// brief) — ids and non-PII fields only.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import {
  DepartmentUpsertSchema,
  GuardianLinkSchema,
  GuardianUpdateSchema,
  StaffUpsertSchema,
  StudentUpdateSchema,
  type DepartmentUpsertInput,
  type GuardianLinkInput,
  type GuardianUpdateInput,
  type StaffUpsertInput,
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
