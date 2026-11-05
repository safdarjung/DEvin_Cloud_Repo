// X06-T9 — acceptance over HTTP for exam seating + admit cards (X06-tasks.md
// "Task 9"). Dispatches through the real /api/v1/actions and /api/v1/query
// route handlers with real bearer tokens (real RLS) — mirrors
// tests/db/timetable-acceptance.test.ts and
// tests/db/question-bank-schedule-acceptance.test.ts (no @/lib/supabase/server
// mock; only next/headers + next/cache).
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
import { MODULE_DISABLED_MESSAGE } from "@/lib/modules/catalog";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createEnrolment,
  createGrade,
  createSubject,
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

async function insertStudent(institutionId: string, admissionNo: string): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo}, 'Test Student', '2014-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

async function createRoom(institutionId: string, name: string, capacity: number): Promise<string> {
  const [row] = await sql`
    insert into public.rooms (institution_id, name, capacity)
    values (${institutionId}, ${name}, ${capacity})
    returning id
  `;
  return row.id as string;
}

async function createExam(institutionId: string, termId: string): Promise<string> {
  const [row] = await sql`
    insert into public.exams (institution_id, academic_year_id, term_id, name, type, status)
    values (
      ${institutionId},
      (select academic_year_id from public.terms where id = ${termId}),
      ${termId},
      ${`Exam-${crypto.randomUUID().slice(0, 8)}`},
      'unit_test',
      'draft'
    )
    returning id
  `;
  return row.id as string;
}

async function insertExamPaper(
  institutionId: string,
  examId: string,
  classSectionId: string,
  subjectId: string,
  scheduledAt: string,
): Promise<string> {
  const [row] = await sql`
    insert into public.exam_papers (institution_id, exam_id, class_section_id, subject_id, max_marks, pass_marks, scheduled_at, duration_minutes)
    values (${institutionId}, ${examId}, ${classSectionId}, ${subjectId}, 100, 33, ${scheduledAt}, 60)
    returning id
  `;
  return row.id as string;
}

/** Same as T2/T3/T5/T6/T8's cleanup: the "one current row" invariant is a plain partial unique index, not a deferrable trigger. */
async function cleanupSeatingFixture(institutionId: string): Promise<void> {
  await sql`delete from public.exam_seats where institution_id = ${institutionId}`;
  await sql`delete from public.exam_seating_plans where institution_id = ${institutionId} and superseded_by is not null`;
  await sql`delete from public.exam_seating_plans where institution_id = ${institutionId}`;
}

const FUTURE_SLOT = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
const PAST_SLOT = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

