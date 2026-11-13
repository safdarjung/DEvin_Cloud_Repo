import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import {
  addItemsFromBank,
  addManualItem,
  addSection,
  approvePaper,
  createPaper,
  generatePaperFromTemplate,
  newPaperRevision,
  publishPaper,
  reorderSections,
  replaceItem,
  returnPaperToDraft,
  setChoiceGroup,
  submitPaperForReview,
  updateItem,
  updatePaper,
  updateSection,
} from "@/modules/question-papers/actions";
import { questionPapersValidateQuery, questionPapersWhereUsedQuery } from "@/modules/question-papers/query-defs";
import { listLabelledTeachableSections } from "@/modules/academics/assignments.queries";
import { listTeachingPairs } from "@/modules/question-bank/queries";
import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import { setActingClient } from "../helpers/server-client-mock";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createGrade,
  createSubject,
  createSubjectAssignment,
  createTerm,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

interface Base {
  yearId: string;
  gradeId: string;
  sectionId: string;
  examId: string;
  math: string;
  science: string;
  teacherUserId: string;
}

let inst: TestInstitution;
let other: TestInstitution;
let base: Base;

async function buildBase(fixture: TestInstitution): Promise<Base> {
  const yearId = await createAcademicYear(fixture.institutionId);
  const termId = await createTerm(fixture.institutionId, yearId);
  const gradeId = await createGrade(fixture.institutionId);
  const sectionId = await createClassSection(fixture.institutionId, gradeId, yearId, { name: "A" });
  const math = await createSubject(fixture.institutionId, { code: "MATH" });
  const science = await createSubject(fixture.institutionId, { code: "SCI" });
  const [teacher] = await sql`select user_id, staff_id from public.memberships where institution_id = ${fixture.institutionId} and role = 'teacher'`;
  await createSubjectAssignment(fixture.institutionId, sectionId, math, teacher.staff_id as string);
  const [exam] = await sql`
    insert into public.exams (institution_id, academic_year_id, term_id, name, type)
    values (${fixture.institutionId}, ${yearId}, ${termId}, 'Unit Test 1', 'unit_test') returning id
  `;
  return { yearId, gradeId, sectionId, examId: exam.id as string, math, science, teacherUserId: teacher.user_id as string };
}

async function bankQuestion(overrides: Record<string, unknown> = {}): Promise<string> {
  const row = {
    institution_id: inst.institutionId,
    subject_id: base.math,
    grade_id: base.gradeId,
    type: "short_answer",
    difficulty: "easy",
    body: `Bank question ${crypto.randomUUID()}`,
    answer: "Answer.",
    marks: 2,
    created_by: base.teacherUserId,
    ...overrides,
  };
  const [r] = await sql`insert into public.question_bank ${sql(row)} returning id`;
  return r.id as string;
}

const mcq = (marks = 1) =>
  bankQuestion({ type: "mcq", options: sql.json(["2", "3", "4", "5"]), answer: "4", marks, body: `What is 2 + 2? ${crypto.randomUUID()}` });

