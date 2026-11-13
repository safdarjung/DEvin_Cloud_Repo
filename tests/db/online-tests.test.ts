import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import {
  closeTest,
  createTest,
  finaliseAttempt,
  publishTestResults,
  pushToMarksEntry,
  saveMarks,
  saveResponse,
  scheduleTest,
  startAttempt,
  submitAttempt,
  updateTest,
} from "@/modules/online-tests/actions";
import {
  onlineTestsAnalyticsQuery,
  onlineTestsGetQuery,
  onlineTestsMarkingQueueQuery,
  onlineTestsResultQuery,
} from "@/modules/online-tests/query-defs";
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

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

interface Fixture {
  yearId: string;
  subjectId: string;
  sectionA: string;
  sectionB: string;
  paperId: string;
  examId: string;
  examPaperId: string;
  studentId: string;
  keys: Record<string, string>;
}

let inst: TestInstitution;
let other: TestInstitution;
let fx: Fixture;

function must<T>(r: { ok: true; data: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.data;
}

const iso = (minutesFromNow: number) => new Date(Date.now() + minutesFromNow * 60_000).toISOString();

// 14 marks, negative 0.25. A: six objective types (1+1+2+2+2+2). B: two written
// answers, attempt any 1 (3). C: an OR pair of MCQs (1).
const ITEMS = [
  { k: "mcq", section: 0, type: "mcq", marks: 1, options: ["2", "3", "4", "5"], answer: "4" },
  { k: "tf", section: 0, type: "true_false", marks: 1, answer: "true" },
  { k: "multi", section: 0, type: "multi_select", marks: 2, options: ["a", "b", "c", "d"], answer_key: ["a", "c"] },
  { k: "fill", section: 0, type: "fill_blank", marks: 2, body: "Capital of India ___ and of France ___", answer_key: ["Delhi|New Delhi", "Paris"] },
  { k: "num", section: 0, type: "numerical", marks: 2, answer_key: { value: 9.8, tolerance: 0.1 } },
  { k: "match", section: 0, type: "match", marks: 2, options: { left: ["x", "y"], right: ["p", "q"] }, answer_key: [1, 0] },
  { k: "essay1", section: 1, type: "short_answer", marks: 3, answer: "Photosynthesis makes food.", marking_scheme: "1 mark per point." },
  { k: "essay2", section: 1, type: "short_answer", marks: 3, answer: "Respiration releases energy." },
  { k: "orA", section: 2, type: "mcq", marks: 1, options: ["1", "2"], answer: "1", choice_group: 1 },
  { k: "orB", section: 2, type: "mcq", marks: 1, options: ["1", "2"], answer: "2", choice_group: 1 },
] as const;

async function buildFixture(): Promise<Fixture> {
  const id = inst.institutionId;
  const yearId = await createAcademicYear(id);
  const termId = await createTerm(id, yearId);
  const gradeId = await createGrade(id);
  const sectionA = await createClassSection(id, gradeId, yearId, { name: "A" });
  const sectionB = await createClassSection(id, gradeId, yearId, { name: "B" });
  const subjectId = await createSubject(id, { code: "SCI" });
  const [teacher] = await sql`select user_id, staff_id from public.memberships where institution_id = ${id} and role = 'teacher'`;
  await createSubjectAssignment(id, sectionA, subjectId, teacher.staff_id as string);
  await createSubjectAssignment(id, sectionB, subjectId, teacher.staff_id as string);
  const [student] = await sql`select student_id from public.memberships where institution_id = ${id} and role = 'student'`;
  const studentId = student.student_id as string;
  await createEnrolment(id, studentId, sectionA, yearId);
  const [guardian] = await sql`select guardian_id from public.memberships where institution_id = ${id} and role = 'guardian'`;
  await sql`insert into public.guardian_students (institution_id, guardian_id, student_id, relationship) values (${id}, ${guardian.guardian_id}, ${studentId}, 'mother')`;

  const [exam] = await sql`
    insert into public.exams (institution_id, academic_year_id, term_id, name, type)
    values (${id}, ${yearId}, ${termId}, 'Unit Test 2', 'unit_test') returning id`;
  const [ep] = await sql`
    insert into public.exam_papers (institution_id, exam_id, class_section_id, subject_id, max_marks, pass_marks)
    values (${id}, ${exam.id}, ${sectionA}, ${subjectId}, 14, 5) returning id`;

  const [paper] = await sql`
    insert into public.question_papers (institution_id, academic_year_id, grade_id, subject_id, exam_id, exam_paper_id, title, total_marks, negative_marking, created_by)
    values (${id}, ${yearId}, ${gradeId}, ${subjectId}, ${exam.id}, ${ep.id}, 'Science online test', 14, 0.25, ${teacher.user_id})
    returning id`;
  const sections: string[] = [];
  for (const [i, chooseCount] of [null, 1, null].entries()) {
    const [s] = await sql`
      insert into public.question_paper_sections (institution_id, paper_id, title, position, choose_count)
      values (${id}, ${paper.id}, ${`Section ${i + 1}`}, ${i}, ${chooseCount}) returning id`;
    sections.push(s.id as string);
  }
  const keys: Record<string, string> = {};
  for (const [pos, it] of ITEMS.entries()) {
    const row = {
      institution_id: id,
      paper_id: paper.id,
      section_id: sections[it.section],
      position: pos,
      type: it.type,
      body: "body" in it ? it.body : `Question ${it.k}`,
      options: "options" in it ? sql.json(it.options as never) : null,
      answer: "answer" in it ? it.answer : null,
      answer_key: "answer_key" in it ? sql.json(it.answer_key as never) : null,
      marks: it.marks,
      marking_scheme: "marking_scheme" in it ? it.marking_scheme : null,
      explanation: `Why ${it.k}`,
      difficulty: "easy",
      choice_group: "choice_group" in it ? it.choice_group : null,
    };
    const [r] = await sql`insert into public.question_paper_items ${sql(row)} returning id`;
    keys[it.k] = r.id as string;
  }
  // Freeze version 1 exactly as transition_question_paper does (service path: no caller).
  await sql`
    insert into public.question_paper_versions (institution_id, paper_id, version_no, snapshot, reason)
    select p.institution_id, p.id, 1, jsonb_build_object(
      'paper', to_jsonb(p) - array['created_at', 'updated_at'],
      'sections', (select jsonb_agg((to_jsonb(s) - array['created_at', 'updated_at']) || jsonb_build_object('items', (
          select jsonb_agg(to_jsonb(i) - array['created_at', 'updated_at'] order by i.position) from public.question_paper_items i where i.section_id = s.id
        )) order by s.position) from public.question_paper_sections s where s.paper_id = p.id)
    ), 'approved'
    from public.question_papers p where p.id = ${paper.id}`;
  await sql`update public.question_papers set status = 'approved', current_version = 1 where id = ${paper.id}`;
  return { yearId, subjectId, sectionA, sectionB, paperId: paper.id as string, examId: exam.id as string, examPaperId: ep.id as string, studentId, keys };
}

async function newTest(over: Record<string, unknown> = {}, schedule = true): Promise<string> {
  const { id } = must(
    await callAs(inst, "teacher", createTest, {
      questionPaperId: fx.paperId,
      title: "Science test",
      sectionIds: [fx.sectionA],
      opensAt: iso(-5),
      closesAt: iso(60),
      durationMinutes: 30,
      ...over,
    }),
  );
  if (schedule) must(await callAs(inst, "teacher", scheduleTest, { id }));
  return id;
}

const start = async (testId: string) => must(await callAs(inst, "student", startAttempt, { testId }));
const save = (attemptId: string, k: string, answer: unknown) =>
  callAs(inst, "student", saveResponse, { attemptId, itemKey: fx.keys[k], answer: answer as string });

async function answerAll(attemptId: string): Promise<void> {
  const answers: [string, unknown][] = [
    ["mcq", "4"],
    ["tf", "false"],
    ["multi", ["c", "a"]],
    ["fill", [" new   delhi ", "PARIS"]],
    ["num", 9.75],
    ["match", [0, 1]],
    ["essay1", "Plants make food using sunlight."],
    ["orA", "2"],
    ["orB", "2"],
  ];
  for (const [k, a] of answers) must(await save(attemptId, k, a));
}

beforeAll(async () => {
  [inst, other] = await Promise.all([createTestInstitution("ot"), createTestInstitution("ot-other")]);
  fx = await buildFixture();
}, 90_000);

afterAll(async () => {
  await Promise.all([inst.cleanup(), other.cleanup()]);
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
}, 60_000);

describe("online tests — answer keys never reach a student", () => {
  it("student reads questions without answer, key, explanation or marking scheme, and has no table access to keys", async () => {
    const testId = await newTest();
    const { attemptId } = await start(testId);
    const student = inst.clientAs("student");
    const { data, error } = await student.rpc("get_test_for_attempt", { p_attempt_id: attemptId });
    expect(error).toBeNull();
    const text = JSON.stringify(data);
    for (const leak of ["answer_key", "marking_scheme", "explanation", "Why mcq", "Delhi|New Delhi", "Photosynthesis makes food", "9.8"]) {
      expect(text).not.toContain(leak);
    }
    expect((data as { sections: { items: unknown[] }[] }).sections.flatMap((s) => s.items)).toHaveLength(ITEMS.length);

    for (const table of ["question_paper_versions", "question_paper_items", "test_responses"] as const) {
      const r = await student.from(table).select("*");
      expect(r.data ?? []).toEqual([]);
    }
    // Another student's attempt (other school) is not found.
    const theirs = await other.clientAs("student").rpc("get_test_for_attempt", { p_attempt_id: attemptId });
    expect(theirs.error?.message).toBe("code:not_found");
    must(await callAs(inst, "student", submitAttempt, { attemptId }));
  });

  it("the result hides scores until release and correct answers until the answer policy allows", async () => {
    const testId = await newTest({ practice: true, showResults: "after_close", showAnswers: "after_publish" });
    const { attemptId } = await start(testId);
    must(await save(attemptId, "mcq", "3"));
    must(await callAs(inst, "student", submitAttempt, { attemptId }));
    const early = await callAs(inst, "student", onlineTestsResultQuery, { attemptId });
    expect(early).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    expect((await inst.clientAs("student").from("test_attempts").select("total_score").eq("id", attemptId)).data).toEqual([]);

    must(await callAs(inst, "teacher", closeTest, { id: testId }));
    const result = must(await callAs(inst, "student", onlineTestsResultQuery, { attemptId }));
    expect(result.answersShown).toBe(false);
    expect(result.items.every((i) => i.correctAnswer === null && i.explanation === null)).toBe(true);
    expect(result.items.find((i) => i.key === fx.keys.mcq)).toMatchObject({ awarded: -0.25, correct: false });
  });
});

describe("online tests — window, assignment and attempts", () => {
  it("cannot start before the window, after it, in an unassigned section, or a draft", async () => {
    const future = await newTest({ opensAt: iso(30), closesAt: iso(90) });
    expect(await callAs(inst, "student", startAttempt, { testId: future })).toMatchObject({ ok: false, error: { code: "invalid_state" } });

    const past = await newTest({ opensAt: iso(-90), closesAt: iso(60) });
    await sql`update public.online_tests set closes_at = now() - interval '1 minute' where id = ${past}`;
    expect(await callAs(inst, "student", startAttempt, { testId: past })).toMatchObject({ ok: false, error: { code: "invalid_state" } });

    const sectionB = await newTest({ sectionIds: [fx.sectionB] });
    expect(await callAs(inst, "student", startAttempt, { testId: sectionB })).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect((await inst.clientAs("student").from("online_tests").select("id").eq("id", sectionB)).data).toEqual([]);

    const draft = await newTest({}, false);
    expect(await callAs(inst, "student", startAttempt, { testId: draft })).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await other.clientAs("student").rpc("start_test_attempt", { p_test_id: draft })).toMatchObject({ error: { message: "code:not_found" } });
  });

  it("a reload resumes the open attempt; the attempt limit holds after submit", async () => {
    const testId = await newTest({ maxAttempts: 1 });
    const first = await start(testId);
    const again = await start(testId);
    expect(again).toMatchObject({ attemptId: first.attemptId, resumed: true });
    expect(Date.parse(first.deadline) - Date.parse(first.serverNow)).toBeLessThanOrEqual(30 * 60_000 + 1000);
    must(await callAs(inst, "student", submitAttempt, { attemptId: first.attemptId }));
    expect(await callAs(inst, "student", startAttempt, { testId })).toMatchObject({ ok: false, error: { code: "invalid_state" } });
  });

  it("deadline is capped by the closing time", async () => {
    const testId = await newTest({ closesAt: iso(10), durationMinutes: 60 });
    const { attemptId } = await start(testId);
    const [row] = await sql`select a.deadline = t.closes_at as capped from public.test_attempts a join public.online_tests t on t.id = a.test_id where a.id = ${attemptId}`;
    expect(row.capped).toBe(true);
  });

  it("a scheduled test freezes its paper, sections and timing; only the title, closing time and release change", async () => {
    const testId = await newTest();
    expect(await callAs(inst, "teacher", updateTest, { id: testId, durationMinutes: 90 })).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    must(await callAs(inst, "teacher", updateTest, { id: testId, title: "Renamed", showAnswers: "after_close" }));
    const { error } = await inst.clientAs("teacher").from("online_tests").update({ status: "published" } as never).eq("id", testId);
    expect(error).not.toBeNull();
  });
});