describe("X06-T9 exam seating acceptance over HTTP", () => {
  it(
    "exam_controller generates a two-grade slot into 2 rooms, too-few-seats conflicts, slots query shows the plan, " +
      "regenerate bumps the version, chartHtml/admitCardsHtml render, guardian sees only her own child's seat, " +
      "teacher and a module-off institution are forbidden, and a past slot is an invalid_state",
    async () => {
      const inst = await createTestInstitution("seating-acceptance");
      try {
        const yearId = await createAcademicYear(inst.institutionId);
        const termId = await createTerm(inst.institutionId, yearId);
        const subjectId = await createSubject(inst.institutionId);

        const gradeA = await createGrade(inst.institutionId, { code: "VI", sortKey: 6 });
        const gradeB = await createGrade(inst.institutionId, { code: "VII", sortKey: 7 });
        const sectionA = await createClassSection(inst.institutionId, gradeA, yearId, { name: "A" });
        const sectionB = await createClassSection(inst.institutionId, gradeB, yearId, { name: "A" });

        const examId = await createExam(inst.institutionId, termId);
        await insertExamPaper(inst.institutionId, examId, sectionA, subjectId, FUTURE_SLOT);
        await insertExamPaper(inst.institutionId, examId, sectionB, subjectId, FUTURE_SLOT);

        // 3 students per section = 6 students across 2 grades, needs 2 rooms (capacity 4 each).
        const sectionAStudents: string[] = [];
        for (let i = 1; i <= 3; i++) {
          const studentId = await insertStudent(inst.institutionId, `ADM-A-${crypto.randomUUID().slice(0, 8)}`);
          await createEnrolment(inst.institutionId, studentId, sectionA, yearId, { rollNo: i });
          sectionAStudents.push(studentId);
        }
        for (let i = 1; i <= 3; i++) {
          const studentId = await insertStudent(inst.institutionId, `ADM-B-${crypto.randomUUID().slice(0, 8)}`);
          await createEnrolment(inst.institutionId, studentId, sectionB, yearId, { rollNo: i });
        }

        const roomHall = await createRoom(inst.institutionId, "Hall A", 4);
        const roomSecond = await createRoom(inst.institutionId, "Room B", 4);

        const examControllerAuth = { authorization: `Bearer ${await tokenFor(inst, "exam_controller")}` };
        const teacherAuth = { authorization: `Bearer ${await tokenFor(inst, "teacher")}` };
        const guardianAuth = { authorization: `Bearer ${await tokenFor(inst, "guardian")}` };

        // --- too few seats (one room, capacity 4 < 6 students) -> 409 conflict, no plan written ---
        const tooFewRes = await dispatchAction(
          "examSeating.generate",
          { institution: inst.slug, input: { examId, slotStart: FUTURE_SLOT, rooms: [{ roomId: roomHall }] } },
          examControllerAuth,
        );
        expect(tooFewRes.status).toBe(409);
        const tooFewBody = await tooFewRes.json();
        expect(tooFewBody).toMatchObject({ ok: false, error: { code: "conflict" } });
        const [{ count: countAfterConflict }] = await sql`
          select count(*)::int from public.exam_seating_plans where exam_id = ${examId}
        `;
        expect(countAfterConflict).toBe(0);

        // --- exam_controller generates a two-grade slot into 2 rooms -> 200 ---
        const genRes = await dispatchAction(
          "examSeating.generate",
          {
            institution: inst.slug,
            input: { examId, slotStart: FUTURE_SLOT, rooms: [{ roomId: roomHall }, { roomId: roomSecond }] },
          },
          examControllerAuth,
        );
        expect(genRes.status).toBe(200);
        const genBody = await genRes.json();
        expect(genBody).toMatchObject({ ok: true, data: { versionNo: 1, seatCount: 6 } });

        // --- GET examSeating.slots shows the plan, stale: false ---
        const slotsRes = await dispatchQuery("examSeating.slots", inst.slug, { examId }, examControllerAuth);
        expect(slotsRes.status).toBe(200);
        const slotsBody = await slotsRes.json();
        expect(slotsBody.ok).toBe(true);
        expect(slotsBody.data).toHaveLength(1);
        expect(slotsBody.data[0]).toMatchObject({
          studentCount: 6,
          plan: { versionNo: 1, seatCount: 6, stale: false },
        });

        // --- regenerate -> version 2 ---
        const regenRes = await dispatchAction(
          "examSeating.generate",
          {
            institution: inst.slug,
            input: { examId, slotStart: FUTURE_SLOT, rooms: [{ roomId: roomHall }, { roomId: roomSecond }] },
          },
          examControllerAuth,
        );
        expect(regenRes.status).toBe(200);
        const regenBody = await regenRes.json();
        expect(regenBody).toMatchObject({ ok: true, data: { versionNo: 2, seatCount: 6 } });
        const planId2 = regenBody.data.planId as string;

        // --- examSeating.chartHtml?format=html -> 200 text/html with both room names ---
        const chartRes = await dispatchQuery(
          "examSeating.chartHtml",
          inst.slug,
          { planId: planId2 },
          examControllerAuth,
          "html",
        );
        expect(chartRes.status).toBe(200);
        expect(chartRes.headers.get("content-type")).toContain("text/html");
        const chartHtml = await chartRes.text();
        expect(chartHtml).toContain("Hall A");
        expect(chartHtml).toContain("Room B");

        // --- examSeating.admitCardsHtml?format=html for sectionA -> one card per student ---
        const cardsRes = await dispatchQuery(
          "examSeating.admitCardsHtml",
          inst.slug,
          { examId, classSectionId: sectionA },
          examControllerAuth,
          "html",
        );
        expect(cardsRes.status).toBe(200);
        expect(cardsRes.headers.get("content-type")).toContain("text/html");
        const cardsHtml = await cardsRes.text();
        expect(cardsHtml.match(/<section class="page">/g)).toHaveLength(3);

        // --- guardian: own child -> room + seat of version 2; another child -> [] ---
        const ownChild = sectionAStudents[0];
        const otherChild = sectionAStudents[1];
        const [guardianMembership] = await sql`
          select guardian_id from public.memberships where institution_id = ${inst.institutionId} and user_id = ${inst.users.guardian.id}
        `;
        await sql`
          insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
          values (${inst.institutionId}, ${guardianMembership.guardian_id}, ${ownChild}, 'father', true, true)
        `;
        const [ownSeatRow] = await sql`
          select seat_no, room_id from public.exam_seats where plan_id = ${planId2} and student_id = ${ownChild}
        `;

        const ownSeatRes = await dispatchQuery(
          "examSeating.studentSeats",
          inst.slug,
          { studentId: ownChild },
          guardianAuth,
        );
        expect(ownSeatRes.status).toBe(200);
        const ownSeatBody = await ownSeatRes.json();
        expect(ownSeatBody.data).toHaveLength(1);
        expect(ownSeatBody.data[0]).toMatchObject({ planId: planId2, seatNo: ownSeatRow.seat_no, room: { id: ownSeatRow.room_id } });

        const otherSeatRes = await dispatchQuery(
          "examSeating.studentSeats",
          inst.slug,
          { studentId: otherChild },
          guardianAuth,
        );
        expect(otherSeatRes.status).toBe(200);
        const otherSeatBody = await otherSeatRes.json();
        expect(otherSeatBody.data).toEqual([]);

        // --- teacher lacks exam.manage -> 403 forbidden, no state change ---
        const teacherRes = await dispatchAction(
          "examSeating.generate",
          {
            institution: inst.slug,
            input: { examId, slotStart: FUTURE_SLOT, rooms: [{ roomId: roomHall }, { roomId: roomSecond }] },
          },
          teacherAuth,
        );
        expect(teacherRes.status).toBe(403);
        const teacherBody = await teacherRes.json();
        expect(teacherBody).toMatchObject({ ok: false, error: { code: "forbidden" } });

        // --- past slot -> invalid_state (409) ---
        const pastRes = await dispatchAction(
          "examSeating.generate",
          {
            institution: inst.slug,
            input: { examId, slotStart: PAST_SLOT, rooms: [{ roomId: roomHall }, { roomId: roomSecond }] },
          },
          examControllerAuth,
        );
        expect(pastRes.status).toBe(409);
        const pastBody = await pastRes.json();
        expect(pastBody).toMatchObject({ ok: false, error: { code: "invalid_state" } });
      } finally {
        await cleanupSeatingFixture(inst.institutionId);
        await inst.cleanup();
      }
    },
  );

  it("institution with exam_seating off -> 403 forbidden", async () => {
    const inst = await createTestInstitution("seating-acceptance-module-off");
    try {
      await sql`
        update public.institutions
        set settings = jsonb_set(settings, '{modules,exam_seating}', 'false'::jsonb)
        where id = ${inst.institutionId}
      `;
      const examControllerAuth = { authorization: `Bearer ${await tokenFor(inst, "exam_controller")}` };

      const res = await dispatchAction(
        "examSeating.generate",
        {
          institution: inst.slug,
          input: {
            examId: crypto.randomUUID(),
            slotStart: FUTURE_SLOT,
            rooms: [{ roomId: crypto.randomUUID() }],
          },
        },
        examControllerAuth,
      );
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body).toMatchObject({ ok: false, error: { code: "forbidden", message: MODULE_DISABLED_MESSAGE } });
    } finally {
      await inst.cleanup();
    }
  });
});
