import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { learningMyWeakTopicsQuery, learningSectionGapsQuery } from "@/modules/learning/query-defs";
import { callAs, closeActionsHelper } from "../helpers/actions";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createEnrolment,
  createGrade,
  createSubject,
  createSubjectAssignment,
  createTerm,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";
import { createAdminClient } from "@/lib/supabase/admin";

// Migration 0151: practice with server-held keys, per-question learning
// analytics and their scope, mastery fed by online tests.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

let inst: TestInstitution;
let other: TestInstitution;
let fx: {
  yearId: string;
  gradeId: string;
  sectionA: string;
  sectionB: string;
  subjectId: string;
  unitId: string;
  topicId: string;
  studentId: string;
  peerId: string;
  teacherUser: string;
  testId: string;
};

async function memberCol(institutionId: string, role: string, column: "staff_id" | "student_id" | "guardian_id" | "user_id") {
  const [row] = await sql`select ${sql(column)} as id from public.memberships where institution_id = ${institutionId} and role = ${role}`;
  return row.id as string;
}

async function bankQuestion(over: Record<string, unknown> = {}): Promise<string> {
  const row = {
    institution_id: inst.institutionId,
    grade_id: fx.gradeId,
    subject_id: fx.subjectId,
    curriculum_unit_id: fx.unitId,
    curriculum_topic_id: fx.topicId,
    type: "mcq",
    body: `What is 2+2? ${crypto.randomUUID().slice(0, 6)}`,
    options: sql.json(["3", "4", "5", "6"]),
    answer: "4",
    explanation: "Two and two make four.",
    difficulty: "easy",
    marks: 1,
    status: "approved",
    created_by: fx.teacherUser,
    ...over,
  };
  const [r] = await sql`insert into public.question_bank ${sql(row as never)} returning id`;
  return r.id as string;
}

// A published online test on section A (results released after publish): one
// MCQ on the topic (1 mark) and one numerical on the unit (2 marks).
async function onlineTest(): Promise<string> {
  const id = inst.institutionId;
  const [paper] = await sql`
    insert into public.question_papers (institution_id, academic_year_id, grade_id, subject_id, title, total_marks, status, current_version, created_by)
    values (${id}, ${fx.yearId}, ${fx.gradeId}, ${fx.subjectId}, 'Fractions check', 3, 'published', 1, ${fx.teacherUser}) returning id`;
  const mcqKey = crypto.randomUUID();
  const numKey = crypto.randomUUID();
  const snapshot = {
    paper: { id: paper.id, total_marks: 3 },
    sections: [
      {
        id: crypto.randomUUID(),
        title: "A",
        choose_count: null,
        items: [
          { id: mcqKey, type: "mcq", body: "Half of 8?", marks: 1, options: ["2", "4", "6"], answer: "4", curriculum_unit_id: fx.unitId, curriculum_topic_id: fx.topicId, choice_group: null },
          { id: numKey, type: "numerical", body: "1/2 + 1/4 = ?", marks: 2, answer: "0.75", answer_key: { value: 0.75 }, curriculum_unit_id: fx.unitId, curriculum_topic_id: null, choice_group: null },
        ],
      },
    ],
  };
  await sql`insert into public.question_paper_versions (institution_id, paper_id, version_no, snapshot, reason)
    values (${id}, ${paper.id}, 1, ${sql.json(snapshot as never)}, 'approved')`;
  const [t] = await sql`
    insert into public.online_tests (institution_id, question_paper_id, paper_version_no, grade_id, subject_id, title, section_ids, opens_at, closes_at, duration_minutes, status, published_at, created_by)
    values (${id}, ${paper.id}, 1, ${fx.gradeId}, ${fx.subjectId}, 'Fractions check', ${[fx.sectionA, fx.sectionB]}, now() - interval '2 days', now() - interval '1 day', 30, 'published', now(), ${fx.teacherUser})
    returning id`;
  // Student (section A): MCQ wrong ("2"), numerical wrong → 0/3. Peer (section B): MCQ right, numerical right → 3/3.
  for (const [studentId, mcq, num, total] of [
    [fx.studentId, "2", "0.5", 0],
    [fx.peerId, "4", "0.75", 3],
  ] as const) {
    const [a] = await sql`
      insert into public.test_attempts (institution_id, test_id, student_id, attempt_no, started_at, deadline, submitted_at, status, objective_score, subjective_score, total_score)
      values (${id}, ${t.id}, ${studentId}, 1, now() - interval '36 hours', now() - interval '35 hours', now() - interval '35 hours', 'evaluated', ${total}, 0, ${total})
      returning id`;
    await sql`insert into public.test_responses (institution_id, attempt_id, item_key, answer, auto_marks) values
      (${id}, ${a.id}, ${mcqKey}, ${sql.json(mcq)}, ${mcq === "4" ? 1 : 0}),
      (${id}, ${a.id}, ${numKey}, ${sql.json(num)}, ${num === "0.75" ? 2 : 0})`;
  }
  return t.id as string;
}

