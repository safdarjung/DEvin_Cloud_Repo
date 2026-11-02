// M11-T11 — acceptance over HTTP for question bank + exam schedule/report
// card (master-plan acceptance, M11-tasks.md Task 11). Dispatches through
// the real /api/v1/actions and /api/v1/query route handlers with real
// bearer tokens (real RLS) — mirrors tests/db/timetable-acceptance.test.ts
// and tests/db/documents-acceptance.test.ts (no @/lib/supabase/server mock;
// only next/headers + next/cache, same as those files).
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
import { DEFAULT_GRADING_BANDS } from "@/modules/exams/grade";
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
import { closeRolesHelper, createTestInstitution, type FixtureRole, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

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

function queryUrl(name: string, institution: string, input: unknown, format?: "html"): URL {
  const url = new URL(`http://localhost/api/v1/query/${name}`);
  url.searchParams.set("institution", institution);
  url.searchParams.set("input", JSON.stringify(input));
  if (format) url.searchParams.set("format", format);
  return url;
}

function dispatchQuery(
  name: string,
  institution: string,
  input: unknown,
  headers: Record<string, string>,
  format?: "html",
): Promise<Response> {
  return queryGet(new Request(queryUrl(name, institution, input, format), { headers }), {
    params: Promise.resolve({ name }),
  });
}

async function tokenFor(inst: TestInstitution, role: FixtureRole): Promise<string> {
  const { data, error } = await inst.clientAs(role).auth.getSession();
  if (error || !data.session) throw error ?? new Error(`no session for ${role}`);
  return data.session.access_token;
}

async function teacherStaffId(institutionId: string): Promise<string> {
  const [row] = await sql`select staff_id from public.memberships where institution_id = ${institutionId} and role = 'teacher'`;
  return row.staff_id as string;
}

/** Grading config publish_exam_results needs (mirrors tests/db/exams-publish.test.ts's setExamSettings). */
async function setExamSettings(institutionId: string): Promise<void> {
  const patch = {
    locale: { timezone: "Asia/Kolkata", currency: "INR" },
    exams: { pass_percentage: 33, grading_scales: { default: DEFAULT_GRADING_BANDS } },
  };
  await sql`
    update public.institutions
    set settings = settings || ${sql.json(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      patch as any,
    )}
    where id = ${institutionId}
  `;
}

async function createRoom(institutionId: string, name: string): Promise<string> {
  const [row] = await sql`insert into public.rooms (institution_id, name, capacity) values (${institutionId}, ${name}, 30) returning id`;
  return row.id as string;
}

/** Publishes a one-slot Monday timetable for `sectionId` in `roomId` at 09:00-09:40 (mirrors tests/db/exam-schedule-queries.test.ts's publishMondaySlot). */
async function publishMondaySlot(
  inst: TestInstitution,
  yearId: string,
  sectionId: string,
  subjectId: string,
  teacherId: string,
  roomId: string,
): Promise<void> {
  const [period] = await sql`
    insert into public.periods (institution_id, seq, name, starts_at, ends_at, is_break)
    values (${inst.institutionId}, 1, 'Period 1', '09:00', '09:40', false)
    returning id
  `;
  const [version] = await sql`
    insert into public.timetable_versions (institution_id, academic_year_id, name, created_by)
    values (${inst.institutionId}, ${yearId}, 'Term Timetable', ${inst.users.admin.id})
    returning id
  `;
  await sql`
    insert into public.timetable_slots (institution_id, version_id, class_section_id, teacher_id, subject_id, room_id, weekday, period_id)
    values (${inst.institutionId}, ${version.id}, ${sectionId}, ${teacherId}, ${subjectId}, ${roomId}, 1, ${period.id})
  `;
  const publish = await inst.clientAs("admin").rpc("publish_timetable", { p_version_id: version.id });
  if (publish.error) throw publish.error;
}

/** Enrols the fixture's own "student" and links the fixture's own "guardian" to it (own child). */
async function linkGuardianAndEnrolOwnChild(inst: TestInstitution, sectionId: string, yearId: string): Promise<string> {
  const [studentMembership] = await sql`
    select student_id from public.memberships where institution_id = ${inst.institutionId} and user_id = ${inst.users.student.id}
  `;
  const studentId = studentMembership.student_id as string;
  await createEnrolment(inst.institutionId, studentId, sectionId, yearId);
  await sql`update public.students set first_name = 'ReportCard', last_name = 'Child' where id = ${studentId}`;

  const [guardianMembership] = await sql`
    select guardian_id from public.memberships where institution_id = ${inst.institutionId} and user_id = ${inst.users.guardian.id}
  `;
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${inst.institutionId}, ${guardianMembership.guardian_id}, ${studentId}, 'father', true, true)
  `;
  return studentId;
}

/** A student in no family this guardian is linked to ("another family's child"). */
async function createUnlinkedStudent(inst: TestInstitution): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${inst.institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'Other', '2015-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

describe("M11-T11 acceptance over HTTP: question bank + exam schedule/conflicts + report card", () => {
  it(
    "teacher creates a question in scope; guardian/student direct-PostgREST blocked; exam_controller schedules a paper " +
      "into a room the published timetable uses (room_timetable_clash, exams.schedule shows it scheduled); " +
      "guardian reads own child's report card HTML, not another family's; teacher's questionBank.list is taught-scope only",
    async () => {
      const inst = await createTestInstitution("qb-schedule-acceptance");
      try {
        await setExamSettings(inst.institutionId);
        const yearId = await createAcademicYear(inst.institutionId);
        const termId = await createTerm(inst.institutionId, yearId, { sequence: 1 });
        const gradeId = await createGrade(inst.institutionId);
        const sectionId = await createClassSection(inst.institutionId, gradeId, yearId);
        const mathId = await createSubject(inst.institutionId, { code: "MATH", name: "Mathematics" });
        const subjectUntaught = await createSubject(inst.institutionId, { code: "SCI", name: "Science" });
        const teacherId = await teacherStaffId(inst.institutionId);
        await createSubjectAssignment(inst.institutionId, sectionId, mathId, teacherId);

        const studentA = await linkGuardianAndEnrolOwnChild(inst, sectionId, yearId);
        const studentB = await createUnlinkedStudent(inst);

        const adminAuth = { authorization: `Bearer ${await tokenFor(inst, "admin")}` };
        const teacherAuth = { authorization: `Bearer ${await tokenFor(inst, "teacher")}` };
        const examControllerAuth = { authorization: `Bearer ${await tokenFor(inst, "exam_controller")}` };
        const guardianAuth = { authorization: `Bearer ${await tokenFor(inst, "guardian")}` };
        void adminAuth;

        // --- questionBank.create: teacher in scope (own taught grade+subject) -> ok ---
        const teacherCreateRes = await dispatchAction(
          "questionBank.create",
          {
            institution: inst.slug,
            input: {
              subjectId: mathId,
              gradeId,
              type: "short_answer",
              difficulty: "easy",
              body: "Name the capital of India.",
              answer: "New Delhi",
              marks: 2,
            },
          },
          teacherAuth,
        );
        expect(teacherCreateRes.status).toBe(200);
        const teacherCreateBody = await teacherCreateRes.json();
        expect(teacherCreateBody.ok).toBe(true);
        const taughtQuestionId = teacherCreateBody.data.id as string;

        // A question outside the teacher's taught scope (exam_controller may create anywhere).
        const outOfScopeCreateRes = await dispatchAction(
          "questionBank.create",
          {
            institution: inst.slug,
            input: {
              subjectId: subjectUntaught,
              gradeId,
              type: "short_answer",
              difficulty: "easy",
              body: "Name a noble gas.",
              answer: "Helium",
              marks: 2,
            },
          },
          examControllerAuth,
        );
        expect(outOfScopeCreateRes.status).toBe(200);
        const outOfScopeCreateBody = await outOfScopeCreateRes.json();
        expect(outOfScopeCreateBody.ok).toBe(true);
        const untaughtQuestionId = outOfScopeCreateBody.data.id as string;

        // --- guardian/student direct PostgREST on question_bank: [] on select, error on insert ---
        const guardianSelect = await inst.clientAs("guardian").from("question_bank").select("id");
        expect(guardianSelect.error).toBeNull();
        expect(guardianSelect.data).toEqual([]);

        const guardianInsert = await inst.clientAs("guardian").from("question_bank").insert({
          institution_id: inst.institutionId,
          subject_id: mathId,
          grade_id: gradeId,
          type: "short_answer",
          body: "Guardian attempt.",
          answer: "x",
          marks: 1,
          created_by: inst.users.guardian.id,
        });
        expect(guardianInsert.error).not.toBeNull();

        const studentSelect = await inst.clientAs("student").from("question_bank").select("id");
        expect(studentSelect.error).toBeNull();
        expect(studentSelect.data).toEqual([]);

        const studentInsert = await inst.clientAs("student").from("question_bank").insert({
          institution_id: inst.institutionId,
          subject_id: mathId,
          grade_id: gradeId,
          type: "short_answer",
          body: "Student attempt.",
          answer: "x",
          marks: 1,
          created_by: inst.users.student.id,
        });
        expect(studentInsert.error).not.toBeNull();

        // --- questionBank.list: teacher sees taught scope only (their own question, not the untaught one) ---
        const teacherListRes = await dispatchQuery("questionBank.list", inst.slug, {}, teacherAuth);
        expect(teacherListRes.status).toBe(200);
        const teacherListBody = await teacherListRes.json();
        expect(teacherListBody.ok).toBe(true);
        const teacherListIds = (teacherListBody.data.items as Array<{ id: string }>).map((i) => i.id);
        expect(teacherListIds).toContain(taughtQuestionId);
        expect(teacherListIds).not.toContain(untaughtQuestionId);

        // --- exam schedule + conflicts: a paper scheduled into a room the published timetable uses ---
        const room = await createRoom(inst.institutionId, "Hall 1");
        await publishMondaySlot(inst, yearId, sectionId, mathId, teacherId, room);

        const examRes = await dispatchAction(
          "exam.create",
          { institution: inst.slug, input: { termId, name: "Sched Exam", type: "unit_test" } },
          examControllerAuth,
        );
        expect(examRes.status).toBe(200);
        const examBody = await examRes.json();
        expect(examBody.ok).toBe(true);
        const examId = examBody.data.id as string;

        const papersRes = await dispatchAction(
          "exam.papers.create",
          {
            institution: inst.slug,
            input: { examId, papers: [{ classSectionId: sectionId, subjectId: mathId, maxMarks: 80, passMarks: 26.4 }] },
          },
          examControllerAuth,
        );
        expect(papersRes.status).toBe(200);
        expect((await papersRes.json()).ok).toBe(true);
        const [paperRow] = await sql`select id from public.exam_papers where exam_id = ${examId}`;
        const paperId = paperRow.id as string;

        // Mon 2026-11-02 09:30 IST (04:00Z), 40 min, in the room the published
        // timetable uses Mon 09:00-09:40 -> room_timetable_clash.
        const scheduleRes = await dispatchAction(
          "exam.paper.schedule",
          {
            institution: inst.slug,
            input: { examId, papers: [{ paperId, scheduledAt: "2026-11-02T04:00:00Z", durationMinutes: 40, roomId: room }] },
          },
          examControllerAuth,
        );
        expect(scheduleRes.status).toBe(200);
        expect((await scheduleRes.json()).ok).toBe(true);

        const conflictsRes = await dispatchQuery("exams.scheduleConflicts", inst.slug, { examId }, examControllerAuth);
        expect(conflictsRes.status).toBe(200);
        const conflictsBody = await conflictsRes.json();
        expect(conflictsBody.ok).toBe(true);
        expect(
          (conflictsBody.data as Array<{ kind: string; exam_paper_id: string }>).some(
            (c) => c.kind === "room_timetable_clash" && c.exam_paper_id === paperId,
          ),
        ).toBe(true);

        const scheduleQueryRes = await dispatchQuery("exams.schedule", inst.slug, { examId }, examControllerAuth);
        expect(scheduleQueryRes.status).toBe(200);
        const scheduleQueryBody = await scheduleQueryRes.json();
        expect(scheduleQueryBody.ok).toBe(true);
        expect(scheduleQueryBody.data).toContainEqual(expect.objectContaining({ id: paperId, status: "scheduled" }));

        // --- report card HTML: a separate exam, marked and published for studentA only ---
        const reportExamRes = await dispatchAction(
          "exam.create",
          { institution: inst.slug, input: { termId, name: "Report Card Exam", type: "unit_test" } },
          examControllerAuth,
        );
        const reportExamBody = await reportExamRes.json();
        expect(reportExamBody.ok).toBe(true);
        const reportExamId = reportExamBody.data.id as string;

        const reportPapersRes = await dispatchAction(
          "exam.papers.create",
          {
            institution: inst.slug,
            input: {
              examId: reportExamId,
              papers: [{ classSectionId: sectionId, subjectId: mathId, maxMarks: 100, passMarks: 33 }],
            },
          },
          examControllerAuth,
        );
        expect((await reportPapersRes.json()).ok).toBe(true);
        const [reportPaperRow] = await sql`select id from public.exam_papers where exam_id = ${reportExamId}`;
        const reportPaperId = reportPaperRow.id as string;

        const openRes = await dispatchAction(
          "exam.marks_entry.open",
          { institution: inst.slug, input: { examId: reportExamId } },
          examControllerAuth,
        );
        expect((await openRes.json()).ok).toBe(true);

        const enterRes = await dispatchAction(
          "exam.marks.enter",
          {
            institution: inst.slug,
            input: { examPaperId: reportPaperId, marks: [{ studentId: studentA, marksObtained: 80, isAbsent: false }] },
          },
          teacherAuth,
        );
        expect((await enterRes.json()).ok).toBe(true);

        const closeRes = await dispatchAction(
          "exam.marks_entry.close",
          { institution: inst.slug, input: { examId: reportExamId } },
          examControllerAuth,
        );
        expect((await closeRes.json()).ok).toBe(true);

        const publishRes = await dispatchAction(
          "exam.result.publish",
          { institution: inst.slug, input: { examId: reportExamId } },
          examControllerAuth,
        );
        const publishBody = await publishRes.json();
        expect(publishBody).toMatchObject({ ok: true, data: { result_count: 1 } });

        // Guardian reads own child's report card -> 200 text/html with the child's name.
        const ownReportRes = await dispatchQuery(
          "exams.reportCardHtml",
          inst.slug,
          { examId: reportExamId, studentId: studentA },
          guardianAuth,
          "html",
        );
        expect(ownReportRes.status).toBe(200);
        expect(ownReportRes.headers.get("content-type")).toContain("text/html");
        const html = await ownReportRes.text();
        expect(html).toContain("ReportCard Child");

        // Guardian reads another family's child's report card -> 404.
        const otherReportRes = await dispatchQuery(
          "exams.reportCardHtml",
          inst.slug,
          { examId: reportExamId, studentId: studentB },
          guardianAuth,
          "html",
        );
        expect(otherReportRes.status).toBe(404);
      } finally {
        await inst.cleanup();
      }
    },
  );
});
