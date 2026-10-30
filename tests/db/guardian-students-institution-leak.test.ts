import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createAttendanceRecord,
  createAttendanceSession,
  createClassSection,
  createEnrolment,
  createGrade,
} from "../helpers/factories";
import { closeRolesHelper, withTwoInstitutions } from "../helpers/roles";

// P-01 Fix round 1 (security review, CRITICAL). `guardian_students.institution_id`
// is a denormalized column with no FK/trigger tying it to the guardian's or
// student's real institution. app.my_student_ids() (20261028000020) and the
// guardian branch of guardian_students_select previously trusted guardian_id/
// student_id equality alone, with no check that the row's own institution_id
// (or the caller's membership institution_id) actually matched — a
// guardian_students row claiming institution B but naming institution A's
// guardian_id, or a membership whose student_id pointed at another
// institution's student, leaked that other institution's student PII
// (and everything app.my_student_ids() gates: enrolments, attendance,
// results, invoices, payments, receipts, guardian_students itself).
// Fix round 1 adds `gs.institution_id = m.institution_id` (and the
// equivalent students check) inside app.my_student_ids(), the same
// correlation inside guardian_students_select's guardian_id branch, and
// closes the write side (guardian_students_insert/update) so a mismatched
// row can no longer be created via RLS in the first place.
//
// Deliberately a separate file from tests/db/portal-scope.test.ts (T-034's
// existing file, module-query-level, mocked server client) — this one
// exercises the raw RLS policies end to end via real signed-in clients on
// throwaway fixture institutions, same pattern as rls-performance.test.ts.

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });
const PASSWORD = "correct-horse-battery-staple";

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

function adminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
}

describe("P-01 fix round 1 — guardian_students institution-mismatch no longer leaks cross-tenant data", () => {
  it("guardian branch: a guardian_students row claiming institution B but naming institution A's guardian_id is invisible to that guardian, and institution B's student stays hidden", async () => {
    await withTwoInstitutions(async (instA, instB) => {
      const [membershipA] = await sql`
        select guardian_id from public.memberships where institution_id = ${instA.institutionId} and role = 'guardian'
      `;
      const [membershipB] = await sql`
        select student_id from public.memberships where institution_id = ${instB.institutionId} and role = 'student'
      `;

      // Attack fixture: claims institution B, but guardian_id is instA's
      // real (institution A) guardian identity — service-role insert
      // bypasses RLS, same as a compromised/buggy write would.
      await sql`
        insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, portal_access)
        values (${instB.institutionId}, ${membershipA.guardian_id}, ${membershipB.student_id}, 'father', true)
      `;

      try {
        const guardianClient = instA.clientAs("guardian");

        const gsRows = await guardianClient
          .from("guardian_students")
          .select("guardian_id, student_id")
          .eq("student_id", membershipB.student_id);
        expect(gsRows.error).toBeNull();
        expect(gsRows.data).toHaveLength(0);

        const studentRows = await guardianClient.from("students").select("id").eq("id", membershipB.student_id);
        expect(studentRows.error).toBeNull();
        expect(studentRows.data).toHaveLength(0);
      } finally {
        await sql`
          delete from public.guardian_students
          where guardian_id = ${membershipA.guardian_id} and student_id = ${membershipB.student_id}
        `;
      }
    });
  });

  it("guardian branch: enrolments and attendance_records for the leaked student_id also stay hidden (inherited via app.my_student_ids())", async () => {
    await withTwoInstitutions(async (instA, instB) => {
      const [membershipA] = await sql`
        select guardian_id from public.memberships where institution_id = ${instA.institutionId} and role = 'guardian'
      `;
      const [membershipB] = await sql`
        select student_id from public.memberships where institution_id = ${instB.institutionId} and role = 'student'
      `;

      const yearB = await createAcademicYear(instB.institutionId);
      const gradeB = await createGrade(instB.institutionId);
      const sectionB = await createClassSection(instB.institutionId, gradeB, yearB);
      await createEnrolment(instB.institutionId, membershipB.student_id, sectionB, yearB);
      await sql`update public.institutions set settings = settings || jsonb_build_object('attendance', jsonb_build_object('statuses', jsonb_build_array(jsonb_build_object('code','P','label','Present')))) where id = ${instB.institutionId}`;
      const sessionB = await createAttendanceSession(instB.institutionId, sectionB);
      await createAttendanceRecord(instB.institutionId, sessionB, membershipB.student_id);

      await sql`
        insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, portal_access)
        values (${instB.institutionId}, ${membershipA.guardian_id}, ${membershipB.student_id}, 'father', true)
      `;

      try {
        const guardianClient = instA.clientAs("guardian");

        const enrolments = await guardianClient.from("enrolments").select("id").eq("student_id", membershipB.student_id);
        expect(enrolments.data).toHaveLength(0);

        const records = await guardianClient.from("attendance_records").select("id").eq("student_id", membershipB.student_id);
        expect(records.data).toHaveLength(0);
      } finally {
        await sql`
          delete from public.guardian_students
          where guardian_id = ${membershipA.guardian_id} and student_id = ${membershipB.student_id}
        `;
      }
    });
  });

  // T-042 / DBT-32: the attack fixture itself is now impossible —
  // app.validate_membership_link (20261028000029) rejects a membership whose
  // student_id belongs to another institution, so no RLS helper can ever see one.
  it("student branch: a membership whose student_id points at another institution's student is rejected outright", async () => {
    await withTwoInstitutions(async (instA, instB) => {
      const [membershipB] = await sql`
        select student_id from public.memberships where institution_id = ${instB.institutionId} and role = 'student'
      `;

      const admin = adminClient();
      const email = `test-portal-scope-mismatched-student-${crypto.randomUUID()}@test.coolskool.test`;
      const { data: userData, error: userError } = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
      });
      if (userError || !userData.user) throw userError ?? new Error("failed to create mismatched-student test user");

      try {
        await expect(
          sql`
            insert into public.memberships (institution_id, user_id, role, student_id)
            values (${instA.institutionId}, ${userData.user.id}, 'student', ${membershipB.student_id})
          `,
        ).rejects.toThrow(/validation_failed/);
      } finally {
        await admin.auth.admin.deleteUser(userData.user.id);
      }
    });
  });
});
