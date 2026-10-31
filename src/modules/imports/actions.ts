"use server";

// M04-T5/T6 — data.import.stage / data.import.commit (06 brief M04, 07
// §2.2 data.import). Stage: parse+validate CSV rows, resolve student
// grade/section (grades.code + class_sections.name, current academic
// year) or staff department (departments.name) to ids with ONE lookup
// query, insert the batch + rows. Commit: thin wrapper over the
// security-invoker `commit_import_batch` RPC (0066), which does its own
// role check and audit (counts only) — same shape as exams/actions.ts's
// close_marks_entry/enter_marks wrappers, no second audit() call here.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import type { Json } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";
import {
  CommitImportSchema,
  STAFF_COLUMNS,
  STUDENT_COLUMNS,
  StaffImportRowSchema,
  StageImportSchema,
  StudentImportRowSchema,
  parseCsv,
  type CommitImportInput,
  type StageImportInput,
  type StaffImportRowInput,
  type StudentImportRowInput,
} from "@/modules/imports/schemas";

type ImportsClient = Awaited<ReturnType<typeof createClient>>;

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

const CHUNK_SIZE = 500;
const MAX_REPORTED_ERRORS = 50;

type FieldErrors = Record<string, string[]>;

interface StagedRow {
  rowNo: number;
  status: "valid" | "invalid";
  data: Record<string, unknown>;
  errors?: FieldErrors;
}

function mergeFieldError(errors: FieldErrors | undefined, field: string, message: string): FieldErrors {
  const out: FieldErrors = { ...errors };
  out[field] = [...(out[field] ?? []), message];
  return out;
}

function missingColumns(headers: string[], required: readonly string[]): string[] {
  const have = new Set(headers);
  return required.filter((column) => !have.has(column));
}

async function loadCurrentSections(
  supabase: ImportsClient,
  institutionId: string,
): Promise<Map<string, { classSectionId: string; academicYearId: string }>> {
  // ONE query: current-year class sections joined to their grade code
  // (mirrors exams/queries.ts's `academic_years!inner(is_current)` pattern).
  const { data, error } = await supabase
    .from("class_sections")
    .select("id, academic_year_id, name, grades!inner(code), academic_years!inner(is_current)")
    .eq("institution_id", institutionId)
    .eq("academic_years.is_current", true);
  if (error) throwMapped(error);

  const map = new Map<string, { classSectionId: string; academicYearId: string }>();
  for (const row of data ?? []) {
    const grade = row.grades as unknown as { code: string } | null;
    if (!grade) continue;
    map.set(`${grade.code}|${row.name}`, { classSectionId: row.id, academicYearId: row.academic_year_id });
  }
  return map;
}

async function loadDepartments(supabase: ImportsClient, institutionId: string): Promise<Map<string, string>> {
  const { data, error } = await supabase.from("departments").select("id, name").eq("institution_id", institutionId);
  if (error) throwMapped(error);
  return new Map((data ?? []).map((d) => [d.name, d.id] as const));
}