function must<T>(r: { ok: true; data: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.data;
}

/** Each paper gets its own exam: only one published paper may feed an exam's marks entry. */
async function newExam(yearId = base.yearId): Promise<string> {
  const [term] = await sql`select id from public.terms where academic_year_id = ${yearId} limit 1`;
  const [exam] = await sql`
    insert into public.exams (institution_id, academic_year_id, term_id, name, type)
    values (${inst.institutionId}, ${yearId}, ${term.id}, ${`Unit Test ${crypto.randomUUID().slice(0, 8)}`}, 'unit_test') returning id
  `;
  return exam.id as string;
}

/** A teacher's 6-mark paper: Section A = 2 MCQ x 1; Section B = an OR pair (2/2) + one 2-mark question. */
async function sixMarkPaper(): Promise<{ paperId: string; examId: string; sectionA: string; sectionB: string; items: string[] }> {
  const examId = await newExam();
  const { id: paperId } = must(
    await callAs(inst, "teacher", createPaper, {
      academicYearId: base.yearId,
      gradeId: base.gradeId,
      subjectId: base.math,
      sectionId: base.sectionId,
      examId,
      title: "Maths unit test",
      totalMarks: 6,
      passMarks: 2,
    }),
  );
  const { id: sectionA } = must(await callAs(inst, "teacher", addSection, { paperId, title: "Section A" }));
  const { id: sectionB } = must(await callAs(inst, "teacher", addSection, { paperId, title: "Section B" }));
  const a = must(await callAs(inst, "teacher", addItemsFromBank, { sectionId: sectionA, questionIds: [await mcq(), await mcq()] }));
  const b = must(
    await callAs(inst, "teacher", addItemsFromBank, { sectionId: sectionB, questionIds: [await bankQuestion(), await bankQuestion(), await bankQuestion()] }),
  );
  must(await callAs(inst, "teacher", setChoiceGroup, { itemIds: b.itemIds.slice(0, 2), choiceGroup: 1 }));
  return { paperId, examId, sectionA, sectionB, items: [...a.itemIds, ...b.itemIds] };
}

beforeAll(async () => {
  [inst, other] = await Promise.all([createTestInstitution("qp"), createTestInstitution("qp-other")]);
  base = await buildBase(inst);
  await buildBase(other);
}, 60_000);

afterAll(async () => {
  await Promise.all([inst.cleanup(), other.cleanup()]);
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
}, 60_000);

describe("question papers — RLS scope", () => {
  it("teacher builds a paper in a taught subject but not in an untaught one", async () => {
    const { paperId } = await sixMarkPaper();
    expect(paperId).toBeTruthy();
    const untaught = await callAs(inst, "teacher", createPaper, {
      academicYearId: base.yearId,
      gradeId: base.gradeId,
      subjectId: base.science,
      title: "Science",
      totalMarks: 10,
    });
    expect(untaught).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });

  it("students, guardians, admin and another school read no paper, section, item or version", async () => {
    const { paperId } = await sixMarkPaper();
    for (const role of ["student", "guardian", "admin"] as const) {
      for (const table of ["question_papers", "question_paper_sections", "question_paper_items", "question_paper_versions"] as const) {
        const { data } = await inst.clientAs(role).from(table).select("id");
        expect(data ?? [], `${role} ${table}`).toEqual([]);
      }
    }
    const { data: foreign } = await other.clientAs("owner").from("question_papers").select("id").eq("id", paperId);
    expect(foreign).toEqual([]);
    const { data: mine } = await inst.clientAs("teacher").from("question_papers").select("id").eq("id", paperId);
    expect(mine).toHaveLength(1);
  });

  it("another school's owner cannot add a section to this paper", async () => {
    const { paperId } = await sixMarkPaper();
    const { error } = await other
      .clientAs("owner")
      .from("question_paper_sections")
      .insert({ institution_id: inst.institutionId, paper_id: paperId, title: "Injected" });
    expect(error).not.toBeNull();
  });

  it("a teacher can only change status through the transition function", async () => {
    const { paperId } = await sixMarkPaper();
    const { error } = await inst.clientAs("teacher").from("question_papers").update({ status: "approved" }).eq("id", paperId);
    expect(error?.message).toBe("code:forbidden");
  });
});

describe("question papers — validate_paper", () => {
  it("counts an OR pair once and keeps the best N slots of an attempt-any section", async () => {
    const { paperId, sectionB } = await sixMarkPaper();
    const valid = must(await callAs(inst, "teacher", questionPapersValidateQuery, { id: paperId }));
    expect(valid).toMatchObject({ ok: true, computedTotal: 6 });

    must(await callAs(inst, "teacher", updateSection, { id: sectionB, chooseCount: 1 }));
    const chosen = must(await callAs(inst, "teacher", questionPapersValidateQuery, { id: paperId }));
    expect(chosen.ok).toBe(false);
    expect(chosen.computedTotal).toBe(4);
    expect(chosen.errors.join(" ")).toContain("add up to 4 marks");
  });

  it("flags a missing objective answer key, a duplicate bank question and an unapproved AI source", async () => {
    const { paperId, sectionA } = await sixMarkPaper();
    const draft = await bankQuestion({ origin: "ai", status: "draft" });
    must(await callAs(inst, "teacher", addItemsFromBank, { sectionId: sectionA, questionIds: [draft] }));
    await sql`
      insert into public.question_paper_items (institution_id, paper_id, section_id, type, body, options, marks, difficulty, source_question_id)
      select institution_id, paper_id, section_id, 'mcq', 'Pick one', ${sql.json(["a", "b"])}, 1, 'easy', source_question_id
      from public.question_paper_items where paper_id = ${paperId} and type = 'mcq' limit 1
    `;
    const v = must(await callAs(inst, "teacher", questionPapersValidateQuery, { id: paperId }));
    const text = v.errors.join(" ");
    expect(text).toContain("has no answer key");
    expect(text).toContain("used 2 times");
    expect(text).toContain("not approved yet");
  });

  it("blueprint counts are errors; generate fills only from approved bank questions and reports gaps", async () => {
    await Promise.all([mcq(), mcq(), mcq()]);
    const { id: paperId } = must(
      await callAs(inst, "principal", createPaper, {
        academicYearId: base.yearId,
        gradeId: base.gradeId,
        subjectId: base.math,
        title: "Blueprint paper",
        totalMarks: 50,
        blueprint: { sections: [{ title: "A", rows: [{ type: "mcq", count: 2, marks: 1 }, { type: "long_answer", count: 1, marks: 48 }] }] },
      }),
    );
    const gen = must(await callAs(inst, "principal", generatePaperFromTemplate, { id: paperId }));
    expect(gen.addedItemIds).toHaveLength(2);
    expect(gen.gaps).toEqual([expect.objectContaining({ type: "long_answer", missing: 1 })]);
    const again = must(await callAs(inst, "principal", generatePaperFromTemplate, { id: paperId }));
    expect(again.addedItemIds).toHaveLength(0);
    const v = must(await callAs(inst, "principal", questionPapersValidateQuery, { id: paperId }));
    expect(v.errors.join(" ")).toContain("Blueprint: 1 × long answer (48 marks) planned, 0 in the paper.");
  });
});

describe("question papers — approval, publish, freeze, versions", () => {
  it("an invalid paper cannot be approved, even by the principal", async () => {
    const { paperId, sectionB } = await sixMarkPaper();
    must(await callAs(inst, "teacher", updateSection, { id: sectionB, chooseCount: 1 }));
    const r = await callAs(inst, "principal", approvePaper, { id: paperId });
    expect(r).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    const { error } = await inst.clientAs("principal").rpc("transition_question_paper", { p_paper_id: paperId, p_to: "approved" });
    expect(error?.message).toBe("code:validation_failed");
  });

  it("a teacher cannot approve, not via the action and not via the RPC", async () => {
    const { paperId } = await sixMarkPaper();
    expect(await callAs(inst, "teacher", approvePaper, { id: paperId })).toMatchObject({ ok: false, error: { code: "forbidden" } });
    const { error } = await inst.clientAs("teacher").rpc("transition_question_paper", { p_paper_id: paperId, p_to: "approved" });
    expect(error?.message).toBe("code:forbidden");
  });

  it("approve then publish freezes the paper, writes versions and links the marks-entry row", async () => {
    const { paperId, examId, items } = await sixMarkPaper();
    must(await callAs(inst, "teacher", submitPaperForReview, { id: paperId }));
    expect(must(await callAs(inst, "principal", approvePaper, { id: paperId }))).toMatchObject({ status: "approved", version: 1 });
    const published = must(await callAs(inst, "exam_controller", publishPaper, { id: paperId }));
    expect(published).toMatchObject({ status: "published", version: 2 });

    const [ep] = await sql`select max_marks, pass_marks, exam_id, class_section_id from public.exam_papers where id = ${published.examPaperId}`;
    expect(ep).toMatchObject({ max_marks: "6.00", pass_marks: "2.00", exam_id: examId, class_section_id: base.sectionId });
    const versions = await sql`select version_no, snapshot -> 'paper' ->> 'status' as status from public.question_paper_versions where paper_id = ${paperId} order by 1`;
    expect(versions.map((v) => [v.version_no, v.status])).toEqual([[1, "approved"], [2, "published"]]);

    const edit = await callAs(inst, "teacher", updateItem, {
      id: items[0],
      item: { type: "short_answer", difficulty: "easy", body: "Changed", answer: "x", marks: 1 },
    });
    expect(edit).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    const { error: header } = await inst.clientAs("principal").from("question_papers").update({ title: "Changed" }).eq("id", paperId);
    expect(header?.message).toBe("code:invalid_state");
    const add = await callAs(inst, "principal", addManualItem, {
      sectionId: (await sql`select section_id from public.question_paper_items where id = ${items[0]}`)[0].section_id,
      item: { type: "short_answer", difficulty: "easy", body: "Late addition", answer: "x", marks: 1 },
    });
    expect(add).toMatchObject({ ok: false, error: { code: "invalid_state" } });

    const used = must(await callAs(inst, "teacher", questionPapersWhereUsedQuery, {
      questionId: (await sql`select source_question_id from public.question_paper_items where id = ${items[0]}`)[0].source_question_id,
    }));
    expect(used).toEqual([expect.objectContaining({ paperId, status: "published" })]);
  });

  it("versions are immutable and cannot be written directly", async () => {
    const { paperId } = await sixMarkPaper();
    must(await callAs(inst, "principal", approvePaper, { id: paperId }));
    await expect(sql`update public.question_paper_versions set reason = 'edited' where paper_id = ${paperId}`).rejects.toThrow("code:invalid_state");
    await expect(sql`delete from public.question_paper_versions where paper_id = ${paperId}`).rejects.toThrow("code:invalid_state");
    const { error } = await inst
      .clientAs("principal")
      .from("question_paper_versions")
      .insert({ institution_id: inst.institutionId, paper_id: paperId, version_no: 9, snapshot: {}, created_by: inst.users.principal.id });
    expect(error?.message).toBe("code:forbidden");
  });

  it("a new revision is an editable draft copy; the published paper stays as it was", async () => {
    const { paperId } = await sixMarkPaper();
    must(await callAs(inst, "principal", approvePaper, { id: paperId }));
    must(await callAs(inst, "principal", publishPaper, { id: paperId }));
    const { id: revisionId } = must(await callAs(inst, "teacher", newPaperRevision, { id: paperId }));
    const [rev] = await sql`select status, revision_of_id, created_by, exam_paper_id is not null as linked from public.question_papers where id = ${revisionId}`;
    expect(rev).toMatchObject({ status: "draft", revision_of_id: paperId, created_by: base.teacherUserId, linked: true });
    const [{ n }] = await sql`select count(*)::int as n from public.question_paper_items where paper_id = ${revisionId}`;
    expect(n).toBe(5);
    const [section] = await sql`select id from public.question_paper_sections where paper_id = ${revisionId} order by position limit 1`;
    must(await callAs(inst, "teacher", addManualItem, { sectionId: section.id, item: { type: "true_false", difficulty: "easy", body: "2 is even.", answer: "true", marks: 1 } }));
    const [{ status }] = await sql`select status from public.question_papers where id = ${paperId}`;
    expect(status).toBe("published");
    expect(await callAs(inst, "teacher", newPaperRevision, { id: revisionId })).toMatchObject({ ok: false, error: { code: "invalid_state" } });
  });
});

describe("question papers — security review fixes", () => {
  const nextYear = async () =>
    createAcademicYear(inst.institutionId, { name: `2027-28 ${crypto.randomUUID().slice(0, 4)}`, startsOn: "2027-04-01", endsOn: "2028-03-31", isCurrent: false });

  it("a teacher cannot read or create papers for a year they do not teach the subject in (M1)", async () => {
    const yearId = await nextYear();
    const { id } = must(
      await callAs(inst, "principal", createPaper, { academicYearId: yearId, gradeId: base.gradeId, subjectId: base.math, title: "Next year", totalMarks: 10 }),
    );
    const { data } = await inst.clientAs("teacher").from("question_papers").select("id").eq("id", id);
    expect(data).toEqual([]);
    const created = await callAs(inst, "teacher", createPaper, { academicYearId: yearId, gradeId: base.gradeId, subjectId: base.math, title: "Mine", totalMarks: 10 });
    expect(created).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });

  it("an AI draft keeps its origin: nulling source_question_id does not pass validation (M2)", async () => {
    const { paperId, sectionA } = await sixMarkPaper();
    const draft = await bankQuestion({ origin: "ai", status: "draft" });
    const { itemIds } = must(await callAs(inst, "teacher", addItemsFromBank, { sectionId: sectionA, questionIds: [draft] }));
    const { error } = await inst.clientAs("teacher").from("question_paper_items").update({ source_question_id: null }).eq("id", itemIds[0]);
    expect(error).toBeNull();
    const [row] = await sql`select origin, source_question_id from public.question_paper_items where id = ${itemIds[0]}`;
    expect(row).toMatchObject({ origin: "ai", source_question_id: null });
    const v = must(await callAs(inst, "teacher", questionPapersValidateQuery, { id: paperId }));
    expect(v.errors.join(" ")).toContain("the question bank has not approved");
  });

  it("origin is taken from the bank, never from the client (M2)", async () => {
    const { paperId, sectionA } = await sixMarkPaper();
    const draft = await bankQuestion({ origin: "ai", status: "draft" });
    const { data, error } = await inst
      .clientAs("teacher")
      .from("question_paper_items")
      .insert({
        institution_id: inst.institutionId, paper_id: paperId, section_id: sectionA, type: "short_answer",
        body: "Smuggled", answer: "x", marks: 1, difficulty: "easy", source_question_id: draft, origin: "manual",
      })
      .select("origin")
      .single();
    expect(error).toBeNull();
    expect(data?.origin).toBe("ai");
  });

  it("editing a bank item makes it manual content, but an AI item stays AI (M2)", async () => {
    const { paperId, items } = await sixMarkPaper();
    const edit = { type: "short_answer", difficulty: "easy", body: "Rewritten by the teacher", answer: "x", marks: 2 };
    must(await callAs(inst, "teacher", updateItem, { id: items[4], item: edit }));
    const [manual] = await sql`select origin, source_question_id from public.question_paper_items where id = ${items[4]}`;
    expect(manual).toMatchObject({ origin: "manual", source_question_id: null });
    expect(must(await callAs(inst, "teacher", questionPapersValidateQuery, { id: paperId })).ok).toBe(true);

    const ai = await bankQuestion({ origin: "ai", status: "draft" });
    must(await callAs(inst, "teacher", replaceItem, { id: items[4], questionId: ai }));
    must(await callAs(inst, "teacher", updateItem, { id: items[4], item: { ...edit, body: "AI text, lightly edited" } }));
    const [aiRow] = await sql`select origin, source_question_id from public.question_paper_items where id = ${items[4]}`;
    expect(aiRow).toMatchObject({ origin: "ai", source_question_id: null });
    expect(must(await callAs(inst, "teacher", questionPapersValidateQuery, { id: paperId })).ok).toBe(false);
  });

  it("an in-review paper is frozen for its teacher until returned to draft (M3)", async () => {
    const { paperId, sectionB, items } = await sixMarkPaper();
    must(await callAs(inst, "teacher", submitPaperForReview, { id: paperId }));
    const edit = await callAs(inst, "teacher", updateItem, { id: items[4], item: { type: "short_answer", difficulty: "easy", body: "Sneaky", answer: "x", marks: 2 } });
    expect(edit).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    expect(await callAs(inst, "teacher", updatePaper, { id: paperId, title: "Sneaky" })).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    expect(await callAs(inst, "teacher", addSection, { paperId, title: "Late" })).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    must(await callAs(inst, "principal", updateSection, { id: sectionB, title: "Section B (reviewed)" }));
    must(await callAs(inst, "teacher", returnPaperToDraft, { id: paperId }));
    must(await callAs(inst, "teacher", updatePaper, { id: paperId, title: "Fixed" }));
  });

  it("approve refuses a stale expectedUpdatedAt; any item edit moves the paper's updated_at (M3)", async () => {
    const { paperId, items } = await sixMarkPaper();
    must(await callAs(inst, "teacher", submitPaperForReview, { id: paperId }));
    const [{ updated_at: seen }] = await sql`select updated_at from public.question_papers where id = ${paperId}`;
    must(await callAs(inst, "principal", updateItem, { id: items[4], item: { type: "short_answer", difficulty: "easy", body: "Principal fix", answer: "x", marks: 2 } }));
    const stale = await callAs(inst, "principal", approvePaper, { id: paperId, expectedUpdatedAt: (seen as Date).toISOString() });
    expect(stale).toMatchObject({ ok: false, error: { code: "conflict" } });
    const [{ updated_at: now }] = await sql`select updated_at from public.question_papers where id = ${paperId}`;
    expect(must(await callAs(inst, "principal", approvePaper, { id: paperId, expectedUpdatedAt: (now as Date).toISOString() }))).toMatchObject({ status: "approved" });
  });

  it("a marks-entry paper from another school year is refused (L2)", async () => {
    const yearId = await nextYear();
    await createTerm(inst.institutionId, yearId, { startsOn: "2027-04-01", endsOn: "2027-09-30" });
    const examId = await newExam(yearId);
    const sectionId = await createClassSection(inst.institutionId, base.gradeId, yearId, { name: "N" });
    const [ep] = await sql`
      insert into public.exam_papers (institution_id, exam_id, class_section_id, subject_id, max_marks, pass_marks)
      values (${inst.institutionId}, ${examId}, ${sectionId}, ${base.math}, 10, 4) returning id
    `;
    const r = await callAs(inst, "principal", createPaper, {
      academicYearId: base.yearId, gradeId: base.gradeId, subjectId: base.math, examPaperId: ep.id as string, title: "Wrong year", totalMarks: 10,
    });
    expect(r).toMatchObject({ ok: false, error: { code: "validation_failed" } });
  });

  it("publishing a revision archives the paper it revises; a second paper for the same marks entry conflicts (L2)", async () => {
    const { paperId, examId } = await sixMarkPaper();
    must(await callAs(inst, "principal", approvePaper, { id: paperId }));
    const first = must(await callAs(inst, "principal", publishPaper, { id: paperId }));
    const { id: revisionId } = must(await callAs(inst, "teacher", newPaperRevision, { id: paperId }));
    must(await callAs(inst, "principal", approvePaper, { id: revisionId }));
    expect(must(await callAs(inst, "principal", publishPaper, { id: revisionId }))).toMatchObject({ examPaperId: first.examPaperId });
    const [{ status }] = await sql`select status from public.question_papers where id = ${paperId}`;
    expect(status).toBe("archived");

    const { id: rival } = must(await callAs(inst, "principal", newPaperRevision, { id: revisionId }));
    await sql`update public.question_papers set revision_of_id = null where id = ${rival}`;
    must(await callAs(inst, "principal", approvePaper, { id: rival }));
    expect(await callAs(inst, "principal", publishPaper, { id: rival })).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(examId).toBeTruthy();
  });

  it("revision_of_id is set only by copy_question_paper (L3)", async () => {
    const { paperId } = await sixMarkPaper();
    const { error } = await inst.clientAs("teacher").from("question_papers").insert({
      institution_id: inst.institutionId, academic_year_id: base.yearId, grade_id: base.gradeId, subject_id: base.math,
      title: "Forged revision", total_marks: 6, revision_of_id: paperId, created_by: base.teacherUserId,
    });
    expect(error?.message).toBe("code:forbidden");
  });
});

describe("question papers — wizard pairs, labels and blueprint mapping", () => {
  async function asRole<T>(role: "teacher" | "principal", fn: (ctx: Awaited<ReturnType<typeof buildContext>>) => Promise<T>): Promise<T> {
    const ctx = await buildContext(inst, role);
    setActingClient(inst.clientAs(role) as never);
    try {
      return await fn(ctx);
    } finally {
      setActingClient(null);
    }
  }

  it("a class teacher is offered only subjects they teach, and every offered pair can create a paper", async () => {
    const [teacher] = await sql`select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'`;
    const grade7 = await createGrade(inst.institutionId, { code: "VII", sortKey: 7 });
    const section7 = await createClassSection(inst.institutionId, grade7, base.yearId, { name: "A", classTeacherId: teacher.staff_id as string });
    await createSubjectAssignment(inst.institutionId, section7, base.science, teacher.staff_id as string);

    const pairs = await asRole("teacher", (ctx) => listTeachingPairs(ctx));
    const keys = pairs.map((p) => `${p.gradeId}:${p.subjectId}`).sort();
    // Class teacher of VII-A, but teaches only Science there: VII Mathematics is not offered (RLS 0149 would refuse it).
    expect(keys).toEqual([`${base.gradeId}:${base.math}`, `${grade7}:${base.science}`].sort());
    for (const p of pairs) {
      must(await callAs(inst, "teacher", createPaper, { academicYearId: base.yearId, gradeId: p.gradeId, subjectId: p.subjectId, title: `Pair ${p.gradeCode}`, totalMarks: 5 }));
    }
    const refused = await callAs(inst, "teacher", createPaper, { academicYearId: base.yearId, gradeId: grade7, subjectId: base.math, title: "Untaught", totalMarks: 5 });
    expect(refused).toMatchObject({ ok: false, error: { code: "forbidden", message: expect.stringContaining("subject you teach") } });

    const sections = await asRole("teacher", (ctx) => listLabelledTeachableSections(ctx));
    expect(sections.map((x) => x.label)).toEqual(["VI-A", "VII-A"]);
  });

  it("generate maps blueprint sections by title: a hand-added first section stays empty, a renamed one is a gap", async () => {
    await Promise.all([mcq(), mcq()]);
    const made = must(
      await callAs(inst, "principal", createPaper, {
        academicYearId: base.yearId, gradeId: base.gradeId, subjectId: base.math, title: "Mapped paper", totalMarks: 4,
        blueprint: { sections: [{ title: "Section A", rows: [{ type: "mcq", count: 2, marks: 1 }] }, { title: "Section B", rows: [{ type: "short_answer", count: 1, marks: 2 }] }] },
      }),
    );
    expect(made.sectionIds).toHaveLength(2);
    const [secA, secB] = made.sectionIds;
    const { id: warm } = must(await callAs(inst, "principal", addSection, { paperId: made.id, title: "Warm-up" }));
    must(await callAs(inst, "principal", reorderSections, { paperId: made.id, sectionIds: [warm, secA, secB] }));
    must(await callAs(inst, "principal", updateSection, { id: secB, title: "Part B" }));

    const gen = must(await callAs(inst, "principal", generatePaperFromTemplate, { id: made.id }));
    const placed = await sql`select section_id, type from public.question_paper_items where paper_id = ${made.id}`;
    expect(placed).toHaveLength(2);
    expect(placed.every((r) => r.section_id === secA && r.type === "mcq")).toBe(true);
    expect(gen.gaps).toEqual([expect.objectContaining({ sectionId: null, sectionTitle: "Section B", type: "short_answer", missing: 1 })]);
    // No duplicate "Section B" was created.
    const [{ n }] = await sql`select count(*)::int n from public.question_paper_sections where paper_id = ${made.id}`;
    expect(n).toBe(3);
  });
});