describe("online tests — timing", () => {
  it("save after the deadline is rejected and submits the attempt; repeat submit is idempotent", async () => {
    const testId = await newTest();
    const { attemptId } = await start(testId);
    must(await save(attemptId, "mcq", "4"));
    await sql`update public.test_attempts set deadline = now() - interval '31 seconds' where id = ${attemptId}`;
    expect(await save(attemptId, "tf", "true")).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    const [a] = await sql`select status, objective_score from public.test_attempts where id = ${attemptId}`;
    expect(a).toMatchObject({ status: "evaluated", objective_score: "1.00" });
    const [n] = await sql`select count(*)::int as n from public.test_responses where attempt_id = ${attemptId}`;
    expect(n.n).toBe(1);

    const one = must(await callAs(inst, "student", submitAttempt, { attemptId }));
    const two = must(await callAs(inst, "student", submitAttempt, { attemptId }));
    expect(two).toEqual(one);
    const [events] = await sql`select count(*)::int as n from public.test_events where attempt_id = ${attemptId} and kind in ('submit', 'auto_submit')`;
    expect(events.n).toBe(1);
  });

  it("within the 30 s grace a save still lands", async () => {
    const testId = await newTest();
    const { attemptId } = await start(testId);
    await sql`update public.test_attempts set deadline = now() - interval '10 seconds' where id = ${attemptId}`;
    must(await save(attemptId, "mcq", "4"));
  });

  it("the sweep auto-submits expired attempts and is service-role only", async () => {
    const testId = await newTest();
    const { attemptId } = await start(testId);
    await sql`update public.test_attempts set deadline = now() - interval '5 minutes' where id = ${attemptId}`;
    expect((await inst.clientAs("principal").rpc("auto_submit_expired_test_attempts")).error).not.toBeNull();
    await sql`select public.auto_submit_expired_test_attempts()`;
    const [a] = await sql`select status from public.test_attempts where id = ${attemptId}`;
    expect(a.status).toBe("evaluated"); // no written answer: evaluated at once
    const [e] = await sql`select kind from public.test_events where attempt_id = ${attemptId} and kind = 'auto_submit'`;
    expect(e.kind).toBe("auto_submit");
  });
});

