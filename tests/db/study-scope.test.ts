// 0140 item 8 — study with AI on a chosen scope, through the real action and
// queries under the student's RLS: ids of another grade's book or unit, or
// another student's file, never survive into the stored scope or the context.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createEnrolment, createGrade, createSubject, createSubjectAssignment } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";
import { openStudyScope, saveStudyScopeMessages } from "@/modules/study/scope.actions";
import { getScopeSession, resolveScope } from "@/modules/study/scope.queries";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 3 });

let inst: TestInstitution;
let mathId: string;
let book8: string;
let book9: string;
let unit8: string;
let unit9: string;
let foreignFile: string;

async function one(q: Promise<postgres.RowList<postgres.Row[]>>) {
  const [r] = await q;
  return r!;
}

beforeAll(async () => {
  inst = await createTestInstitution("study-scope");
  const yearId = await createAcademicYear(inst.institutionId);
  const g8 = await createGrade(inst.institutionId, { code: "VIII" });
  const g9 = await createGrade(inst.institutionId, { code: "IX" });
  mathId = await createSubject(inst.institutionId, { name: "Mathematics" });
  const section = await createClassSection(inst.institutionId, g8, yearId, { name: "A" });
  const teacherStaff = (await one(sql`select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'`)).staff_id as string;
  await createSubjectAssignment(inst.institutionId, section, mathId, teacherStaff);
  const studentId = (await one(sql`select student_id from public.memberships where institution_id = ${inst.institutionId} and role = 'student'`)).student_id as string;
  await createEnrolment(inst.institutionId, studentId, section, yearId, { status: "active" });
  const owner = inst.users.owner.id;
  book8 = (await one(sql`insert into public.subject_textbooks (institution_id, grade_id, subject_id, custom_title, custom_chapters, chapter_titles, created_by)
    values (${inst.institutionId}, ${g8}, ${mathId}, 'Maths for VIII', 6, '{"1":"Rational numbers","2":"Linear equations"}'::jsonb, ${owner}) returning id`)).id as string;
  book9 = (await one(sql`insert into public.subject_textbooks (institution_id, grade_id, subject_id, custom_title, custom_chapters, created_by)
    values (${inst.institutionId}, ${g9}, ${mathId}, 'Maths for IX', 6, ${owner}) returning id`)).id as string;
  unit8 = (await one(sql`insert into public.curriculum_units (institution_id, subject_id, grade_id, title, description, sequence)
    values (${inst.institutionId}, ${mathId}, ${g8}, 'Rational numbers', 'Properties of rational numbers.', 1) returning id`)).id as string;
  unit9 = (await one(sql`insert into public.curriculum_units (institution_id, subject_id, grade_id, title, description, sequence)
    values (${inst.institutionId}, ${mathId}, ${g9}, 'Number systems', 'Irrational numbers.', 1) returning id`)).id as string;
  await sql`insert into public.curriculum_unit_chapters (curriculum_unit_id, institution_id, grade_id, subject_id, subject_textbook_id, chapter_no, created_by)
    values (${unit8}, ${inst.institutionId}, ${g8}, ${mathId}, ${book8}, 1, ${owner})`;
  // Another student's private file in the same subject (row only; no stored object is needed for the id check).
  const other = await one(sql`insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${inst.institutionId}, ${`ADM-S-${crypto.randomUUID().slice(0, 8)}`}, 'Other', '2014-01-01', 'other') returning id`);
  foreignFile = (await one(sql`insert into public.curriculum_materials (institution_id, title, grade_id, subject_id, owner_kind, student_id, visibility, created_by)
    values (${inst.institutionId}, 'Someone else''s notes', ${g8}, ${mathId}, 'student', ${other.id}, 'private', ${owner}) returning id`)).id as string;
}, 120_000);

afterAll(async () => {
  await sql`delete from public.curriculum_materials where institution_id = ${inst.institutionId}`;
  await sql`delete from public.curriculum_unit_chapters where institution_id = ${inst.institutionId}`;
  await sql`delete from public.subject_textbooks where institution_id = ${inst.institutionId}`;
  await inst.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
}, 120_000);

describe("study scope (0140 item 8)", () => {
  it("opening keeps only the student's own grade's book, chapter and unit; drops another grade's and another student's file", async () => {
    const res = await callAs(inst, "student", openStudyScope, {
      scope: { subjectIds: [mathId], textbookIds: [book9], chapters: [{ textbookId: book8, chapterNo: 2 }, { textbookId: book9, chapterNo: 1 }], unitIds: [unit8, unit9], fileIds: [foreignFile] },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [row] = await sql`select scope, user_id from public.study_items where id = ${res.data.id}`;
    expect(row!.user_id).toBe(inst.users.student.id);
    expect(row!.scope).toEqual({ subjectIds: [mathId], chapters: [{ textbookId: book8, chapterNo: 2 }], unitIds: [unit8] });
  });

  it("a scope made only of another grade's unit and another student's file is refused", async () => {
    const res = await callAs(inst, "student", openStudyScope, { scope: { subjectIds: [mathId], unitIds: [unit9], fileIds: [foreignFile] } });
    expect(res).toMatchObject({ ok: false, error: { code: "validation_failed" } });
  });

  it("the server-built context carries the chapter title and unit outline, never the other grade's", async () => {
    const ctx = await buildContext(inst, "student");
    setActingClient(inst.clientAs("student") as never);
    const { context } = await resolveScope(ctx, { subjectIds: [mathId], chapters: [{ textbookId: book8, chapterNo: 1 }], unitIds: [unit9] });
    const text = context.lines.join("\n");
    expect(text).toContain("1 (Rational numbers)");
    expect(text).toContain("Properties of rational numbers.");
    expect(text).not.toContain("Irrational numbers");
    expect(text).not.toContain("Maths for IX");
  });

  it("a session saves its messages and resumes with them; another user cannot write to it", async () => {
    const opened = await callAs(inst, "student", openStudyScope, { scope: { subjectIds: [mathId], unitIds: [unit8] } });
    if (!opened.ok) throw new Error("setup");
    const message = { id: "m1", role: "user" as const, parts: [{ type: "text" as const, text: "Explain rational numbers" }] };
    const saved = await callAs(inst, "student", saveStudyScopeMessages, { itemId: opened.data.id, messages: [message] });
    expect(saved.ok).toBe(true);
    const ctx = await buildContext(inst, "student");
    setActingClient(inst.clientAs("student") as never);
    const session = await getScopeSession(ctx, opened.data.id);
    expect(session?.messages).toEqual([message]);
    const guardianWrite = await callAs(inst, "guardian", saveStudyScopeMessages, { itemId: opened.data.id, messages: [] });
    expect(guardianWrite.ok).toBe(false);
  });

  it("teachers and guardians cannot open a student scope", async () => {
    for (const role of ["teacher", "guardian"] as const) {
      const res = await callAs(inst, role, openStudyScope, { scope: { subjectIds: [mathId], unitIds: [unit8] } });
      expect(res).toMatchObject({ ok: false, error: { code: "forbidden" } });
    }
  });
});
