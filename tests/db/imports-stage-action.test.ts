import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mocks (T-022 lead review pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { stageImport } from "@/modules/imports/actions";
import { STUDENT_COLUMNS } from "@/modules/imports/schemas";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createGrade } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

// M04-T5 — data.import.stage. Row shape exactly as STUDENT_COLUMNS
// (schemas.ts); row_no = CSV line number, header = 1.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

function studentRow(overrides: Partial<Record<(typeof STUDENT_COLUMNS)[number], string>> = {}) {
  const base: Record<(typeof STUDENT_COLUMNS)[number], string> = {
    admission_no: `ADM-${crypto.randomUUID().slice(0, 8)}`,
    first_name: "Test",
    last_name: "",
    dob: "2015-01-01",
    gender: "male",
    grade: "VI",
    section: "A",
    roll_no: "",
    guardian_name: "Guardian",
    guardian_phone: "9800000001",
    guardian_email: "",
    guardian_relationship: "father",
  };
  return { ...base, ...overrides };
}

function toCsv(rows: Record<string, string>[]): string {
  const lines = [STUDENT_COLUMNS.join(",")];
  for (const row of rows) lines.push(STUDENT_COLUMNS.map((c) => row[c]).join(","));
  return lines.join("\n");
}

describe("data.import.stage action (M04-T5)", () => {
  it("admin stages a 10-row CSV: 2 bad rows reported with their CSV line numbers", async () => {
    const inst = await createTestInstitution("imports-stage-ok");
    const yearId = await createAcademicYear(inst.institutionId);
    const gradeId = await createGrade(inst.institutionId, { code: "VI" });
    await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });

    const rows = Array.from({ length: 10 }, () => studentRow());
    // rowNo = index + 2 (header is line 1): index 2 -> line 4, index 7 -> line 9.
    rows[2] = studentRow({ guardian_phone: "123" }); // zod failure
    rows[7] = studentRow({ section: "Z" }); // unknown section

    const csv = toCsv(rows);
    const result = await callAs(inst, "admin", stageImport, {
      entityType: "students",
      fileName: "students.csv",
      csv,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rowCount).toBe(10);
    expect(result.data.validCount).toBe(8);
    expect(result.data.errorCount).toBe(2);
    expect(result.data.errors).toHaveLength(2);
    expect(result.data.errors[0].rowNo).toBe(4);
    expect(result.data.errors[0].errors.guardian_phone).toBeDefined();
    expect(result.data.errors[1].rowNo).toBe(9);
    expect(result.data.errors[1].errors.section).toEqual(["not found"]);

    const [batchRow] = await sql`select row_count, valid_count, error_count from public.import_batches where id = ${result.data.batchId}`;
    expect(batchRow.row_count).toBe(10);
    expect(batchRow.valid_count).toBe(8);
    expect(batchRow.error_count).toBe(2);
  });

  it("a teacher is forbidden from staging an import", async () => {
    const inst = await createTestInstitution("imports-stage-forbidden");

    const result = await callAs(inst, "teacher", stageImport, {
      entityType: "students",
      fileName: "students.csv",
      csv: toCsv([studentRow()]),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("forbidden");
  });

  it("a CSV over 1 MB is rejected as validation_failed", async () => {
    const inst = await createTestInstitution("imports-stage-toolarge");

    const result = await callAs(inst, "admin", stageImport, {
      entityType: "students",
      fileName: "students.csv",
      csv: "a".repeat(1_048_577),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation_failed");
  });

  it("a CSV header missing a required column fails the whole stage, no batch row created", async () => {
    const inst = await createTestInstitution("imports-stage-missingcol");

    const headers = STUDENT_COLUMNS.filter((c) => c !== "guardian_phone");
    const csv = [headers.join(","), headers.map(() => "x").join(",")].join("\n");

    const result = await callAs(inst, "admin", stageImport, {
      entityType: "students",
      fileName: "students.csv",
      csv,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation_failed");
    expect(result.error.fieldErrors?.csv?.[0]).toMatch(/guardian_phone/);

    const [{ count }] = await sql`select count(*)::int from public.import_batches where institution_id = ${inst.institutionId}`;
    expect(count).toBe(0);
  });
});