describe("online tests — marking, scope and release", () => {
  let testId: string;
  let attemptId: string;

  beforeAll(async () => {
    testId = await newTest({ showResults: "after_publish", showAnswers: "after_publish" });
    ({ attemptId } = await start(testId));
    await answerAll(attemptId);
    must(await callAs(inst, "student", submitAttempt, { attemptId }));
  });

  it("objective marks: negative marking, normalised blanks, tolerance, best of an OR pair", async () => {
    const rows = await sql`select item_key, auto_marks from public.test_responses where attempt_id = ${attemptId}`;
    const by = Object.fromEntries(rows.map((r) => [r.item_key, r.auto_marks]));
    expect(by[fx.keys.mcq]).toBe("1.00");
    expect(by[fx.keys.tf]).toBe("-0.25");
    expect(by[fx.keys.multi]).toBe("2.00");
    expect(by[fx.keys.fill]).toBe("2.00");
    expect(by[fx.keys.num]).toBe("2.00");
    expect(by[fx.keys.match]).toBe("-0.25");
    expect(by[fx.keys.essay1]).toBeNull();
    const [a] = await sql`select status, objective_score from public.test_attempts where id = ${attemptId}`;
    // 1 - 0.25 + 2 + 2 + 2 - 0.25 + best(orA -0.25, orB 1) = 7.5
    expect(a).toMatchObject({ status: "submitted", objective_score: "7.50" });
  });

  it("guardian and student see nothing before publish; another school's teacher cannot read or mark", async () => {
    expect(await callAs(inst, "guardian", onlineTestsResultQuery, { attemptId })).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    expect((await inst.clientAs("guardian").from("test_attempts").select("id").eq("id", attemptId)).data).toEqual([]);
    expect((await other.clientAs("teacher").from("test_attempts").select("id").eq("id", attemptId)).data).toEqual([]);
    expect((await other.clientAs("principal").from("online_tests").select("id").eq("id", testId)).data).toEqual([]);
    const [r] = await sql`select id from public.test_responses where attempt_id = ${attemptId} and item_key = ${fx.keys.essay1}`;
    expect(await other.clientAs("teacher").rpc("save_test_marks", { p_response_id: r.id, p_marks: 1 })).toMatchObject({ error: { message: "code:not_found" } });
    expect(await inst.clientAs("student").rpc("save_test_marks", { p_response_id: r.id, p_marks: 3 })).toMatchObject({ error: { message: "code:not_found" } });
  });

  it("an AI suggestion writes only ai_* columns; teacher marks need a human and stay within the item's marks", async () => {
    const queue = must(await callAs(inst, "teacher", onlineTestsMarkingQueueQuery, { testId }));
    const item = queue.items.find((i) => i.itemKey === fx.keys.essay1)!;
    expect(item).toMatchObject({ marks: 3, markingScheme: "1 mark per point.", teacherMarks: null });
    expect(queue.attempts[0]).toMatchObject({ attemptId, pending: 1 });

    const { error } = await inst.clientAs("teacher").rpc("save_test_ai_suggestion", { p_response_id: item.responseId, p_marks: 2, p_feedback: "Good start." });
    expect(error).toBeNull();
    const [r] = await sql`select ai_suggested_marks, ai_feedback, teacher_marks from public.test_responses where id = ${item.responseId}`;
    expect(r).toMatchObject({ ai_suggested_marks: "2.00", ai_feedback: "Good start.", teacher_marks: null });
    expect(await callAs(inst, "teacher", finaliseAttempt, { attemptId })).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    expect((await inst.clientAs("teacher").from("test_responses").update({ teacher_marks: 3 } as never).eq("id", item.responseId)).error).not.toBeNull();

    expect(await callAs(inst, "teacher", saveMarks, { responseId: item.responseId, marks: 3.5 })).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    must(await callAs(inst, "teacher", saveMarks, { responseId: item.responseId, marks: 2.5, feedback: "Name the pigment." }));
    expect(must(await callAs(inst, "teacher", finaliseAttempt, { attemptId }))).toEqual({ status: "evaluated", objective: 7.5, subjective: 2.5, total: 10 });
  });

  it("publish is exam office only and needs every attempt finalised; then guardian sees the child's result with answers", async () => {
    expect(await callAs(inst, "teacher", publishTestResults, { id: testId })).toMatchObject({ ok: false, error: { code: "forbidden" } });
    must(await callAs(inst, "teacher", closeTest, { id: testId }));
    must(await callAs(inst, "exam_controller", publishTestResults, { id: testId }));

    const result = must(await callAs(inst, "guardian", onlineTestsResultQuery, { attemptId }));
    expect(result).toMatchObject({ totalScore: 10, totalMarks: 14, answersShown: true });
    const essay = result.items.find((i) => i.key === fx.keys.essay1)!;
    expect(essay).toMatchObject({ awarded: 2.5, feedback: "Name the pigment." });
    expect(JSON.stringify(result)).not.toContain("Good start."); // AI feedback is never shown to families
    expect(result.items.find((i) => i.key === fx.keys.multi)?.correctAnswer).toEqual(["a", "c"]);
    expect((await inst.clientAs("guardian").from("test_attempts").select("id").eq("id", attemptId)).data).toHaveLength(1);
    expect(await other.clientAs("guardian").rpc("get_test_result", { p_attempt_id: attemptId })).toMatchObject({ error: { message: "code:not_found" } });

    const [r] = await sql`select id from public.test_responses where attempt_id = ${attemptId} and item_key = ${fx.keys.essay1}`;
    expect(await callAs(inst, "teacher", saveMarks, { responseId: r.id, marks: 3 })).toMatchObject({ ok: false, error: { code: "invalid_state" } });
  });

  it("analytics: average, per-question % and common wrong options", async () => {
    const stats = must(await callAs(inst, "teacher", onlineTestsAnalyticsQuery, { testId }));
    expect(stats).toMatchObject({ evaluated: 1, average: 10, highest: 10, lowest: 10, totalMarks: 14 });
    expect(stats.questions.find((q) => q.key === fx.keys.tf)).toMatchObject({ percentCorrect: 0, commonWrong: [{ answer: "false", count: 1 }] });
    expect(stats.hardest).toContain(fx.keys.tf);
  });

  it("pushToMarksEntry goes through enter_marks, versions marks, and a repeat push changes nothing", async () => {
    await sql`update public.exams set status = 'marks_entry' where id = ${fx.examId}`;
    const first = must(await callAs(inst, "teacher", pushToMarksEntry, { id: testId }));
    expect(first).toEqual({ papers: [{ sectionId: fx.sectionA, examPaperId: fx.examPaperId, entered: 1, unchanged: 0 }], notAttempted: 0, notEnrolled: [] });
    const marks = await sql`select marks_obtained, source, superseded_by from public.marks where exam_paper_id = ${fx.examPaperId} and student_id = ${fx.studentId}`;
    expect(marks).toEqual([{ marks_obtained: "10.00", source: "entry", superseded_by: null }]);
    const again = must(await callAs(inst, "teacher", pushToMarksEntry, { id: testId }));
    expect(again.papers[0]).toMatchObject({ entered: 0, unchanged: 1 });
    const [audit] = await sql`select count(*)::int as n from public.audit_events where entity_id = ${fx.examPaperId} and action = 'exam.marks.entered'`;
    expect(audit.n).toBe(2);
  });

  it("a practice test never reaches official marks", async () => {
    const practice = await newTest({ practice: true });
    must(await callAs(inst, "teacher", closeTest, { id: practice }));
    expect(await callAs(inst, "teacher", pushToMarksEntry, { id: practice })).toMatchObject({ ok: false, error: { code: "invalid_state" } });
  });
});