export const stageImport = defineAction({
  name: "data.import.stage",
  schema: StageImportSchema,
  permission: "data.import",
  handler: async ({ entityType, fileName, csv }: StageImportInput, ctx) => {
    const { headers, rows } = parseCsv(csv);

    const required = entityType === "students" ? STUDENT_COLUMNS : STAFF_COLUMNS;
    const missing = missingColumns(headers, required);
    if (missing.length > 0) {
      throw new AppError("validation_failed", "CSV is missing required columns.", {
        csv: [`missing columns: ${missing.join(", ")}`],
      });
    }

    const supabase = await createClient();
    const rowSchema = entityType === "students" ? StudentImportRowSchema : StaffImportRowSchema;
    const sectionMap = entityType === "students" ? await loadCurrentSections(supabase, ctx.institution.id) : null;
    const departmentMap = entityType === "staff" ? await loadDepartments(supabase, ctx.institution.id) : null;

    const seenKeys = new Set<string>();
    const staged: StagedRow[] = rows.map((raw, index) => {
      const rowNo = index + 2; // header is CSV line 1
      const parsed = rowSchema.safeParse(raw);
      if (!parsed.success) {
        return { rowNo, status: "invalid", data: {}, errors: parsed.error.flatten().fieldErrors as FieldErrors };
      }

      let errors: FieldErrors | undefined;

      if (entityType === "students") {
        const row = parsed.data as StudentImportRowInput;
        if (seenKeys.has(row.admission_no)) errors = mergeFieldError(errors, "admission_no", "duplicate in file");
        seenKeys.add(row.admission_no);

        const section = sectionMap?.get(`${row.grade}|${row.section}`);
        if (!section) errors = mergeFieldError(errors, "section", "not found");

        const data = {
          admission_no: row.admission_no,
          first_name: row.first_name,
          last_name: row.last_name ?? null,
          dob: row.dob,
          gender: row.gender,
          class_section_id: section?.classSectionId ?? null,
          academic_year_id: section?.academicYearId ?? null,
          roll_no: row.roll_no ?? null,
          guardian_name: row.guardian_name,
          guardian_phone: row.guardian_phone,
          guardian_email: row.guardian_email ?? null,
          guardian_relationship: row.guardian_relationship,
        };
        return { rowNo, status: errors ? "invalid" : "valid", data, errors };
      }

      const row = parsed.data as StaffImportRowInput;
      if (seenKeys.has(row.employee_no)) errors = mergeFieldError(errors, "employee_no", "duplicate in file");
      seenKeys.add(row.employee_no);

      let departmentId: string | null = null;
      if (row.department) {
        const id = departmentMap?.get(row.department);
        if (!id) {
          errors = mergeFieldError(errors, "department", "not found");
        } else {
          departmentId = id;
        }
      }

      const data = {
        employee_no: row.employee_no,
        full_name: row.full_name,
        designation: row.designation,
        department_id: departmentId,
        phone: row.phone ?? null,
        email: row.email ?? null,
        is_teaching: row.is_teaching,
      };
      return { rowNo, status: errors ? "invalid" : "valid", data, errors };
    });

    const validCount = staged.filter((row) => row.status === "valid").length;
    const errorCount = staged.length - validCount;

    const { data: batch, error: batchError } = await supabase
      .from("import_batches")
      .insert({
        institution_id: ctx.institution.id,
        entity_type: entityType,
        file_name: fileName,
        row_count: staged.length,
        valid_count: validCount,
        error_count: errorCount,
        created_by: ctx.user.id,
      })
      .select("id")
      .single();
    if (batchError) throwMapped(batchError);

    for (let i = 0; i < staged.length; i += CHUNK_SIZE) {
      const chunk = staged.slice(i, i + CHUNK_SIZE).map((row) => ({
        batch_id: batch.id,
        institution_id: ctx.institution.id,
        row_no: row.rowNo,
        data: row.data as NonNullable<Json>,
        status: row.status,
        errors: row.errors ?? null,
      }));
      const { error: rowsError } = await supabase.from("import_rows").insert(chunk);
      if (rowsError) throwMapped(rowsError);
    }

    await audit(ctx, {
      action: "data.import.stage",
      entityType: "import_batch",
      entityId: batch.id,
      after: { rowCount: staged.length, validCount, errorCount },
    });

    return {
      batchId: batch.id as string,
      rowCount: staged.length,
      validCount,
      errorCount,
      errors: staged
        .filter((row) => row.status === "invalid")
        .slice(0, MAX_REPORTED_ERRORS)
        .map((row) => ({ rowNo: row.rowNo, errors: row.errors ?? {} })),
    };
  },
});

export const commitImport = defineAction({
  name: "data.import.commit",
  schema: CommitImportSchema,
  permission: "data.import",
  handler: async ({ batchId }: CommitImportInput) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("commit_import_batch", { p_batch_id: batchId });
    if (error) throwMapped(error);
    return data as { committed: number; skipped: number; invalid: number };
  },
});
