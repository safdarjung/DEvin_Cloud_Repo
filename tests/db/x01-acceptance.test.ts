// X01-T11 — student leave + diary acceptance over HTTP: everything through
// /api/v1/actions/* and /api/v1/query/* (pattern: tests/db/announcements-
// acceptance.test.ts, tests/db/timetable-acceptance.test.ts). @/lib/supabase/
// server is NOT mocked — real bearer tokens, real RLS. Steps per
// X01-tasks.md Task 11, in order.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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
import { createRunnerPorts, runOnceCore } from "@/modules/jobs/runner";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createEnrolment, createGrade } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";
import { withoutSweeps } from "../helpers/runner-ports";

process.env.SERVICE_ROLE_CALLER = "test";
const { createAdminClient } = await import("@/lib/supabase/admin");
const admin = createAdminClient();

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });
const PASSWORD = "correct-horse-battery-staple";

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

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

async function tokenForClient(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session) throw error ?? new Error("no session");
  return data.session.access_token;
}

async function tokenFor(inst: TestInstitution, role: "owner" | "teacher" | "guardian"): Promise<string> {
  return tokenForClient(inst.clientAs(role));
}

function adminClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
}

function randomPhone(): string {
  const first = String(6 + Math.floor(Math.random() * 4));
  const rest = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join("");
  return first + rest;
}

/** Institution-local "today" (Asia/Kolkata), matching markAttendance's/the guard's own default. */
function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

function addDaysIso(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isSundayIso(dateIso: string): boolean {
  return new Date(`${dateIso}T00:00:00Z`).getUTCDay() === 0;
}

/** The school day (Mon-Sat) strictly before `dateIso`. */
function previousSchoolDay(dateIso: string): string {
  let d = addDaysIso(dateIso, -1);
  while (isSundayIso(d)) d = addDaysIso(d, -1);
  return d;
}

/** The school day (Mon-Sat) strictly after `dateIso`. */
function nextSchoolDay(dateIso: string): string {
  let d = addDaysIso(dateIso, 1);
  while (isSundayIso(d)) d = addDaysIso(d, 1);
  return d;
}

async function setAttendanceStatuses(institutionId: string): Promise<void> {
  await sql`
    update public.institutions
    set settings = settings || jsonb_build_object(
      'attendance', jsonb_build_object(
        'mode', 'daily',
        'correction_window_days', 3,
        'statuses', ${sql.json([
          { code: "P", label: "Present", counts_present: 1, in_denominator: true },
          { code: "A", label: "Absent", counts_present: 0, in_denominator: true, notify_guardian: true },
          { code: "OL", label: "On leave", counts_present: 0, in_denominator: true },
        ])}::jsonb,
        'alert_thresholds', jsonb_build_object('warn', 80, 'critical', 75)
      )
    )
    where id = ${institutionId}
  `;
}

async function staffIdFor(institutionId: string, role: string): Promise<string> {
  const [row] = await sql`select staff_id from public.memberships where institution_id = ${institutionId} and role = ${role}`;
  return row.staff_id as string;
}

async function studentIdFor(institutionId: string): Promise<string> {
  const [row] = await sql`select student_id from public.memberships where institution_id = ${institutionId} and role = 'student'`;
  return row.student_id as string;
}

async function guardianIdFor(institutionId: string): Promise<string> {
  const [row] = await sql`select guardian_id from public.memberships where institution_id = ${institutionId} and role = 'guardian'`;
  return row.guardian_id as string;
}

/** A second teacher (own staff + membership + signed-in client) — not the fixture's class teacher. */
async function addSecondTeacher(institutionId: string, label: string): Promise<{ client: SupabaseClient; staffId: string }> {
  const authAdmin = adminClient();
  const email = `second-${label}-${crypto.randomUUID()}@test.coolskool.test`;
  const { data, error } = await authAdmin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw error ?? new Error(`failed to create ${label}`);

  const [staff] = await sql`
    insert into public.staff (institution_id, employee_no, full_name, designation)
    values (${institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, ${label}, 'teacher')
    returning id
  `;
  await sql`
    insert into public.memberships (institution_id, user_id, role, staff_id)
    values (${institutionId}, ${data.user.id}, 'teacher', ${staff.id})
  `;

  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError) throw signInError;
  return { client, staffId: staff.id as string };
}

/** A second, unrelated guardian (no guardian_students link to the fixture's child). */
async function addSecondGuardian(institutionId: string, label: string): Promise<{ client: SupabaseClient }> {
  const authAdmin = adminClient();
  const email = `second-${label}-${crypto.randomUUID()}@test.coolskool.test`;
  const { data, error } = await authAdmin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw error ?? new Error(`failed to create ${label}`);

  const [guardian] = await sql`
    insert into public.guardians (institution_id, full_name, phone)
    values (${institutionId}, ${label}, ${randomPhone()})
    returning id
  `;
  await sql`
    insert into public.memberships (institution_id, user_id, role, guardian_id)
    values (${institutionId}, ${data.user.id}, 'guardian', ${guardian.id})
  `;

  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError) throw signInError;
  return { client };
}

