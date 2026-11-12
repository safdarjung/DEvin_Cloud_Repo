// Curveball sweep (imports): parallel commits of one batch, another school's batch, duplicate admission numbers, Zod edges.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { commitImport, stageImport } from "@/modules/imports/actions";
import { STUDENT_COLUMNS } from "@/modules/imports/schemas";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createGrade } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
let a: TestInstitution;
let b: TestInstitution;

function row(overrides: Partial<Record<(typeof STUDENT_COLUMNS)[number], string>> = {}) {
  return {
    admission_no: `ICB-${crypto.randomUUID().slice(0, 8)}`,
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
    ...overrides,
  } as Record<string, string>;
}
const csv = (rows: Record<string, string>[]) => [STUDENT_COLUMNS.join(","), ...rows.map((r) => STUDENT_COLUMNS.map((c) => r[c]).join(","))].join("\n");
async function setup(inst: TestInstitution): Promise<void> {
  const yearId = await createAcademicYear(inst.institutionId);
  await createClassSection(inst.institutionId, await createGrade(inst.institutionId, { code: "VI" }), yearId, { name: "A" });
}
async function stage(inst: TestInstitution, rows: Record<string, string>[]): Promise<string> {
  const r = await callAs(inst, "admin", stageImport, { entityType: "students", fileName: "s.csv", csv: csv(rows) });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.data.batchId;
}
async function countAdm(inst: TestInstitution, nos: string[]): Promise<number> {
  const [c] = await sql`select count(*)::int as n from public.students where institution_id = ${inst.institutionId} and admission_no = any(${nos})`;
  return c.n as number;
}

beforeAll(async () => {
  a = await createTestInstitution("imp-cb");
  b = await createTestInstitution("imp-cb-x");
  await setup(a);
  await setup(b);
}, 60_000);

afterAll(async () => {
  await a?.cleanup();
  await b?.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

describe("imports curveballs", () => {
  it("three parallel commits of one batch create each student exactly once", async () => {
    const rows = [row(), row(), row()];
    const batchId = await stage(a, rows);
    const rs = await Promise.all([1, 2, 3].map(() => callAs(a, "admin", commitImport, { batchId })));
    expect(rs.map((r) => (r.ok ? "ok" : r.error.code))).not.toContain("internal");
    expect(await countAdm(a, rows.map((r) => r.admission_no))).toBe(3);
  });

  it("another school's batch → not_found (or forbidden); nothing is created in either school", async () => {
    const rows = [row()];
    const theirs = await stage(b, rows);
    const r = await callAs(a, "admin", commitImport, { batchId: theirs });
    expect(r.ok).toBe(false);
    expect(r.ok ? null : ["not_found", "forbidden"]).toContain(r.ok ? "" : r.error.code);
    expect(await countAdm(a, [rows[0].admission_no])).toBe(0);
    expect(await countAdm(b, [rows[0].admission_no])).toBe(0);
  });

  it("the same admission number twice in one file is not imported twice", async () => {
    const dup = row();
    const batchId = await stage(a, [dup, { ...dup, first_name: "Twin" }]);
    const r = await callAs(a, "admin", commitImport, { batchId });
    expect(r.ok ? null : r.error.code).not.toBe("internal");
    expect(await countAdm(a, [dup.admission_no])).toBe(1);
  });

  it("an admission number that already exists in the school is skipped, not duplicated", async () => {
    const first = row();
    const r1 = await callAs(a, "admin", commitImport, { batchId: await stage(a, [first]) });
    expect(r1.ok).toBe(true);
    const r2 = await callAs(a, "admin", commitImport, { batchId: await stage(a, [{ ...first, first_name: "Again" }]) });
    expect(r2.ok ? null : r2.error.code).not.toBe("internal");
    expect(await countAdm(a, [first.admission_no])).toBe(1);
  });

  it("unknown batch → not_found; non-uuid batch / unknown entity type → validation_failed", async () => {
    const unknown = await callAs(a, "admin", commitImport, { batchId: crypto.randomUUID() });
    expect(unknown.ok ? null : unknown.error.code).toBe("not_found");
    const bad = await callAs(a, "admin", commitImport, { batchId: "batch-1" });
    expect(bad.ok ? null : bad.error.fieldErrors?.batchId).toBeTruthy();
    const kind = await callAs(a, "admin", stageImport, { entityType: "teachers", fileName: "t.csv", csv: "a,b" });
    expect(kind.ok ? null : kind.error.fieldErrors?.entityType).toBeTruthy();
  });
});
