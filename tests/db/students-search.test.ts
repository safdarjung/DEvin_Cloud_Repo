import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { listStudents } from "@/modules/people/queries";
import { buildContext } from "../helpers/actions";
import { closeFactoriesHelper } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function insertStudent(institutionId: string, admissionNo: string, firstName: string, lastName: string | null): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, last_name, dob, gender)
    values (${institutionId}, ${admissionNo}, ${firstName}, ${lastName}, '2016-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

// Phase 2 review (MEDIUM): PostgREST's `.or()` filter splits on `,`/`()` —
// a raw ilike value containing those broke the filter and 500'd. Each case
// below both proves no crash AND that the value still matches correctly
// (the fix quotes the value, it doesn't strip the characters).
describe("listStudents search (T-028 phase 2 fix: quoteOrValue)", () => {
  it('a comma in the query ("Smith, John") does not 500 and matches a last name containing it', async () => {
    const inst = await createTestInstitution("students-search-comma");
    try {
      await insertStudent(inst.institutionId, "ADM-COMMA-1", "Riya", "Smith, John");
      await insertStudent(inst.institutionId, "ADM-COMMA-2", "Other", "Unrelated");

      const ctx = await buildContext(inst, "admin");
      setActingClient(inst.clientAs("admin"));
      const result = await listStudents(ctx, "Smith, John", 1);
      setActingClient(null);

      expect(result.students.map((s) => s.admissionNo)).toEqual(["ADM-COMMA-1"]);
    } finally {
      await inst.cleanup();
    }
  });

  it('parentheses in the query ("A(B)") do not 500 and match a first name containing them', async () => {
    const inst = await createTestInstitution("students-search-parens");
    try {
      await insertStudent(inst.institutionId, "ADM-PAREN-1", "A(B)", "Test");
      await insertStudent(inst.institutionId, "ADM-PAREN-2", "Unrelated", "Test");

      const ctx = await buildContext(inst, "admin");
      setActingClient(inst.clientAs("admin"));
      const result = await listStudents(ctx, "A(B)", 1);
      setActingClient(null);

      expect(result.students.map((s) => s.admissionNo)).toEqual(["ADM-PAREN-1"]);
    } finally {
      await inst.cleanup();
    }
  });

  it("a literal %/_ in the query matches only the exact admission no, not every row (ILIKE wildcard escape)", async () => {
    const inst = await createTestInstitution("students-search-wildcard");
    try {
      await insertStudent(inst.institutionId, "ADM_100%", "Exact", "Match");
      await insertStudent(inst.institutionId, "ADM-OTHER-1", "Should", "NotMatch");
      await insertStudent(inst.institutionId, "ADMX100Y", "AlsoShould", "NotMatch");

      const ctx = await buildContext(inst, "admin");
      setActingClient(inst.clientAs("admin"));
      const result = await listStudents(ctx, "ADM_100%", 1);
      setActingClient(null);

      expect(result.students.map((s) => s.admissionNo)).toEqual(["ADM_100%"]);
    } finally {
      await inst.cleanup();
    }
  });
});
