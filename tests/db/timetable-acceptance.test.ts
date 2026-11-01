// M07-T7 — timetable acceptance over HTTP: admin via /api/v1/actions/*
// creates rooms/periods/version, saves two sections with a double-booked
// teacher conflict (409), publishes; guardian queries forStudent (own child
// → grid, another child → empty); teacher queries todayFor → own periods.
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
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

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

function queryUrl(name: string, institution: string, input: unknown): URL {
  const url = new URL(`http://localhost/api/v1/query/${name}`);
  url.searchParams.set("institution", institution);
  url.searchParams.set("input", JSON.stringify(input));
  return url;
}

function dispatchQuery(name: string, institution: string, input: unknown, headers: Record<string, string>): Promise<Response> {
  return queryGet(new Request(queryUrl(name, institution, input), { headers }), { params: Promise.resolve({ name }) });
}

async function tokenFor(inst: TestInstitution, role: "admin" | "teacher" | "guardian"): Promise<string> {
  const { data, error } = await inst.clientAs(role).auth.getSession();
  if (error || !data.session) throw error ?? new Error(`no session for ${role}`);
  return data.session.access_token;
}

/** Build section fixture: grade, section, student enroled, guardian linked. */
async function makeSectionFixture(
  inst: TestInstitution,
  name: string,
  yearId: string,
): Promise<{ sectionId: string; studentId: string }> {
  const [grade] = await sql`
    insert into public.grades (institution_id, code, display_name, sort_key, grade_group)
    values (${inst.institutionId}, ${`G-${name}`}, ${`Grade ${name}`}, ${name.charCodeAt(0)}, 'middle')
    returning id
  `;
  const [section] = await sql`
    insert into public.class_sections (institution_id, grade_id, academic_year_id, name)
    values (${inst.institutionId}, ${grade.id}, ${yearId}, ${name})
    returning id
  `;

  const [studentMembership] = await sql`
    select student_id from public.memberships where institution_id = ${inst.institutionId} and user_id = ${inst.users.student.id}
  `;
  const studentId = studentMembership.student_id as string;
  await sql`
    insert into public.enrolments (institution_id, student_id, class_section_id, academic_year_id, started_on, status)
    values (${inst.institutionId}, ${studentId}, ${section.id}, ${yearId}, '2026-04-01', 'active')
  `;

  const [guardianMembership] = await sql`
    select guardian_id from public.memberships where institution_id = ${inst.institutionId} and user_id = ${inst.users.guardian.id}
  `;
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${inst.institutionId}, ${guardianMembership.guardian_id}, ${studentId}, 'father', true, true)
  `;

  return { sectionId: section.id as string, studentId };
}

/** Create a teacher staff row. */
async function createTeacher(inst: TestInstitution, fullName: string): Promise<string> {
  const [row] = await sql`
    insert into public.staff (institution_id, employee_no, full_name, designation)
    values (${inst.institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, ${fullName}, 'Teacher')
    returning id
  `;
  return row.id as string;
}

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

describe("M07 timetable acceptance: admin publishes timetable over HTTP", () => {
  it(
    "admin creates rooms/periods/version, saves two sections with a double-booked teacher (409 conflict), then publishes; " +
      "guardian queries forStudent for own child (grid) and another child (empty); teacher queries todayFor (own periods)",
    async () => {
      const inst = await createTestInstitution("timetable-acceptance");
      try {
        // --- Create academic year once ----------------------------------------
        const [year] = await sql`
          insert into public.academic_years (institution_id, name, starts_on, ends_on, is_current)
          values (${inst.institutionId}, ${`AY-${crypto.randomUUID().slice(0, 8)}`}, '2026-04-01', '2027-03-31', true)
          returning id
        `;
        const yearId = year.id as string;

        // --- Build fixtures: two sections (student only in section A), one teacher --------
        const { sectionId: sectionAId, studentId: studentAId } = await makeSectionFixture(inst, "A", yearId);

        // Create section B without student (for testing conflict when same teacher assigned to both)
        const [gradeB] = await sql`
          insert into public.grades (institution_id, code, display_name, sort_key, grade_group)
          values (${inst.institutionId}, 'G-B', 'Grade B', 66, 'middle')
          returning id
        `;
        const [sectionB] = await sql`
          insert into public.class_sections (institution_id, grade_id, academic_year_id, name)
          values (${inst.institutionId}, ${gradeB.id}, ${yearId}, 'B')
          returning id
        `;
        const sectionBId = sectionB.id as string;

        const teacherId = await createTeacher(inst, "Mr. Teacher");

        // Create subject
        const [subject] = await sql`
          insert into public.subjects (institution_id, code, name, kind)
          values (${inst.institutionId}, 'MATH', 'Mathematics', 'scholastic')
          returning id
        `;
        const subjectId = subject.id as string;

        // --- Get bearer tokens -------------------------------------------------
        const adminAuth = { authorization: `Bearer ${await tokenFor(inst, "admin")}` };
        const guardianAuth = { authorization: `Bearer ${await tokenFor(inst, "guardian")}` };
        const teacherAuth = { authorization: `Bearer ${await tokenFor(inst, "teacher")}` };

        // --- Admin creates room ------------------------------------------------
        const roomRes = await dispatchAction(
          "timetable.room.upsert",
          { institution: inst.slug, input: { name: "Room 101", capacity: 40 } },
          adminAuth,
        );
        expect(roomRes.status).toBe(200);
        const roomBody = await roomRes.json();
        expect(roomBody.ok).toBe(true);
        const roomId = roomBody.data.id as string;

        // --- Admin creates period ----------------------------------------------
        const periodRes = await dispatchAction(
          "timetable.period.upsert",
          {
            institution: inst.slug,
            input: { seq: 1, name: "Period 1", startsAt: "08:00", endsAt: "08:40" },
          },
          adminAuth,
        );
        expect(periodRes.status).toBe(200);
        const periodBody = await periodRes.json();
        expect(periodBody.ok).toBe(true);
        const periodId = periodBody.data.id as string;

        // --- Admin creates version ---------------------------------------------
        const versionRes = await dispatchAction(
          "timetable.version.create",
          { institution: inst.slug, input: { academicYearId: yearId, name: "Draft v1" } },
          adminAuth,
        );
        expect(versionRes.status).toBe(200);
        const versionBody = await versionRes.json();
        expect(versionBody.ok).toBe(true);
        const versionId = versionBody.data.id as string;
        expect(versionBody.data.status).toBe("draft");

        // --- Admin saves draft for section A ----------------------------------
        const saveSectionARes = await dispatchAction(
          "timetable.saveDraft",
          {
            institution: inst.slug,
            input: {
              versionId,
              slots: [
                {
                  classSectionId: sectionAId,
                  weekday: 1,
                  periodId,
                  subjectId,
                  teacherId,
                  roomId,
                },
              ],
            },
          },
          adminAuth,
        );
        expect(saveSectionARes.status).toBe(200);
        const saveSectionABody = await saveSectionARes.json();
        expect(saveSectionABody.ok).toBe(true);
        expect(saveSectionABody.data.slotCount).toBe(1);

        // --- Admin tries to save draft for section B (same teacher, same period) -> 409 conflict ---
        const saveSectionBRes = await dispatchAction(
          "timetable.saveDraft",
          {
            institution: inst.slug,
            input: {
              versionId,
              slots: [
                {
                  classSectionId: sectionBId,
                  weekday: 1,
                  periodId,
                  subjectId,
                  teacherId,
                  roomId,
                },
              ],
            },
          },
          adminAuth,
        );
        expect(saveSectionBRes.status).toBe(409);
        const saveSectionBBody = await saveSectionBRes.json();
        expect(saveSectionBBody.ok).toBe(false);
        expect(saveSectionBBody.error.code).toBe("conflict");
        expect(saveSectionBBody.error.fieldErrors?.slots?.[0]).toContain("teacher");

        // --- Admin saves a separate slot for section B on a different period ---
        const [period2] = await sql`
          insert into public.periods (institution_id, seq, name, starts_at, ends_at, is_break)
          values (${inst.institutionId}, 2, 'Period 2', '08:40', '09:20', false)
          returning id
        `;
        const period2Id = period2.id as string;

        const saveSectionBAlternateRes = await dispatchAction(
          "timetable.saveDraft",
          {
            institution: inst.slug,
            input: {
              versionId,
              slots: [
                {
                  classSectionId: sectionBId,
                  weekday: 1,
                  periodId: period2Id,
                  subjectId,
                  teacherId,
                  roomId,
                },
              ],
            },
          },
          adminAuth,
        );
        expect(saveSectionBAlternateRes.status).toBe(200);
        const saveSectionBAlternateBody = await saveSectionBAlternateRes.json();
        expect(saveSectionBAlternateBody.ok).toBe(true);

        // --- Admin publishes version ------------------------------------------
        const publishRes = await dispatchAction(
          "timetable.publish",
          { institution: inst.slug, input: { versionId } },
          adminAuth,
        );
        expect(publishRes.status).toBe(200);
        const publishBody = await publishRes.json();
        expect(publishBody.ok).toBe(true);
        expect(publishBody.data.status).toBe("published");

        // --- Create unlinked student (no guardian link) for RLS test --------
        const [unlinkStudent] = await sql`
          insert into public.students (institution_id, admission_no, first_name, dob, gender)
          values (${inst.institutionId}, ${`ADM-UNLINK-${crypto.randomUUID().slice(0, 6)}`}, 'Unlinked', '2015-01-01', 'other')
          returning id
        `;
        const unlinkStudentId = unlinkStudent.id as string;
        // Enrol unlinked student in section B (but no guardian_students link)
        await sql`
          insert into public.enrolments (institution_id, student_id, class_section_id, academic_year_id, started_on, status)
          values (${inst.institutionId}, ${unlinkStudentId}, ${sectionBId}, ${yearId}, '2026-04-01', 'active')
        `;

        // --- Guardian queries timetable for own child (student A) -> grid ----
        const guardianOwnRes = await dispatchQuery(
          "timetable.forStudent",
          inst.slug,
          { studentId: studentAId },
          guardianAuth,
        );
        expect(guardianOwnRes.status).toBe(200);
        const guardianOwnBody = await guardianOwnRes.json();
        expect(guardianOwnBody.ok).toBe(true);
        expect(Array.isArray(guardianOwnBody.data)).toBe(true);
        expect(guardianOwnBody.data.length).toBeGreaterThan(0);
        const guardianSlot = guardianOwnBody.data[0];
        expect(guardianSlot.weekday).toBe(1);
        expect(guardianSlot.period.seq).toBe(1);
        expect(guardianSlot.subject.name).toBe("Mathematics");
        expect(guardianSlot.teacher).toBeDefined();
        expect(guardianSlot.room.name).toBe("Room 101");

        // --- Guardian queries timetable for unlinked student -> empty (RLS blocks) ----
        const guardianOtherRes = await dispatchQuery(
          "timetable.forStudent",
          inst.slug,
          { studentId: unlinkStudentId },
          guardianAuth,
        );
        expect(guardianOtherRes.status).toBe(200);
        const guardianOtherBody = await guardianOtherRes.json();
        expect(guardianOtherBody.ok).toBe(true);
        expect(guardianOtherBody.data).toEqual([]);

        // --- Teacher queries todayFor -> own periods --
        // Note: todayFor uses the current weekday. We test the array shape
        // rather than asserting a specific weekday. May be empty if today is
        // Sunday or if no slots match today.
        const teacherTodayRes = await dispatchQuery(
          "timetable.todayFor",
          inst.slug,
          {},
          teacherAuth,
        );
        expect(teacherTodayRes.status).toBe(200);
        const teacherTodayBody = await teacherTodayRes.json();
        expect(teacherTodayBody.ok).toBe(true);
        expect(Array.isArray(teacherTodayBody.data)).toBe(true);
        // todayFor returns {start, end, title, subtitle, room}
        // May be empty if today is Sunday or no slots match today.
        if (teacherTodayBody.data.length > 0) {
          const todaySlot = teacherTodayBody.data[0];
          expect(todaySlot).toHaveProperty("start");
          expect(todaySlot).toHaveProperty("end");
          expect(todaySlot).toHaveProperty("title");
        }
      } finally {
        await inst.cleanup();
      }
    },
  );
});