describe("online tests — security review fixes", () => {
  it("after_close: nothing is released during the grace after closing (H1)", async () => {
    const testId = await newTest({ practice: true, showResults: "after_close", showAnswers: "after_close" });
    const { attemptId } = await start(testId);
    await sql`update public.online_tests set closes_at = now() - interval '5 seconds' where id = ${testId}`;
    const [row] = await sql`select app.online_test_released(${testId}, 'results') as released`;
    expect(row.released).toBe(false);
    expect(await callAs(inst, "student", onlineTestsResultQuery, { attemptId })).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    must(await callAs(inst, "student", submitAttempt, { attemptId }));
  });

  it("a changed closing time clamps open deadlines; an unswept open attempt blocks release until it is submitted (H1)", async () => {
    const testId = await newTest({ practice: true, showResults: "after_close", showAnswers: "after_close" });
    const { attemptId } = await start(testId);
    must(await callAs(inst, "teacher", updateTest, { id: testId, closesAt: iso(5) }));
    const [c] = await sql`select a.deadline <= t.closes_at as clamped from public.test_attempts a join public.online_tests t on t.id = a.test_id where a.id = ${attemptId}`;
    expect(c.clamped).toBe(true);

    await sql`update public.online_tests set closes_at = now() - interval '1 minute' where id = ${testId}`;
    const [row] = await sql`select app.online_test_released(${testId}, 'results') as released`;
    expect(row.released).toBe(false);
    const result = must(await callAs(inst, "student", onlineTestsResultQuery, { attemptId }));
    expect(result.status).toBe("evaluated");
  });

  it("a test past its closing time cannot be reopened (M2)", async () => {
    const testId = await newTest();
    await sql`update public.online_tests set closes_at = now() - interval '1 minute' where id = ${testId}`;
    expect(await callAs(inst, "teacher", updateTest, { id: testId, closesAt: iso(60) })).toMatchObject({ ok: false, error: { code: "invalid_state" } });
  });

  it("autosave logs no event; resume and focus-lost stop at 500 events per attempt (M3)", async () => {
    const testId = await newTest();
    const { attemptId } = await start(testId);
    must(await save(attemptId, "mcq", "4"));
    const [saves] = await sql`select count(*)::int as n from public.test_events where attempt_id = ${attemptId} and kind = 'save'`;
    expect(saves.n).toBe(0);
    await sql`insert into public.test_events (institution_id, attempt_id, kind) select ${inst.institutionId}, ${attemptId}, 'focus_lost' from generate_series(1, 498)`;
    await start(testId);
    await start(testId);
    expect((await inst.clientAs("student").rpc("log_test_focus_lost", { p_attempt_id: attemptId })).error).toBeNull();
    const [all] = await sql`select count(*)::int as n from public.test_events where attempt_id = ${attemptId}`;
    expect(all.n).toBe(500);
    must(await callAs(inst, "student", submitAttempt, { attemptId }));
  });

  it("an exam test cannot release results at close; a practice test can (L1)", async () => {
    const base = { questionPaperId: fx.paperId, title: "T", sectionIds: [fx.sectionA], opensAt: iso(-5), closesAt: iso(60), durationMinutes: 30 };
    expect(await callAs(inst, "teacher", createTest, { ...base, showResults: "after_close" })).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    const draft = await newTest({}, false);
    const { error } = await inst.clientAs("teacher").from("online_tests").update({ show_results: "after_close" }).eq("id", draft);
    expect(error).not.toBeNull();
    must(await callAs(inst, "teacher", createTest, { ...base, practice: true, showResults: "after_close" }));
  });

  it("with show_answers 'never' a released result carries totals only (L2)", async () => {
    const testId = await newTest({ practice: true, showResults: "after_close", showAnswers: "never" });
    const { attemptId } = await start(testId);
    must(await save(attemptId, "mcq", "3"));
    must(await callAs(inst, "student", submitAttempt, { attemptId }));
    must(await callAs(inst, "teacher", closeTest, { id: testId }));
    const result = must(await callAs(inst, "student", onlineTestsResultQuery, { attemptId }));
    expect(result).toMatchObject({ answersShown: false, totalScore: 0, items: [] });
  });

  it("a teacher reads and marks only students of sections they teach the subject in (L3)", async () => {
    const { id: testId } = must(
      await callAs(inst, "exam_controller", createTest, {
        questionPaperId: fx.paperId, title: "Both sections", sectionIds: [fx.sectionA, fx.sectionB], opensAt: iso(-5), closesAt: iso(60), durationMinutes: 30,
      }),
    );
    must(await callAs(inst, "exam_controller", scheduleTest, { id: testId }));
    const { attemptId } = await start(testId);
    must(await save(attemptId, "essay1", "Some answer."));
    must(await callAs(inst, "student", submitAttempt, { attemptId }));
    const [sa] = await sql`delete from public.subject_assignments where class_section_id = ${fx.sectionA} and subject_id = ${fx.subjectId} returning teacher_id`;
    try {
      const teacher = inst.clientAs("teacher");
      expect((await teacher.from("test_attempts").select("id").eq("id", attemptId)).data).toEqual([]);
      expect((await teacher.from("test_responses").select("id").eq("attempt_id", attemptId)).data).toEqual([]);
      const [r] = await sql`select id from public.test_responses where attempt_id = ${attemptId} and item_key = ${fx.keys.essay1}`;
      expect(await teacher.rpc("save_test_marks", { p_response_id: r.id, p_marks: 1 })).toMatchObject({ error: { message: "code:not_found" } });
      expect((await inst.clientAs("exam_controller").from("test_attempts").select("id").eq("id", attemptId)).data).toHaveLength(1);
    } finally {
      await createSubjectAssignment(inst.institutionId, fx.sectionA, fx.subjectId, sa.teacher_id as string);
    }
  });

  it("push pre-checks every section, lists unenrolled attempters, and flags a re-push after marks change (L4)", async () => {
    const id = inst.institutionId;
    await sql`update public.exams set status = 'marks_entry' where id = ${fx.examId}`;
    const testId = await newTest({ sectionIds: [fx.sectionA, fx.sectionB] });
    const { attemptId } = await start(testId);
    must(await save(attemptId, "mcq", "4"));
    must(await callAs(inst, "student", submitAttempt, { attemptId }));
    // A second student in section B (no login): an evaluated attempt written directly.
    const [s2] = await sql`insert into public.students (institution_id, admission_no, first_name, dob, gender) values (${id}, 'OT-2', 'Second', '2012-01-01', 'other') returning id`;
    const enrol2 = await createEnrolment(id, s2.id as string, fx.sectionB, fx.yearId);
    await sql`insert into public.test_attempts (institution_id, test_id, student_id, attempt_no, deadline, submitted_at, status, total_score) values (${id}, ${testId}, ${s2.id}, 1, now(), now(), 'evaluated', 5)`;
    must(await callAs(inst, "teacher", closeTest, { id: testId }));
    const marksOf = () => sql`select id, marks_obtained from public.marks where exam_paper_id = ${fx.examPaperId} and student_id = ${fx.studentId} and superseded_by is null`;
    const before = await marksOf();

    // Section B has no exam paper: nothing is written for section A either.
    const blocked = await callAs(inst, "teacher", pushToMarksEntry, { id: testId });
    expect(blocked).toMatchObject({ ok: false, error: { code: "invalid_state", fieldErrors: { [fx.sectionB]: [expect.any(String)] } } });
    expect(await marksOf()).toEqual(before);

    await sql`update public.enrolments set status = 'withdrawn' where id = ${enrol2}`;
    const pushed = must(await callAs(inst, "exam_controller", pushToMarksEntry, { id: testId }));
    expect(pushed).toMatchObject({ papers: [{ sectionId: fx.sectionA, examPaperId: fx.examPaperId, entered: 1 }], notAttempted: 0, notEnrolled: [{ studentId: s2.id }] });

    const fresh = must(await callAs(inst, "exam_controller", onlineTestsGetQuery, { id: testId }));
    expect(fresh.marksPushedAt).not.toBeNull();
    expect(fresh.needsRepush).toBe(false);
    await sql`update public.test_responses set marked_at = now() + interval '1 second' where attempt_id = ${attemptId}`;
    expect(must(await callAs(inst, "exam_controller", onlineTestsGetQuery, { id: testId })).needsRepush).toBe(true);
  });
});

