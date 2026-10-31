// M04-T8 — acceptance: the 3-day onboarding path end to end over real HTTP
// (actions + query routes), real bearer tokens, real Supabase/RLS. Mirrors
// api-actions-route.test.ts / api-query-route.test.ts: @/lib/supabase/server
// is NOT mocked.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { POST as actionsPost } from "@/app/api/v1/actions/[name]/route";
import { GET as queryGet } from "@/app/api/v1/query/[name]/route";
import { STAFF_COLUMNS, STUDENT_COLUMNS } from "@/modules/imports/schemas";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createGrade } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

const ROW_COUNT = 200;
// 0-indexed positions of the 5 deliberately bad rows; rowNo (CSV line) =
// index + 2 (header is line 1).
const BAD_PHONE_INDEX = 9; // rowNo 11
const BAD_DOB_INDEX = 49; // rowNo 51
const UNKNOWN_SECTION_INDEX = 99; // rowNo 101
const MISSING_FIRST_NAME_INDEX = 149; // rowNo 151
const DUPLICATE_ADMISSION_NO_INDEX = 179; // rowNo 181

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

function studentRow(index: number): Record<(typeof STUDENT_COLUMNS)[number], string> {
  return {
    admission_no: `ADM-${pad3(index + 1)}`,
    first_name: "Student",
    last_name: "",
    dob: "2016-04-12",
    gender: "male",
    grade: "VI",
    section: "A",
    roll_no: "",
    guardian_name: "Guardian",
    guardian_phone: String(9_800_000_001 + index),
    guardian_email: "",
    guardian_relationship: "father",
  };
}

function buildCsv(): { csv: string; admissionNos: string[] } {
  const rows = Array.from({ length: ROW_COUNT }, (_, i) => studentRow(i));

  rows[BAD_PHONE_INDEX] = { ...rows[BAD_PHONE_INDEX], guardian_phone: "123" };
  rows[BAD_DOB_INDEX] = { ...rows[BAD_DOB_INDEX], dob: "not-a-date" };
  rows[UNKNOWN_SECTION_INDEX] = { ...rows[UNKNOWN_SECTION_INDEX], section: "ZZ" };
  rows[MISSING_FIRST_NAME_INDEX] = { ...rows[MISSING_FIRST_NAME_INDEX], first_name: "" };
  // Duplicate admission_no within the file — second occurrence is invalid,
  // the first (index 0) stays valid.
  rows[DUPLICATE_ADMISSION_NO_INDEX] = { ...rows[DUPLICATE_ADMISSION_NO_INDEX], admission_no: rows[0].admission_no };

  const lines = [STUDENT_COLUMNS.join(",")];
  for (const row of rows) lines.push(STUDENT_COLUMNS.map((c) => row[c]).join(","));
  const admissionNos = rows.map((r) => r.admission_no);
  return { csv: lines.join("\n"), admissionNos };
}

function actionRequest(name: string, body: unknown, headers: Record<string, string>): Request {
  return new Request(`http://localhost/api/v1/actions/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function dispatchAction(name: string, body: unknown, headers: Record<string, string>): Promise<Response> {
  return actionsPost(actionRequest(name, body, headers), { params: Promise.resolve({ name }) });
}

function queryUrl(name: string, institution: string, input: unknown, format?: string): URL {
  const url = new URL(`http://localhost/api/v1/query/${name}`);
  url.searchParams.set("institution", institution);
  url.searchParams.set("input", JSON.stringify(input));
  if (format) url.searchParams.set("format", format);
  return url;
}

async function tokenFor(inst: TestInstitution, role: "admin"): Promise<string> {
  const { data, error } = await inst.clientAs(role).auth.getSession();
  if (error || !data.session) throw error ?? new Error(`no session for ${role}`);
  return data.session.access_token;
}

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

describe("M04 onboarding acceptance: CSV import + export", () => {
  it("stages a 200-row CSV (5 bad rows at known lines), commits, recommits idempotently, exports CSV", async () => {
    const inst = await createTestInstitution("imports-acceptance");
    const yearId = await createAcademicYear(inst.institutionId);
    const gradeId = await createGrade(inst.institutionId, { code: "VI" });
    await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
    const token = await tokenFor(inst, "admin");
    const auth = { authorization: `Bearer ${token}` };

    const { csv, admissionNos } = buildCsv();

    const stageRes = await dispatchAction(
      "data.import.stage",
      { institution: inst.slug, input: { entityType: "students", fileName: "students.csv", csv } },
      auth,
    );
    expect(stageRes.status).toBe(200);
    const stageBody = await stageRes.json();
    expect(stageBody.ok).toBe(true);
    expect(stageBody.data.validCount).toBe(195);
    expect(stageBody.data.errorCount).toBe(5);
    const badRowNos = stageBody.data.errors.map((e: { rowNo: number }) => e.rowNo).sort((a: number, b: number) => a - b);
    expect(badRowNos).toEqual([11, 51, 101, 151, 181]);

    const batchId = stageBody.data.batchId as string;

    const commitRes = await dispatchAction("data.import.commit", { institution: inst.slug, input: { batchId } }, auth);
    expect(commitRes.status).toBe(200);
    const commitBody = await commitRes.json();
    expect(commitBody.ok).toBe(true);
    expect(commitBody.data).toEqual({ committed: 195, skipped: 0, invalid: 5 });

    const [{ count: afterFirst }] =
      await sql`select count(*)::int from public.students where institution_id = ${inst.institutionId} and admission_no = any(${admissionNos})`;
    expect(afterFirst).toBe(195);

    const recommitRes = await dispatchAction("data.import.commit", { institution: inst.slug, input: { batchId } }, auth);
    const recommitBody = await recommitRes.json();
    expect(recommitBody.data).toEqual({ committed: 195, skipped: 0, invalid: 5 });

    const [{ count: afterSecond }] =
      await sql`select count(*)::int from public.students where institution_id = ${inst.institutionId} and admission_no = any(${admissionNos})`;
    expect(afterSecond).toBe(195);

    // people.listStudents?format=csv -> CSV containing a committed admission_no.
    // Page 1, ordered by admission_no ascending: "ADM-001" (committed, the
    // first occurrence of the duplicate) sorts at or near the top regardless
    // of the roles-fixture's randomly-named seed student.
    const exportRes = await queryGet(
      new Request(queryUrl("people.listStudents", inst.slug, { page: 1 }, "csv"), { headers: auth }),
      { params: Promise.resolve({ name: "people.listStudents" }) },
    );
    expect(exportRes.status).toBe(200);
    expect(exportRes.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    const csvBody = await exportRes.text();
    expect(csvBody).toContain("ADM-001");
  });

  it("template headers equal the schema column constants", () => {
    const studentsTemplate = readFileSync(join(process.cwd(), "public/templates/students.csv"), "utf8");
    const staffTemplate = readFileSync(join(process.cwd(), "public/templates/staff.csv"), "utf8");

    expect(studentsTemplate.split("\n")[0]).toBe(STUDENT_COLUMNS.join(","));
    expect(staffTemplate.split("\n")[0]).toBe(STAFF_COLUMNS.join(","));
  });
});
