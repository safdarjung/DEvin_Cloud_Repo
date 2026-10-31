import type { SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/db/types";

// Opt-in mocks (T-022 lead review pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { commitImport, stageImport } from "@/modules/imports/actions";
import { getImportBatch } from "@/modules/imports/queries";
import { STUDENT_COLUMNS } from "@/modules/imports/schemas";
import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createGrade } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";

// M04-T6 — data.import.commit action + imports.getBatch query. Commit is a
// thin wrapper over the security-invoker `commit_import_batch` RPC (0066);
// its own role check and idempotency (recommit -> same stored counts, no
// new students) are already covered by tests/db/imports-commit.test.ts
// (T3) at the SQL layer — this file exercises the action/query wiring.
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

describe("data.import.commit action + imports.getBatch query (M04-T6)", () => {
  it("stages then commits; recommitting returns identical counts and doesn't duplicate students; getImportBatch hides row data", async () => {
    const inst = await createTestInstitution("imports-commit-ok");
    const yearId = await createAcademicYear(inst.institutionId);
    const gradeId = await createGrade(inst.institutionId, { code: "VI" });
    await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });

    const rows = [studentRow(), studentRow(), studentRow({ guardian_phone: "123" })];
    const staged = await callAs(inst, "admin", stageImport, {
      entityType: "students",
      fileName: "students.csv",
      csv: toCsv(rows),
    });
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;
    expect(staged.data.validCount).toBe(2);
    expect(staged.data.errorCount).toBe(1);

    const committed = await callAs(inst, "admin", commitImport, { batchId: staged.data.batchId });
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;
    expect(committed.data).toEqual({ committed: 2, skipped: 0, invalid: 1 });

    // createTestInstitution seeds one "student"-role student row (roles.ts),
    // so count against admission_no values this CSV actually staged.
    const admissionNos = [rows[0].admission_no, rows[1].admission_no];
    const [{ count: afterFirst }] =
      await sql`select count(*)::int from public.students where institution_id = ${inst.institutionId} and admission_no = any(${admissionNos})`;
    expect(afterFirst).toBe(2);

    const recommitted = await callAs(inst, "admin", commitImport, { batchId: staged.data.batchId });
    expect(recommitted.ok).toBe(true);
    if (!recommitted.ok) return;
    expect(recommitted.data).toEqual({ committed: 2, skipped: 0, invalid: 1 });

    const [{ count: afterSecond }] =
      await sql`select count(*)::int from public.students where institution_id = ${inst.institutionId} and admission_no = any(${admissionNos})`;
    expect(afterSecond).toBe(2);

    // getImportBatch is a plain query fn (not a defineAction); point the
    // opt-in mock at the admin's real client directly (dashboard-queries.test.ts
    // pattern) instead of going through callAs.
    const ctx = await buildContext(inst, "admin");
    setActingClient(inst.clientAs("admin") as unknown as SupabaseClient<Database>);
    let summary;
    try {
      summary = await getImportBatch(ctx, staged.data.batchId);
    } finally {
      setActingClient(null);
    }
    expect(summary.status).toBe("committed");
    expect(summary.committedCount).toBe(2);
    expect(summary.invalidRows).toHaveLength(1);
    expect(summary.invalidRows[0].errors?.guardian_phone).toBeDefined();
    expect(Object.keys(summary.invalidRows[0])).toEqual(["rowNo", "errors"]);
  });

  it("an accountant is forbidden from committing a batch", async () => {
    const inst = await createTestInstitution("imports-commit-forbidden");

    const commitResult = await callAs(inst, "accountant", commitImport, { batchId: crypto.randomUUID() });
    expect(commitResult.ok).toBe(false);
    if (!commitResult.ok) expect(commitResult.error.code).toBe("forbidden");
  });
});
