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
  StaffUpsertSchema,
  type DepartmentUpsertInput,
  type StaffUpsertInput,
} from "@/modules/people/schemas";

const POSTGRES_UNIQUE_VIOLATION = "23505";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === POSTGRES_UNIQUE_VIOLATION);
}

export const upsertDepartment = defineAction({
  name: "people.department.upsert",
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