describe("X01 acceptance: student leave + diary over HTTP", () => {
  it(
    "guardian requests leave for own child (other child -> 403, overlap -> 409); wrong-section teacher " +
      "cannot approve (403), class teacher can (200) and attendance is pre-marked OL both sides; the job " +
      "runner notifies the guardian and studentLeave.list shows approved; a diary entry with requiresAck " +
      "notifies the section, acknowledges idempotently, and another family's child sees nothing; the owner " +
      "can turn the diary module off (403 MODULE_DISABLED_MESSAGE) and back on",
    async () => {
      const inst = await createTestInstitution("x01-acceptance");
      try {
        await setAttendanceStatuses(inst.institutionId);
        const yearId = await createAcademicYear(inst.institutionId);
        const gradeId = await createGrade(inst.institutionId);
        const teacherStaffId = await staffIdFor(inst.institutionId, "teacher");
        const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { classTeacherId: teacherStaffId });
        const studentId = await studentIdFor(inst.institutionId);
        const guardianId = await guardianIdFor(inst.institutionId);
        await createEnrolment(inst.institutionId, studentId, sectionId, yearId, { status: "active" });
        await sql`
          insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
          values (${inst.institutionId}, ${guardianId}, ${studentId}, 'father', true, true)
        `;

        const ownerAuth = { authorization: `Bearer ${await tokenFor(inst, "owner")}` };
        const teacherAuth = { authorization: `Bearer ${await tokenFor(inst, "teacher")}` };
        const guardianAuth = { authorization: `Bearer ${await tokenFor(inst, "guardian")}` };

        const prevDay = previousSchoolDay(todayIso());
        const nextDay = nextSchoolDay(todayIso());

        // --- 1. Class teacher marks + submits the previous school day's register, child A ---
        const markRes = await dispatchAction(
          "attendance.mark",
          { institution: inst.slug, input: { classSectionId: sectionId, date: prevDay, records: [{ studentId, status: "A" }] } },
          teacherAuth,
        );
        expect(markRes.status).toBe(200);
        const markBody = await markRes.json();
        expect(markBody.ok).toBe(true);
        const sessionId = markBody.data.sessionId as string;

        const submitRes = await dispatchAction("attendance.submit", { institution: inst.slug, input: { sessionId } }, teacherAuth);
        expect(submitRes.status).toBe(200);
        expect((await submitRes.json()).ok).toBe(true);

        // --- 2. Guardian requests leave for own child -> 200; another family's child -> 403; overlap -> 409 ---
        const [otherStudent] = await sql`
          insert into public.students (institution_id, admission_no, first_name, dob, gender)
          values (${inst.institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'Not Mine', '2016-01-01', 'other')
          returning id
        `;
        await createEnrolment(inst.institutionId, otherStudent.id as string, sectionId, yearId, { status: "active" });

        const otherChildRes = await dispatchAction(
          "studentLeave.request",
          { institution: inst.slug, input: { studentId: otherStudent.id, startDate: prevDay, endDate: nextDay, reason: "Not my child" } },
          guardianAuth,
        );
        expect(otherChildRes.status).toBe(403);

        const requestRes = await dispatchAction(
          "studentLeave.request",
          { institution: inst.slug, input: { studentId, startDate: prevDay, endDate: nextDay, reason: "Family function" } },
          guardianAuth,
        );
        expect(requestRes.status).toBe(200);
        const requestBody = await requestRes.json();
        expect(requestBody.data.status).toBe("pending");
        const leaveId = requestBody.data.id as string;

        const overlapRes = await dispatchAction(
          "studentLeave.request",
          { institution: inst.slug, input: { studentId, startDate: prevDay, endDate: nextDay, reason: "Overlaps the first" } },
          guardianAuth,
        );
        expect(overlapRes.status).toBe(409);

        // --- 3. Wrong-section teacher -> 403; the class teacher -> 200; pre-mark both sides ---
        const otherTeacher = await addSecondTeacher(inst.institutionId, "other-teacher");
        await createClassSection(inst.institutionId, gradeId, yearId, { name: "B", classTeacherId: otherTeacher.staffId });
        const otherTeacherAuth = { authorization: `Bearer ${await tokenForClient(otherTeacher.client)}` };

        const wrongApproveRes = await dispatchAction("studentLeave.approve", { institution: inst.slug, input: { leaveId } }, otherTeacherAuth);
        expect(wrongApproveRes.status).toBe(403);

        const approveRes = await dispatchAction("studentLeave.approve", { institution: inst.slug, input: { leaveId } }, teacherAuth);
        expect(approveRes.status).toBe(200);
        const approveBody = await approveRes.json();
        expect(approveBody.data.status).toBe("approved");

        const [prevRecord] = await sql`
          select ar.id, ar.status from public.attendance_records ar
          join public.attendance_sessions asess on asess.id = ar.session_id
          where asess.class_section_id = ${sectionId} and asess.date = ${prevDay} and ar.student_id = ${studentId}
        `;
        expect(prevRecord.status).toBe("OL");
        const corrections = await sql`select old_status, new_status from public.attendance_corrections where record_id = ${prevRecord.id}`;
        expect(corrections).toHaveLength(1);
        expect(corrections[0]).toMatchObject({ old_status: "A", new_status: "OL" });
        const correctedAudit = await sql`
          select id from public.audit_events
          where institution_id = ${inst.institutionId} and action = 'attendance.corrected' and entity_id = ${prevRecord.id}
        `;
        expect(correctedAudit).toHaveLength(1);

        const [nextSession] = await sql`
          select id, status from public.attendance_sessions where class_section_id = ${sectionId} and date = ${nextDay}
        `;
        expect(nextSession.status).toBe("open");
        const [nextRecord] = await sql`
          select status from public.attendance_records where session_id = ${nextSession.id} and student_id = ${studentId}
        `;
        expect(nextRecord.status).toBe("OL");

        // --- 4. Run the job runner once; guardian sees the decision; studentLeave.list shows approved ---
        const summary1 = await runOnceCore({ workerId: "x01-worker-1" }, withoutSweeps(createRunnerPorts(admin)));
        expect(summary1.dead).toBe(0);

        const notifRes = await dispatchQuery("notifications.listMyNotifications", inst.slug, {}, guardianAuth);
        expect(notifRes.status).toBe(200);
        const notifBody = await notifRes.json();
        const leaveNotif = (notifBody.data as { type: string }[]).find((n) => n.type === "student_leave_decided");
        expect(leaveNotif).toBeDefined();

        const listRes = await dispatchQuery("studentLeave.list", inst.slug, {}, guardianAuth);
        expect(listRes.status).toBe(200);
        const listBody = await listRes.json();
        const leaveRow = (listBody.data as { id: string; status: string }[]).find((r) => r.id === leaveId);
        expect(leaveRow?.status).toBe("approved");

        // --- 5. Diary: class teacher posts with requiresAck; guardian reads/acks; teacher sees ack; another family sees nothing ---
        const today = todayIso();
        const postRes = await dispatchAction(
          "diary.entry.post",
          { institution: inst.slug, input: { classSectionId: sectionId, entryDate: today, body: "Parent-teacher meeting on Saturday at 10 am.", requiresAck: true } },
          teacherAuth,
        );
        expect(postRes.status).toBe(200);
        const entryId = (await postRes.json()).data.id as string;

        const summary2 = await runOnceCore({ workerId: "x01-worker-2" }, withoutSweeps(createRunnerPorts(admin)));
        expect(summary2.dead).toBe(0);

        const forStudentRes = await dispatchQuery("diary.forStudent", inst.slug, { studentId }, guardianAuth);
        expect(forStudentRes.status).toBe(200);
        const forStudentBody = await forStudentRes.json();
        const entry = (forStudentBody.data as { id: string; acknowledged: boolean }[]).find((e) => e.id === entryId);
        expect(entry).toMatchObject({ acknowledged: false });

        const ack1 = await dispatchAction("diary.acknowledge", { institution: inst.slug, input: { entryId, studentId } }, guardianAuth);
        expect(ack1.status).toBe(200);
        const ack2 = await dispatchAction("diary.acknowledge", { institution: inst.slug, input: { entryId, studentId } }, guardianAuth);
        expect(ack2.status).toBe(200);

        const ackStatusRes = await dispatchQuery("diary.ackStatus", inst.slug, { entryId }, teacherAuth);
        expect(ackStatusRes.status).toBe(200);
        const ackStatusBody = await ackStatusRes.json();
        const studentAck = (ackStatusBody.data as { studentId: string; acknowledged: boolean }[]).find((r) => r.studentId === studentId);
        expect(studentAck?.acknowledged).toBe(true);

        const secondGuardian = await addSecondGuardian(inst.institutionId, "second-guardian");
        const secondGuardianAuth = { authorization: `Bearer ${await tokenForClient(secondGuardian.client)}` };
        const otherFamilyRes = await dispatchQuery("diary.forStudent", inst.slug, { studentId }, secondGuardianAuth);
        expect(otherFamilyRes.status).toBe(200);
        expect((await otherFamilyRes.json()).data).toEqual([]);

        // --- 6. Owner turns the diary module off: posting is 403 with MODULE_DISABLED_MESSAGE; turn it back on ---
        const offRes = await dispatchAction("core.module.set", { institution: inst.slug, input: { key: "diary", enabled: false } }, ownerAuth);
        expect(offRes.status).toBe(200);

        const blockedRes = await dispatchAction(
          "diary.entry.post",
          { institution: inst.slug, input: { classSectionId: sectionId, entryDate: today, body: "Should be blocked.", requiresAck: false } },
          teacherAuth,
        );
        expect(blockedRes.status).toBe(403);
        const blockedBody = await blockedRes.json();
        expect(blockedBody.error.message).toBe(MODULE_DISABLED_MESSAGE);

        const onRes = await dispatchAction("core.module.set", { institution: inst.slug, input: { key: "diary", enabled: true } }, ownerAuth);
        expect(onRes.status).toBe(200);
      } finally {
        await inst.cleanup();
      }
    },
  );
});