beforeAll(async () => {
  inst = await createTestInstitution("learning");
  other = await createTestInstitution("learning-x");
  const id = inst.institutionId;
  const yearId = await createAcademicYear(id);
  const gradeId = await createGrade(id);
  const teacherStaff = await memberCol(id, "teacher", "staff_id");
  const sectionA = await createClassSection(id, gradeId, yearId, { name: "A" });
  const sectionB = await createClassSection(id, gradeId, yearId, { name: "B" });
  const subjectId = await createSubject(id);
  await createSubjectAssignment(id, sectionA, subjectId, teacherStaff);
  // Section B learns the subject from someone else: the fixture teacher does not teach it there.
  const [otherStaff] = await sql`
    insert into public.staff (institution_id, employee_no, full_name, designation)
    values (${id}, ${`EMP-${crypto.randomUUID().slice(0, 6)}`}, 'Other', 'Teacher') returning id`;
  await createSubjectAssignment(id, sectionB, subjectId, otherStaff.id as string);
  const studentId = await memberCol(id, "student", "student_id");
  await createEnrolment(id, studentId, sectionA, yearId, { status: "active" });
  const [peer] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${id}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'Peer', '2014-01-01', 'other') returning id`;
  await createEnrolment(id, peer.id as string, sectionB, yearId, { status: "active" });
  const guardianId = await memberCol(id, "guardian", "guardian_id");
  await sql`insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${id}, ${guardianId}, ${studentId}, 'mother', true, true)`;
  const [unit] = await sql`insert into public.curriculum_units (institution_id, subject_id, grade_id, title, sequence)
    values (${id}, ${subjectId}, ${gradeId}, 'Fractions', 1) returning id`;
  const [topic] = await sql`insert into public.curriculum_topics (institution_id, curriculum_unit_id, title, sequence)
    values (${id}, ${unit.id}, 'Adding fractions', 1) returning id`;
  fx = {
    yearId,
    gradeId,
    sectionA,
    sectionB,
    subjectId,
    unitId: unit.id as string,
    topicId: topic.id as string,
    studentId,
    peerId: peer.id as string,
    teacherUser: await memberCol(id, "teacher", "user_id"),
    testId: "",
  };
  fx.testId = await onlineTest();
}, 60_000);

afterAll(async () => {
  await inst?.cleanup();
  await other?.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

type Session = { sessionId: string; questions: Record<string, unknown>[] };
type Submitted = { attemptId: string; score: number; maxScore: number; results: { key: string; correct: boolean; answer: string }[] };

const start = (role: "student" | "guardian" | "teacher", over: Record<string, unknown> = {}) =>
  inst.clientAs(role).rpc("start_bank_practice", {
    p_institution_id: inst.institutionId,
    p_curriculum_unit_id: fx.unitId,
    p_count: 15,
    ...over,
  });

describe("bank practice with server-held keys (0151)", () => {
  it("serves approved, unheld questions without any answer, key or explanation", async () => {
    const served = await bankQuestion();
    const draft = await bankQuestion({ status: "draft" });
    const written = await bankQuestion({ type: "short_answer", options: null, answer: "Because." });
    const held = await bankQuestion();
    const [paper] = await sql`
      insert into public.question_papers (institution_id, academic_year_id, grade_id, subject_id, title, total_marks, created_by)
      values (${inst.institutionId}, ${fx.yearId}, ${fx.gradeId}, ${fx.subjectId}, 'Upcoming', 10, ${fx.teacherUser}) returning id`;
    const [sec] = await sql`insert into public.question_paper_sections (institution_id, paper_id, title, position) values (${inst.institutionId}, ${paper.id}, 'A', 0) returning id`;
    await sql`insert into public.question_paper_items (institution_id, paper_id, section_id, position, type, body, options, answer, marks, difficulty, source_question_id)
      values (${inst.institutionId}, ${paper.id}, ${sec.id}, 0, 'mcq', 'Held', ${sql.json(["3", "4"])}, '4', 1, 'easy', ${held})`;

    const res = await start("student");
    expect(res.error).toBeNull();
    const session = res.data as Session;
    const keys = session.questions.map((q) => q.key);
    expect(keys).toContain(served);
    expect(keys).not.toContain(draft);
    expect(keys).not.toContain(written);
    expect(keys).not.toContain(held);
    for (const q of session.questions) {
      expect(Object.keys(q).sort()).toEqual(["body", "key", "marks", "options", "type"]);
    }
    expect(JSON.stringify(session)).not.toContain("Two and two make four");
  });

  it("the student cannot read or write practice_sessions directly", async () => {
    const { sessionId } = (await start("student")).data as Session;
    const student = inst.clientAs("student");
    const read = await student.from("practice_sessions").select("items").eq("id", sessionId);
    expect(read.data ?? []).toEqual([]);
    expect((await student.from("practice_sessions").update({ items: [] }).eq("id", sessionId)).error).not.toBeNull();
    expect(
      (
        await student.from("practice_sessions").insert({
          institution_id: inst.institutionId,
          student_id: fx.studentId,
          subject_id: fx.subjectId,
          curriculum_unit_id: fx.unitId,
          source: "bank",
          difficulty: "easy",
          items: [{ key: crypto.randomUUID(), type: "mcq", body: "x", options: ["a"], marks: 1, answer: "a" }],
        })
      ).error,
    ).not.toBeNull();
  });

  it("marks on the server, records the attempt once, and returns the answers only after submit", async () => {
    const { sessionId, questions } = (await start("student", { p_count: 2 })).data as Session;
    const answers = questions.map((_, i) => (i === 0 ? "4" : "3"));
    const res = await inst.clientAs("student").rpc("submit_practice_session", { p_session_id: sessionId, p_answers: answers });
    expect(res.error).toBeNull();
    const out = res.data as Submitted;
    expect([out.score, out.maxScore]).toEqual([1, questions.length]);
    expect(out.results[0]).toMatchObject({ correct: true, answer: "4" });
    const [attempt] = await sql`select score, max_score from public.practice_attempts where id = ${out.attemptId}`;
    expect([attempt.score, attempt.max_score]).toEqual([1, questions.length]);

    const again = await inst.clientAs("student").rpc("submit_practice_session", { p_session_id: sessionId, p_answers: answers });
    expect(again.error?.message).toBe("code:invalid_state");
  });

  it("no path lets a student fake a score", async () => {
    const student = inst.clientAs("student");
    // The client-keyed RPC of 0103 is gone.
    expect((await student.rpc("submit_practice_attempt" as never, {} as never)).error).not.toBeNull();
    // Writing an AI session (and its key) is service-role only.
    const forged = await student.rpc("create_ai_practice_session", {
      p_institution_id: inst.institutionId,
      p_student_id: fx.studentId,
      p_curriculum_unit_id: fx.unitId,
      p_difficulty: "easy",
      p_questions: [{ stem: "1+1?", options: ["1", "2", "3", "4"], answerIndex: 1 }],
    });
    expect(forged.error).not.toBeNull();
    // Direct writes to attempts stay refused.
    expect(
      (
        await student.from("practice_attempts").insert({
          institution_id: inst.institutionId,
          student_id: fx.studentId,
          curriculum_unit_id: fx.unitId,
          subject_id: fx.subjectId,
          difficulty: "easy",
          questions: [],
          answers: [],
          score: 9,
          max_score: 9,
        })
      ).error,
    ).not.toBeNull();
    // Another person's session is invisible; guardians and teachers cannot start a set.
    const { sessionId } = (await start("student")).data as Session;
    expect((await other.clientAs("student").rpc("submit_practice_session", { p_session_id: sessionId, p_answers: ["4"] })).error?.message).toBe(
      "code:not_found",
    );
    expect((await start("guardian")).error?.message).toBe("code:forbidden");
    expect((await start("teacher")).error?.message).toBe("code:forbidden");
    expect((await other.clientAs("student").rpc("start_bank_practice", { p_institution_id: inst.institutionId, p_curriculum_unit_id: fx.unitId })).error?.message).toBe(
      "code:not_found",
    );
  });

  it("an AI session stores the key server-side and scores from it", async () => {
    process.env.SERVICE_ROLE_CALLER = "test";
    const created = await createAdminClient().rpc("create_ai_practice_session", {
      p_institution_id: inst.institutionId,
      p_student_id: fx.studentId,
      p_curriculum_unit_id: fx.unitId,
      p_difficulty: "medium",
      p_questions: [
        { stem: "1+1?", options: ["1", "2", "3", "4"], answerIndex: 1, explanation: "One and one." },
        { stem: "2+1?", options: ["1", "2", "3", "4"], answerIndex: 2 },
      ],
    });
    expect(created.error).toBeNull();
    const session = created.data as Session;
    expect(JSON.stringify(session)).not.toContain("answerIndex");
    expect(JSON.stringify(session)).not.toContain("One and one");
    const res = await inst.clientAs("student").rpc("submit_practice_session", { p_session_id: session.sessionId, p_answers: ["2", "4"] });
    expect(res.error).toBeNull();
    expect((res.data as Submitted).score).toBe(1);
    expect((res.data as Submitted).results[1]).toMatchObject({ correct: false, answer: "3" });
  });
});

describe("learning analytics scope (0151)", () => {
  it("teacher sees only sections they teach the subject in; another school's owner sees nothing", async () => {
    const teacher = inst.clientAs("teacher");
    const a = await teacher.rpc("learning_section_topic_rows", { p_class_section_id: fx.sectionA, p_subject_id: fx.subjectId });
    expect(a.error).toBeNull();
    expect((a.data as { student_id: string }[]).map((r) => r.student_id)).toContain(fx.studentId);
    expect((a.data as { student_id: string }[]).map((r) => r.student_id)).not.toContain(fx.peerId);
    expect((await teacher.rpc("learning_section_topic_rows", { p_class_section_id: fx.sectionB, p_subject_id: fx.subjectId })).error?.message).toBe("code:forbidden");
    expect((await teacher.rpc("learning_test_section_rows", { p_test_id: fx.testId, p_class_section_id: fx.sectionB })).error?.message).toBe("code:forbidden");
    expect((await inst.clientAs("principal").rpc("learning_section_topic_rows", { p_class_section_id: fx.sectionB, p_subject_id: fx.subjectId })).error).toBeNull();
    expect((await other.clientAs("owner").rpc("learning_section_topic_rows", { p_class_section_id: fx.sectionA, p_subject_id: fx.subjectId })).error?.message).toBe("code:forbidden");
    expect((await other.clientAs("owner").rpc("learning_test_section_rows", { p_test_id: fx.testId, p_class_section_id: fx.sectionA })).error?.message).toBe("code:not_found");
    for (const role of ["student", "guardian"] as const) {
      expect((await inst.clientAs(role).rpc("learning_section_topic_rows", { p_class_section_id: fx.sectionA, p_subject_id: fx.subjectId })).error?.message, role).toBe(
        "code:forbidden",
      );
    }
  });

  it("question-wise rows for one section give per-question results and the common wrong answer", async () => {
    const r = await callAs(inst, "teacher", (await import("@/modules/learning/query-defs")).learningTestQuestionsQuery, {
      testId: fx.testId,
      classSectionId: fx.sectionA,
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.data.submitted).toBe(1);
    expect(r.data.questions[0]).toMatchObject({ percentCorrect: 0, commonWrong: [{ answer: "2", count: 1 }] });
  });

  it("student and linked guardian read own data; nobody else does", async () => {
    for (const role of ["student", "guardian"] as const) {
      const r = await inst.clientAs(role).rpc("learning_student_topic_rows", { p_student_id: fx.studentId });
      expect(r.error, role).toBeNull();
      expect((r.data as { tests: number }[]).some((x) => x.tests === 1), role).toBe(true);
    }
    expect((await inst.clientAs("student").rpc("learning_student_topic_rows", { p_student_id: fx.peerId })).error?.message).toBe("code:forbidden");
    expect((await inst.clientAs("teacher").rpc("learning_student_topic_rows", { p_student_id: fx.studentId })).error?.message).toBe("code:forbidden");
    expect((await other.clientAs("guardian").rpc("learning_progress", { p_student_id: fx.studentId })).error?.message).toBe("code:forbidden");
    expect((await other.clientAs("guardian").rpc("practice_bank_counts", { p_student_id: fx.studentId })).error?.message).toBe("code:forbidden");
    const progress = await inst.clientAs("guardian").rpc("learning_progress", { p_student_id: fx.studentId });
    expect((progress.data as { source: string; percent: number }[]).find((w) => w.source === "test")?.percent).toBe(0);
  });

  it("students see a test only once its results are released; the teacher always does", async () => {
    await sql`update public.online_tests set status = 'closed' where id = ${fx.testId}`;
    try {
      const own = await inst.clientAs("student").rpc("learning_student_topic_rows", { p_student_id: fx.studentId });
      expect((own.data as { tests: number }[]).every((x) => x.tests === 0)).toBe(true);
      const teacher = await inst.clientAs("teacher").rpc("learning_section_topic_rows", { p_class_section_id: fx.sectionA, p_subject_id: fx.subjectId });
      expect((teacher.data as { tests: number }[]).some((x) => x.tests === 1)).toBe(true);
    } finally {
      await sql`update public.online_tests set status = 'published' where id = ${fx.testId}`;
    }
  });

  it("compute_mastery takes released online-test results as evidence (marks untouched)", async () => {
    await sql`select public.compute_mastery(${inst.institutionId})`;
    const [m] = await sql`select score, test_count, mark_count from public.mastery_snapshots where student_id = ${fx.studentId} and curriculum_unit_id = ${fx.unitId}`;
    expect(m).toMatchObject({ test_count: 1, mark_count: 0 });
    expect(Number(m.score)).toBe(0);
    const [peer] = await sql`select score from public.mastery_snapshots where student_id = ${fx.peerId} and curriculum_unit_id = ${fx.unitId}`;
    expect(Number(peer.score)).toBe(1);
    expect((await sql`select count(*)::int as n from public.marks where institution_id = ${inst.institutionId}`)[0].n).toBe(0);
  });

  it("the student's weak topics come with evidence and a bank practice step; section gaps flag the topic", async () => {
    const mine = await callAs(inst, "student", learningMyWeakTopicsQuery, {});
    expect(mine.ok, JSON.stringify(mine)).toBe(true);
    if (!mine.ok) return;
    const area = mine.data.areas.find((a) => a.unitId === fx.unitId);
    expect(area).toBeDefined();
    expect(area!.next.practice).toBe("bank");
    expect(area!.evidence.tests).toBeGreaterThanOrEqual(1);

    const gaps = await callAs(inst, "teacher", learningSectionGapsQuery, { classSectionId: fx.sectionA, subjectId: fx.subjectId });
    expect(gaps.ok, JSON.stringify(gaps)).toBe(true);
    if (gaps.ok) expect(gaps.data.units[0]).toMatchObject({ unitId: fx.unitId, unitTitle: "Fractions" });
    const denied = await callAs(inst, "teacher", learningSectionGapsQuery, { classSectionId: fx.sectionB, subjectId: fx.subjectId });
    expect(!denied.ok && denied.error.code).toBe("forbidden");
  });
});

describe("security review fixes (0151)", () => {
  const pool = async () =>
    (await sql`select id from app.practice_pool(${inst.institutionId}, ${fx.studentId})`).map((r) => r.id as string);
  const closeOpen = () => sql`update public.practice_sessions set expires_at = now() where student_id = ${fx.studentId} and submitted_at is null`;

  async function paperWith(questionId: string, over: Record<string, unknown> = {}) {
    const [paper] = await sql`
      insert into public.question_papers ${sql({
        institution_id: inst.institutionId,
        academic_year_id: fx.yearId,
        grade_id: fx.gradeId,
        subject_id: fx.subjectId,
        title: "Exam paper",
        total_marks: 10,
        created_by: fx.teacherUser,
        ...over,
      } as never)} returning id`;
    const [sec] = await sql`insert into public.question_paper_sections (institution_id, paper_id, title, position) values (${inst.institutionId}, ${paper.id}, 'A', 0) returning id`;
    const [item] = await sql`insert into public.question_paper_items (institution_id, paper_id, section_id, position, type, body, options, answer, marks, difficulty, source_question_id)
      values (${inst.institutionId}, ${paper.id}, ${sec.id}, 0, 'mcq', 'Held', ${sql.json(["3", "4"])}, '4', 1, 'easy', ${questionId}) returning id`;
    return { paperId: paper.id as string, itemId: item.id as string };
  }

  let termSeq = 10;
  async function examPaper(status: string, heldOn: string) {
    const termId = await createTerm(inst.institutionId, fx.yearId, { name: `T-${crypto.randomUUID().slice(0, 6)}`, sequence: termSeq++ });
    const [exam] = await sql`insert into public.exams (institution_id, academic_year_id, term_id, name, type, status)
      values (${inst.institutionId}, ${fx.yearId}, ${termId}, ${`Exam ${crypto.randomUUID().slice(0, 6)}`}, 'unit_test', ${status}) returning id`;
    const [ep] = await sql`insert into public.exam_papers (institution_id, exam_id, class_section_id, subject_id, max_marks, pass_marks, held_on)
      values (${inst.institutionId}, ${exam.id}, ${fx.sectionA}, ${fx.subjectId}, 10, 0, ${heldOn}) returning id`;
    return { examId: exam.id as string, examPaperId: ep.id as string };
  }

  it("H1: admin gets no test analytics; nobody gets the paper's answers, keys or marking scheme", async () => {
    expect((await inst.clientAs("admin").rpc("learning_test_section_rows", { p_test_id: fx.testId, p_class_section_id: fx.sectionA })).error?.message).toBe("code:forbidden");
    expect((await inst.clientAs("admin").rpc("learning_section_topic_rows", { p_class_section_id: fx.sectionA, p_subject_id: fx.subjectId })).error?.message).toBe("code:forbidden");
    for (const role of ["principal", "teacher"] as const) {
      const r = await inst.clientAs(role).rpc("learning_test_section_rows", { p_test_id: fx.testId, p_class_section_id: fx.sectionA });
      expect(r.error, role).toBeNull();
      const snap = JSON.stringify((r.data as { snapshot: unknown }).snapshot);
      expect(snap, role).toContain("Half of 8?");
      for (const k of ['"answer"', '"answer_key"', '"marking_scheme"', '"explanation"', '"options"']) expect(snap, `${role} ${k}`).not.toContain(k);
    }
  });

  it("H2: a question stays out of practice while its paper's exam is ahead, even after the paper item is edited", async () => {
    const upcoming = await bankQuestion();
    const { itemId } = await paperWith(upcoming, { exam_date: "2099-01-01" });
    // The teacher edits the item: source_question_id is cleared, the lineage is not.
    const edit = await inst.clientAs("teacher").from("question_paper_items").update({ source_question_id: null, body: "Edited" }).eq("id", itemId).select("id");
    expect(edit.error).toBeNull();
    expect(edit.data).toHaveLength(1);
    const [row] = await sql`select source_question_id, derived_from_question_id from public.question_paper_items where id = ${itemId}`;
    expect(row).toEqual({ source_question_id: null, derived_from_question_id: upcoming });
    // Lineage is not client-writable.
    expect((await inst.clientAs("teacher").from("question_paper_items").update({ derived_from_question_id: null } as never).eq("id", itemId)).error).not.toBeNull();
    expect(await pool()).not.toContain(upcoming);

    // Published paper, exam held but results not published yet: still held.
    const notPublished = await bankQuestion();
    const ep1 = await examPaper("marks_entry", "2020-01-01");
    await paperWith(notPublished, { status: "published", current_version: 1, exam_id: ep1.examId, exam_paper_id: ep1.examPaperId });
    // Exam held and published: free for practice.
    const over = await bankQuestion();
    const ep2 = await examPaper("published", "2020-01-01");
    await paperWith(over, { status: "published", current_version: 1, exam_id: ep2.examId, exam_paper_id: ep2.examPaperId });
    // No exam link: held until the paper's date has passed.
    const past = await bankQuestion();
    await paperWith(past, { exam_date: "2020-01-01" });
    const undated = await bankQuestion();
    await paperWith(undated);
    // Archived paper releases its questions.
    const archived = await bankQuestion();
    await paperWith(archived, { status: "archived" });

    const ids = await pool();
    expect(ids).not.toContain(notPublished);
    expect(ids).not.toContain(undated);
    expect(ids).toContain(over);
    expect(ids).toContain(past);
    expect(ids).toContain(archived);
  });

  it("H2: a question in an online test that has not closed stays out of practice", async () => {
    const q = await bankQuestion();
    const { paperId } = await paperWith(q, { status: "archived", current_version: 1 });
    await sql`insert into public.question_paper_versions (institution_id, paper_id, version_no, snapshot, reason)
      values (${inst.institutionId}, ${paperId}, 1, ${sql.json({ paper: { id: paperId }, sections: [] } as never)}, 'approved')`;
    const [t] = await sql`
      insert into public.online_tests (institution_id, question_paper_id, paper_version_no, grade_id, subject_id, title, section_ids, opens_at, closes_at, duration_minutes, status, created_by)
      values (${inst.institutionId}, ${paperId}, 1, ${fx.gradeId}, ${fx.subjectId}, 'Soon', ${[fx.sectionA]}, now() + interval '1 day', now() + interval '2 days', 30, 'draft', ${fx.teacherUser})
      returning id`;
    expect(await pool()).not.toContain(q);
    await sql`update public.online_tests set status = 'cancelled' where id = ${t.id}`;
    expect(await pool()).toContain(q);
  });

  it("M3: practice_allowed = false keeps a question out; a teacher can turn it off on an approved AI question", async () => {
    const q = await bankQuestion({ origin: "ai" });
    expect(await pool()).toContain(q);
    const { setPracticeAllowed } = await import("@/modules/question-bank/actions");
    expect(await callAs(inst, "teacher", setPracticeAllowed, { id: q, practiceAllowed: false })).toMatchObject({ ok: true });
    expect(await pool()).not.toContain(q);
    expect(await callAs(inst, "student", setPracticeAllowed, { id: q, practiceAllowed: true })).toMatchObject({ ok: false, error: { code: "forbidden" } });
    // Content of the approved AI row stays locked for the teacher.
    expect((await inst.clientAs("teacher").from("question_bank").update({ body: "Changed" }).eq("id", q)).error?.message).toBe("code:forbidden");
  });

  it("M3: an open set is resumed, a different set supersedes it, and sets are capped per day", async () => {
    await closeOpen();
    const first = (await start("student")).data as Session & { resumed: boolean };
    expect(first.resumed).toBe(false);
    const again = await start("student");
    expect(again.error).toBeNull();
    expect(again.data).toMatchObject({ sessionId: first.sessionId, resumed: true });
    const open = await sql`select count(*)::int as n from public.practice_sessions where student_id = ${fx.studentId} and submitted_at is null and expires_at > now()`;
    expect(open[0].n).toBe(1);

    const other = (await start("student", { p_difficulty: "easy" })).data as Session;
    expect(other.sessionId).not.toBe(first.sessionId);
    const stale = await inst.clientAs("student").rpc("submit_practice_session", { p_session_id: first.sessionId, p_answers: first.questions.map(() => null) });
    expect(stale.error?.message).toBe("code:invalid_state");

    await closeOpen();
    const [{ n }] = await sql`select count(*)::int as n from public.practice_sessions where student_id = ${fx.studentId} and created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'`;
    const filler = Array.from({ length: Math.max(0, 30 - n) }, () => ({
      institution_id: inst.institutionId,
      student_id: fx.studentId,
      subject_id: fx.subjectId,
      curriculum_unit_id: fx.unitId,
      source: "bank",
      difficulty: "easy",
      items: sql.json([{ key: crypto.randomUUID(), type: "mcq", body: "x", options: ["a"], marks: 1, answer: "a" }] as never),
      expires_at: new Date(),
    }));
    const ids = filler.length ? (await sql`insert into public.practice_sessions ${sql(filler as never)} returning id`).map((r) => r.id as string) : [];
    try {
      expect((await start("student")).error?.message).toBe("code:rate_limited");
      process.env.SERVICE_ROLE_CALLER = "test";
      const ai = await createAdminClient().rpc("create_ai_practice_session", {
        p_institution_id: inst.institutionId,
        p_student_id: fx.studentId,
        p_curriculum_unit_id: fx.unitId,
        p_difficulty: "easy",
        p_questions: [{ stem: "1+1?", options: ["1", "2", "3", "4"], answerIndex: 1 }],
      });
      expect(ai.error?.message).toBe("code:rate_limited");
    } finally {
      if (ids.length) await sql`delete from public.practice_sessions where id = any(${ids})`;
    }
  });
});