describe("online tests — app.mark_test_item edge cases", () => {
  const mark = async (item: object, answer: unknown, negative = 0.5) => {
    const [r] = await sql`select app.mark_test_item(${sql.json(item as never)}::jsonb, ${answer === undefined ? null : sql.json(answer as never)}::jsonb, ${negative}) as m`;
    return r.m as string | null;
  };

  it("unanswered scores 0 (no negative); written items return null", async () => {
    expect(await mark({ type: "mcq", marks: 1, answer: "4" }, undefined)).toBe("0");
    expect(await mark({ type: "mcq", marks: 1, answer: "4" }, "  ")).toBe("0");
    expect(await mark({ type: "fill_blank", marks: 2, answer_key: ["a"] }, [""])).toBe("0");
    expect(await mark({ type: "long_answer", marks: 5, answer: "x" }, "anything")).toBeNull();
  });

  it("wrong shapes are wrong, never an error", async () => {
    expect(await mark({ type: "numerical", marks: 2, answer_key: { value: 3, tolerance: 0 } }, "three")).toBe("-0.5");
    expect(await mark({ type: "numerical", marks: 2, answer_key: { value: 3, tolerance: 0 } }, "3")).toBe("2");
    expect(await mark({ type: "fill_blank", marks: 2, answer_key: ["a", "b"] }, ["a"])).toBe("-0.5");
    expect(await mark({ type: "multi_select", marks: 2, answer_key: ["a", "c"] }, ["a"])).toBe("-0.5");
    expect(await mark({ type: "match", marks: 2, answer_key: [1, 0] }, "1,0")).toBe("-0.5");
    expect(await mark({ type: "assertion_reason", marks: 1, answer: "A" }, "a")).toBe("1");
  });
});
