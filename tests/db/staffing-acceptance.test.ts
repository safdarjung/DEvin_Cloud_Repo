// M08-T14 — staffing acceptance over HTTP: every call goes through
// /api/v1/actions/* and /api/v1/query/* (pattern: tests/db/timetable-
// acceptance.test.ts), on a fixture institution with one published
// timetable slot. All staffing RPCs pin on "today" (assign_substitution
// requires date >= today, mark_period_attendance requires date <= today —
// the only date satisfying both is today), so the fixture slot's weekday is
// derived from today's ISO weekday rather than fixed to Monday.
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
import { closeFactoriesHelper, createAcademicYear, createClassSection, createEnrolment, createGrade, createSubject } from "../helpers/factories";
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

async function tokenFor(inst: TestInstitution, role: "owner" | "principal" | "teacher"): Promise<string> {
  const { data, error } = await inst.clientAs(role).auth.getSession();
  if (error || !data.session) throw error ?? new Error(`no session for ${role}`);
  return data.session.access_token;
}

function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

/** ISO weekday (1=Mon..7=Sun) of an already-local calendar date string. */
function isodowOf(dateIso: string): number {
  const day = new Date(`${dateIso}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

async function staffIdFor(institutionId: string, role: string): Promise<string> {
  const [row] = await sql`select staff_id from public.memberships where institution_id = ${institutionId} and role = ${role}`;
  return row.staff_id as string;
}

async function createOtherTeacher(institutionId: string, name: string): Promise<string> {
  const [row] = await sql`
    insert into public.staff (institution_id, employee_no, full_name, designation, is_teaching)
    values (${institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, ${name}, 'teacher', true)
    returning id
  `;
  return row.id as string;
}

/** 05 §4.1 default statuses (mirrors period-attendance-actions.test.ts) —
 *  institutions created via createTestInstitution don't carry the app's
 *  DEFAULT_SETTINGS, so attendance.mark/markPeriod's status-code check needs
 *  this set explicitly. */
async function setAttendanceSettings(institutionId: string): Promise<void> {
  await sql`
    update public.institutions
    set settings = settings || jsonb_build_object(
      'attendance', jsonb_build_object(
        'mode', 'daily',
        'correction_window_days', 3,
        'statuses', ${sql.json([{ code: "P", label: "Present", counts_present: 1, in_denominator: true }, { code: "A", label: "Absent", counts_present: 0, in_denominator: true, notify_guardian: true }])}::jsonb,
        'alert_thresholds', jsonb_build_object('warn', 80, 'critical', 75)
      )
    )
    where id = ${institutionId}
  `;
}

async function createPeriod(institutionId: string, seq: number): Promise<string> {
  const startHour = 8 + seq;
  const [row] = await sql`
    insert into public.periods (institution_id, seq, name, starts_at, ends_at)
    values (${institutionId}, ${seq}, ${`Period ${seq}`}, ${`${startHour}:00`}, ${`${startHour}:40`})
    returning id
  `;
  return row.id as string;
}

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

describe("M08 staffing acceptance: staff attendance, leave, substitution and period attendance over HTTP", () => {
  it(
    "principal marks + teacher checks in idempotently; teacher's leave is requested/approved/audited and the approve " +
      "boundary (not self, not non-admin) holds; availability/pending-approvals reflect it; a free substitute covers " +
      "the teacher's slot (double-booking the substitute at the same period -> 409); the substitute marks period " +
      "attendance and the original teacher cannot; daily attendance for the same section+date is unaffected",
    async () => {
      const inst = await createTestInstitution("staffing-acceptance");
      try {
        const date = todayIso();
        const weekday = isodowOf(date);
        expect(weekday).toBeGreaterThanOrEqual(1);
        expect(weekday).toBeLessThanOrEqual(6); // timetable_slots.weekday check (1..6); run on a weekday.

        // --- Fixture: one published slot for the teacher, today ---------------
        await setAttendanceSettings(inst.institutionId);
        const yearId = await createAcademicYear(inst.institutionId);
        const gradeId = await createGrade(inst.institutionId);
        const sectionAId = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
        const subjectId = await createSubject(inst.institutionId);
        const periodId = await createPeriod(inst.institutionId, 1);
        const teacherId = await staffIdFor(inst.institutionId, "teacher");

        const [version] = await sql`
          insert into public.timetable_versions (institution_id, academic_year_id, name, created_by)
          values (${inst.institutionId}, ${yearId}, 'Term Timetable', ${inst.users.admin.id})
          returning id
        `;
        const versionId = version.id as string;
        const [slot1] = await sql`
          insert into public.timetable_slots (institution_id, version_id, class_section_id, subject_id, teacher_id, weekday, period_id)
          values (${inst.institutionId}, ${versionId}, ${sectionAId}, ${subjectId}, ${teacherId}, ${weekday}, ${periodId})
          returning id
        `;
        const slot1Id = slot1.id as string;
        await sql`
          update public.timetable_versions set status = 'published', published_at = now(), published_by = ${inst.users.admin.id}
          where id = ${versionId}
        `;

        const studentId = (
          await sql`
            insert into public.students (institution_id, admission_no, first_name, dob, gender)
            values (${inst.institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'Test', '2016-01-01', 'other')
            returning id
          `
        )[0].id as string;
        await createEnrolment(inst.institutionId, studentId, sectionAId, yearId, { rollNo: 1 });

        const principalAuth = { authorization: `Bearer ${await tokenFor(inst, "principal")}` };
        const teacherAuth = { authorization: `Bearer ${await tokenFor(inst, "teacher")}` };

        // --- 1. Principal marks staff attendance; teacher checks in twice -----
        const markRes = await dispatchAction(
          "people.staffAttendance.mark",
          { institution: inst.slug, input: { date, records: [{ staffId: teacherId, status: "present" }] } },
          principalAuth,
        );
        expect(markRes.status).toBe(200);
        expect((await markRes.json()).ok).toBe(true);

        const checkIn1 = await dispatchAction("people.staffAttendance.checkIn", { institution: inst.slug, input: {} }, teacherAuth);
        expect(checkIn1.status).toBe(200);
        const checkIn2 = await dispatchAction("people.staffAttendance.checkIn", { institution: inst.slug, input: {} }, teacherAuth);
        expect(checkIn2.status).toBe(200);
        const rows = await sql`
          select id from public.staff_attendance where institution_id = ${inst.institutionId} and staff_id = ${teacherId} and date = ${date}
        `;
        expect(rows).toHaveLength(1);

        // --- 2. Teacher requests leave covering today; principal approves ------
        const requestRes = await dispatchAction(
          "people.leave.request",
          { institution: inst.slug, input: { leaveType: "sick", startDate: date, endDate: date, reason: "Fever" } },
          teacherAuth,
        );
        expect(requestRes.status).toBe(200);
        const teacherLeaveId = (await requestRes.json()).data.id as string;

        const approveRes = await dispatchAction(
          "people.leave.approve",
          { institution: inst.slug, input: { leaveId: teacherLeaveId } },
          principalAuth,
        );
        expect(approveRes.status).toBe(200);
        const auditRows = await sql`
          select id from public.audit_events where institution_id = ${inst.institutionId} and action = 'leave.approved' and entity_id = ${teacherLeaveId}
        `;
        expect(auditRows).toHaveLength(1);

        // --- 3. Teacher cannot approve; principal cannot approve own leave -----
        const teacherApproveRes = await dispatchAction(
          "people.leave.approve",
          { institution: inst.slug, input: { leaveId: teacherLeaveId } },
          teacherAuth,
        );
        expect(teacherApproveRes.status).toBe(403);

        const ownRequestRes = await dispatchAction(
          "people.leave.request",
          { institution: inst.slug, input: { leaveType: "casual", startDate: date, endDate: date, reason: "Personal" } },
          principalAuth,
        );
        expect(ownRequestRes.status).toBe(200);
        const principalLeaveId = (await ownRequestRes.json()).data.id as string;
        const ownApproveRes = await dispatchAction(
          "people.leave.approve",
          { institution: inst.slug, input: { leaveId: principalLeaveId } },
          principalAuth,
        );
        expect(ownApproveRes.status).toBe(403);

        // --- 4. Availability + pending approvals reflect the above -------------
        const availabilityRes = await dispatchQuery("people.staffAvailabilityToday", inst.slug, {}, principalAuth);
        expect(availabilityRes.status).toBe(200);
        const availabilityBody = await availabilityRes.json();
        expect(availabilityBody.data.onLeave).toBe(1);

        const pendingRes = await dispatchQuery("people.pendingLeaveApprovals", inst.slug, {}, principalAuth);
        expect(pendingRes.status).toBe(200);
        const pendingBody = await pendingRes.json();
        expect(pendingBody.data.map((r: { id: string }) => r.id)).toContain(principalLeaveId);

        // --- 5. coverNeeded -> assign a free substitute; double-book -> 409 ----
        const coverRes = await dispatchQuery("timetable.coverNeeded", inst.slug, { date }, principalAuth);
        expect(coverRes.status).toBe(200);
        const coverBody = await coverRes.json();
        const coverRow = coverBody.data.find((r: { slotId: string }) => r.slotId === slot1Id);
        expect(coverRow).toMatchObject({ reason: "leave", substitution: null });

        const substituteId = await createOtherTeacher(inst.institutionId, "Free Substitute");
        const candidatesRes = await dispatchQuery(
          "timetable.substitutionCandidates",
          inst.slug,
          { slotId: slot1Id, date },
          principalAuth,
        );
        expect(candidatesRes.status).toBe(200);
        const candidatesBody = await candidatesRes.json();
        expect(candidatesBody.data[0].staffId).toBe(substituteId);

        const assignRes = await dispatchAction(
          "timetable.substitution.assign",
          { institution: inst.slug, input: { slotId: slot1Id, date, substituteId, note: "Regular teacher is on leave" } },
          principalAuth,
        );
        expect(assignRes.status).toBe(200);

        // A second published slot at the same weekday + period: assigning the
        // same substitute there hits check 9 (substitute already has an
        // assigned substitution at this date/period) -> conflict.
        const sectionBId = await createClassSection(inst.institutionId, await createGrade(inst.institutionId, { code: "VII", sortKey: 7 }), yearId, {
          name: "B",
        });
        const otherTeacherId = await createOtherTeacher(inst.institutionId, "Other Teacher");
        const [slot2] = await sql`
          insert into public.timetable_slots (institution_id, version_id, class_section_id, subject_id, teacher_id, weekday, period_id)
          values (${inst.institutionId}, ${versionId}, ${sectionBId}, ${subjectId}, ${otherTeacherId}, ${weekday}, ${periodId})
          returning id
        `;
        const doubleBookRes = await dispatchAction(
          "timetable.substitution.assign",
          { institution: inst.slug, input: { slotId: slot2.id, date, substituteId, note: "Regular teacher is on leave" } },
          principalAuth,
        );
        expect(doubleBookRes.status).toBe(409);
        expect((await doubleBookRes.json()).error.code).toBe("conflict");

        // --- 6. The substitute marks period attendance; the original teacher ---
        //        cannot (repoint owner's membership to the substitute's staff
        //        row — owner holds attendance.mark like timetable-acceptance.test
        //        .ts repoints exam_controller to exercise a second staff identity).
        await sql`update public.memberships set staff_id = ${substituteId} where institution_id = ${inst.institutionId} and role = 'owner'`;
        const substituteAuth = { authorization: `Bearer ${await tokenFor(inst, "owner")}` };

        const substituteMarkRes = await dispatchAction(
          "attendance.markPeriod",
          { institution: inst.slug, input: { classSectionId: sectionAId, periodId, date, records: [{ studentId, status: "P" }] } },
          substituteAuth,
        );
        expect(substituteMarkRes.status).toBe(200);

        const teacherMarkRes = await dispatchAction(
          "attendance.markPeriod",
          { institution: inst.slug, input: { classSectionId: sectionAId, periodId, date, records: [{ studentId, status: "P" }] } },
          teacherAuth,
        );
        expect(teacherMarkRes.status).toBe(403);

        // --- 7. Daily attendance for the same section+date is unaffected -------
        const dailyMarkRes = await dispatchAction(
          "attendance.mark",
          { institution: inst.slug, input: { classSectionId: sectionAId, date, records: [{ studentId, status: "P" }] } },
          principalAuth,
        );
        expect(dailyMarkRes.status).toBe(200);

        const dailySessionRes = await dispatchQuery(
          "attendance.getSession",
          inst.slug,
          { classSectionId: sectionAId, date },
          principalAuth,
        );
        expect(dailySessionRes.status).toBe(200);
        const dailySessionBody = await dailySessionRes.json();
        expect(dailySessionBody.data.session).not.toBeNull();
      } finally {
        await inst.cleanup();
      }
    },
  );
});
