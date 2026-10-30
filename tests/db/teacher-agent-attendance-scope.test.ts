import postgres from "postgres";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it, vi } from "vitest";

// Fix round 1 (security review, LOW-4): the existing teacher-tools unit
// tests mock Supabase entirely, so nothing proves RLS itself actually
// rejects an out-of-scope studentId end to end. This exercises the real
// `getAttendancePattern` tool against real RLS with two real teachers.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { teacherTools } from "@/modules/ai/agent/teacher-tools";
import type { Database } from "@/lib/db/types";
import { buildContext } from "../helpers/actions";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createAttendanceRecord,
  createAttendanceSession,
  createClassSection,
  createEnrolment,
  createGrade,
  createTerm,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

const ATTENDANCE_STATUSES = [
  { code: "P", label: "Present", counts_present: 1, in_denominator: true },
  { code: "A", label: "Absent", counts_present: 0, in_denominator: true, notify_guardian: true },
];

async function setAttendanceSettings(institutionId: string): Promise<void> {
  await sql`
    update public.institutions
    set settings = settings || jsonb_build_object(
      'attendance', jsonb_build_object(
        'mode', 'daily',
        'correction_window_days', 3,
        'statuses', ${sql.json(ATTENDANCE_STATUSES)}::jsonb,
        'alert_thresholds', jsonb_build_object('warn', 80, 'critical', 75)
      )
    )
    where id = ${institutionId}
  `;
}

async function createStudent(institutionId: string, admissionNo: string): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo}, 'Test Student', '2015-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

/** A second real teacher login in the same institution — `createTestInstitution` only provisions one of each role. */
async function createSecondTeacher(institutionId: string): Promise<{ userId: string; staffId: string; client: SupabaseClient }> {
  const password = "correct-horse-battery-staple";
  const email = `test-second-teacher-${crypto.randomUUID()}@test.coolskool.test`;
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);

  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("failed to create second teacher");

  const [staff] = await sql`
    insert into public.staff (institution_id, employee_no, full_name, designation)
    values (${institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, 'Test teacher B', 'teacher')
    returning id
  `;
  await sql`
    insert into public.memberships (institution_id, user_id, role, staff_id)
    values (${institutionId}, ${data.user.id}, 'teacher', ${staff.id})
  `;

  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
  );
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  return { userId: data.user.id, staffId: staff.id as string, client };
}

describe("getAttendancePattern tool — RLS scope isolation (LOW-4 regression)", () => {
  it("never returns another teacher's student data, and does return the caller's own", async () => {
    const inst = await createTestInstitution("teacher-agent-attendance-scope");
    await setAttendanceSettings(inst.institutionId);

    const year = await createAcademicYear(inst.institutionId);
    await createTerm(inst.institutionId, year);
    const grade = await createGrade(inst.institutionId);

    // Teacher A (the institution's fixture "teacher") is class teacher of
    // section A only; a manually-created second teacher is class teacher
    // of section B. Student X belongs to A, Student Y belongs to B.
    const teacherAStaffId = (
      await sql`select staff_id from public.memberships where institution_id = ${inst.institutionId} and user_id = ${inst.users.teacher.id}`
    )[0].staff_id as string;
    const sectionA = await createClassSection(inst.institutionId, grade, year, { name: "A", classTeacherId: teacherAStaffId });

    const teacherB = await createSecondTeacher(inst.institutionId);
    const sectionB = await createClassSection(inst.institutionId, grade, year, { name: "B", classTeacherId: teacherB.staffId });

    const studentX = await createStudent(inst.institutionId, "ADM-SCOPE-X");
    await createEnrolment(inst.institutionId, studentX, sectionA, year);
    const sessionA = await createAttendanceSession(inst.institutionId, sectionA, { date: "2026-04-02" });
    await createAttendanceRecord(inst.institutionId, sessionA, studentX, { status: "P" });

    const studentY = await createStudent(inst.institutionId, "ADM-SCOPE-Y");
    await createEnrolment(inst.institutionId, studentY, sectionB, year);
    const sessionB = await createAttendanceSession(inst.institutionId, sectionB, { date: "2026-04-02" });
    await createAttendanceRecord(inst.institutionId, sessionB, studentY, { status: "P" });

    const ctxA = await buildContext(inst, "teacher");
    setActingClient(inst.clientAs("teacher") as unknown as SupabaseClient<Database>);
    try {
      const tools = await teacherTools(ctxA);

      // Negative: Teacher A asking about Teacher B's student must never
      // see real attendance data — RLS hides the student entirely.
      const otherTeachersStudent = await tools.getAttendancePattern.execute!(
        { studentId: studentY },
        { toolCallId: "1", messages: [], context: {} },
      );
      expect(otherTeachersStudent).toBe("That student is not in your sections, or has no active enrolment.");

      // Positive control: the same tool call for Teacher A's own student
      // succeeds, proving the negative result above isn't just a broken
      // fixture (e.g. RLS blocking everything).
      const ownStudent = await tools.getAttendancePattern.execute!(
        { studentId: studentX },
        { toolCallId: "1", messages: [], context: {} },
      );
      expect(ownStudent).toEqual(
        expect.objectContaining({ presentCount: expect.any(Number), absentCount: expect.any(Number) }),
      );
      expect(typeof ownStudent).not.toBe("string");
    } finally {
      setActingClient(null);
      await teacherB.client.auth.signOut();
      const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
      await admin.auth.admin.deleteUser(teacherB.userId);
    }

    await inst.cleanup();
  });
});
