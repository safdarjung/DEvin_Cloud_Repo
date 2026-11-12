// Curveball sweep (forms): action-level coverage for update/publish/close/respond — status machine, atomicity of
// updateForm, cross-tenant ids, Zod fieldErrors, double answers.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { closeForm, createForm, publishForm, respondToForm, updateForm } from "@/modules/forms/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createEnrolment, createGrade } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const FIELDS = [
  { type: "consent", label: "I agree to the trip", required: true },
  { type: "choice", label: "Meal", options: ["Veg", "Non-veg"], required: true },
];
const GOOD = [true, 1];

let a: TestInstitution;
let b: TestInstitution;
let sectionA: string;
let sectionA2: string;
let foreignSection: string;
let childId: string;

beforeAll(async () => {
  a = await createTestInstitution("forms-cb");
  b = await createTestInstitution("forms-cb-x");
  const yearId = await createAcademicYear(a.institutionId);
  const gradeId = await createGrade(a.institutionId, { code: "VI" });
  sectionA = await createClassSection(a.institutionId, gradeId, yearId, { name: "A" });
  sectionA2 = await createClassSection(a.institutionId, gradeId, yearId, { name: "B" });
  const [s] = await sql`select student_id from public.memberships where institution_id = ${a.institutionId} and role = 'student'`;
  const [g] = await sql`select guardian_id from public.memberships where institution_id = ${a.institutionId} and role = 'guardian'`;
  childId = s.student_id as string;
  await createEnrolment(a.institutionId, childId, sectionA, yearId, { status: "active" });
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${a.institutionId}, ${g.guardian_id}, ${childId}, 'father', true, true)`;
  const by = await createAcademicYear(b.institutionId);
  foreignSection = await createClassSection(b.institutionId, await createGrade(b.institutionId, { code: "VI" }), by, { name: "A" });
}, 60_000);

afterAll(async () => {
  await a?.cleanup();
  await b?.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function draft(sections = [sectionA]): Promise<string> {
  const r = await callAs(a, "admin", createForm, { title: "Trip consent", fields: FIELDS, classSectionIds: sections });
  if (!r.ok) throw new Error(`createForm: ${r.error.code}`);
  return r.data.id;
}
async function sectionsOf(formId: string): Promise<string[]> {
  const rows = await sql`select class_section_id from public.form_sections where form_id = ${formId} order by class_section_id`;
  return rows.map((r) => r.class_section_id as string);
}

describe("forms status machine", () => {
  it("publish with no audience section → invalid_state", async () => {
    const id = await draft([]);
    const r = await callAs(a, "admin", publishForm, { formId: id });
    expect(r.ok ? null : r.error.code).toBe("invalid_state");
  });

  it("closing a draft, re-publishing a closed form and publishing twice are all refused (invalid_state)", async () => {
    const id = await draft();
    const closeDraft = await callAs(a, "admin", closeForm, { formId: id });
    expect(closeDraft.ok ? null : closeDraft.error.code).toBe("invalid_state");
    expect((await callAs(a, "admin", publishForm, { formId: id })).ok).toBe(true);
    const twice = await callAs(a, "principal", publishForm, { formId: id });
    expect(twice.ok ? null : twice.error.code).toBe("invalid_state");
    expect((await callAs(a, "admin", closeForm, { formId: id })).ok).toBe(true);
    const reopen = await callAs(a, "admin", publishForm, { formId: id });
    expect(reopen.ok ? null : reopen.error.code).toBe("invalid_state");
    const [row] = await sql`select status from public.forms where id = ${id}`;
    expect(row.status).toBe("closed");
  });

  it("another school's form: update/publish/close → not_found", async () => {
    const r = await callAs(b, "admin", createForm, { title: "Theirs", fields: FIELDS, classSectionIds: [foreignSection] });
    if (!r.ok) throw new Error(r.error.code);
    const u = await callAs(a, "admin", updateForm, { formId: r.data.id, title: "Mine", fields: FIELDS, classSectionIds: [] });
    const p = await callAs(a, "admin", publishForm, { formId: r.data.id });
    const c = await callAs(a, "admin", closeForm, { formId: r.data.id });
    expect([u, p, c].map((x) => (x.ok ? "ok" : x.error.code))).toEqual(["not_found", "not_found", "not_found"]);
  });

  it("teacher, accountant and guardian cannot create/update/publish/close", async () => {
    const id = await draft();
    for (const role of ["teacher", "accountant", "guardian"] as const) {
      const rs = [
        await callAs(a, role, createForm, { title: "X", fields: FIELDS, classSectionIds: [] }),
        await callAs(a, role, updateForm, { formId: id, title: "X", fields: FIELDS, classSectionIds: [] }),
        await callAs(a, role, publishForm, { formId: id }),
        await callAs(a, role, closeForm, { formId: id }),
      ];
      expect(rs.map((r) => (r.ok ? "ok" : r.error.code))).toEqual(Array(4).fill("forbidden"));
    }
  });
});

describe("updateForm atomicity", () => {
  it("editing a published form is refused and leaves title, fields and sections unchanged", async () => {
    const id = await draft();
    expect((await callAs(a, "admin", publishForm, { formId: id })).ok).toBe(true);
    const r = await callAs(a, "admin", updateForm, { formId: id, title: "Changed", fields: [{ type: "text", label: "x" }], classSectionIds: [sectionA2] });
    expect(r.ok ? null : r.error.code).toBe("invalid_state");
    const [row] = await sql`select title from public.forms where id = ${id}`;
    expect(row.title).toBe("Trip consent");
    expect(await sectionsOf(id)).toEqual([sectionA]);
  });

  // Regression (fixed): updateForm writes the title/fields, deletes all sections, then inserts the new ones — three separate requests.
  // A foreign section fails the last step after the first two have committed.
  it("a refused section swap leaves the draft's title and audience sections unchanged", async () => {
    const id = await draft([sectionA]);
    const r = await callAs(a, "admin", updateForm, { formId: id, title: "Half-saved", fields: FIELDS, classSectionIds: [foreignSection] });
    expect(r.ok).toBe(false);
    const [row] = await sql`select title from public.forms where id = ${id}`;
    expect({ title: row.title, sections: await sectionsOf(id) }).toEqual({ title: "Trip consent", sections: [sectionA] });
  });

  it("createForm with a foreign section is refused and leaves no orphan form", async () => {
    const title = `Orphan ${crypto.randomUUID().slice(0, 8)}`;
    const r = await callAs(a, "admin", createForm, { title, fields: FIELDS, classSectionIds: [foreignSection] });
    expect(r.ok).toBe(false);
    expect(r.ok ? null : r.error.code).not.toBe("internal");
    const [c] = await sql`select count(*)::int as n from public.forms where institution_id = ${a.institutionId} and title = ${title}`;
    expect(c.n).toBe(0);
  });
});

describe("forms validation", () => {
  it.each([
    ["duplicate options", [{ type: "choice", label: "Meal", options: ["Veg", "Veg"] }]],
    ["one option", [{ type: "choice", label: "Meal", options: ["Veg"] }]],
    ["options on a text field", [{ type: "text", label: "Notes", options: ["a", "b"] }]],
    ["unknown type", [{ type: "file", label: "Upload" }]],
    ["no fields", []],
    ["31 fields", Array.from({ length: 31 }, (_, i) => ({ type: "text", label: `Q${i}` }))],
  ])("create: %s → validation_failed on fields", async (_l, fields) => {
    const r = await callAs(a, "admin", createForm, { title: "T", fields, classSectionIds: [] });
    expect(r.ok ? null : r.error.code).toBe("validation_failed");
    expect(r.ok ? null : r.error.fieldErrors?.fields).toBeTruthy();
  });

  it("duplicate section ids → validation_failed on classSectionIds", async () => {
    const r = await callAs(a, "admin", createForm, { title: "T", fields: FIELDS, classSectionIds: [sectionA, sectionA] });
    expect(r.ok ? null : r.error.fieldErrors?.classSectionIds).toBeTruthy();
  });
});

describe("respondToForm", () => {
  it("guardian answers once; a second answer is conflict; admin cannot respond", async () => {
    const id = await draft();
    expect((await callAs(a, "admin", publishForm, { formId: id })).ok).toBe(true);
    expect((await callAs(a, "guardian", respondToForm, { formId: id, studentId: childId, answers: GOOD })).ok).toBe(true);
    const again = await callAs(a, "guardian", respondToForm, { formId: id, studentId: childId, answers: GOOD });
    expect(again.ok ? null : again.error.code).toBe("conflict");
    const adm = await callAs(a, "admin", respondToForm, { formId: id, studentId: childId, answers: GOOD });
    expect(adm.ok ? null : adm.error.code).toBe("forbidden");
  });

  it("two parallel answers for the same child: exactly one response row", async () => {
    const id = await draft();
    expect((await callAs(a, "admin", publishForm, { formId: id })).ok).toBe(true);
    const rs = await Promise.all([1, 2].map(() => callAs(a, "guardian", respondToForm, { formId: id, studentId: childId, answers: GOOD })));
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    const [c] = await sql`select count(*)::int as n from public.form_responses where form_id = ${id}`;
    expect(c.n).toBe(1);
  });

  it("answers misaligned with fields, an out-of-range choice index, and unknown form are refused", async () => {
    const id = await draft();
    expect((await callAs(a, "admin", publishForm, { formId: id })).ok).toBe(true);
    const short = await callAs(a, "guardian", respondToForm, { formId: id, studentId: childId, answers: [true] });
    expect(short.ok ? null : short.error.code).toBe("validation_failed");
    const idx = await callAs(a, "guardian", respondToForm, { formId: id, studentId: childId, answers: [true, 5] });
    expect(idx.ok ? null : idx.error.code).toBe("validation_failed");
    const zod = await callAs(a, "guardian", respondToForm, { formId: id, studentId: childId, answers: [true, 10] });
    expect(zod.ok ? null : zod.error.fieldErrors?.answers).toBeTruthy();
    const unknown = await callAs(a, "guardian", respondToForm, { formId: crypto.randomUUID(), studentId: childId, answers: GOOD });
    expect(unknown.ok ? null : unknown.error.code).toBe("not_found");
  });

  it("a draft or closed form cannot be answered", async () => {
    const d = await draft();
    const onDraft = await callAs(a, "guardian", respondToForm, { formId: d, studentId: childId, answers: GOOD });
    expect(onDraft.ok).toBe(false);
    const c = await draft();
    expect((await callAs(a, "admin", publishForm, { formId: c })).ok).toBe(true);
    expect((await callAs(a, "admin", closeForm, { formId: c })).ok).toBe(true);
    const onClosed = await callAs(a, "guardian", respondToForm, { formId: c, studentId: childId, answers: GOOD });
    expect(onClosed.ok ? null : onClosed.error.code).toBe("invalid_state");
  });
});
