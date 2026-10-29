import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

describe("people migration (0004) RLS", () => {
  it("C-10: a guardian/teacher of institution A gets 0 rows for a student id from institution B", async () => {
    await withTwoInstitutions(async (a, b) => {
      const [bStudent] = await sql`
        select id from public.students where institution_id = ${b.institutionId}
      `;
      const bStudentId = bStudent.id;

      const asGuardian = await a.clientAs("guardian").from("students").select("id").eq("id", bStudentId);
      expect(asGuardian.data).toHaveLength(0);

      const asTeacher = await a.clientAs("teacher").from("students").select("id").eq("id", bStudentId);
      expect(asTeacher.data).toHaveLength(0);
    });
  });

  it("C-11 + AC4: a guardian sees exactly their own linked children, a student sees only their own row", async () => {
    const inst = await createTestInstitution("people-c11");
    try {
      const [s1] = await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        values (${inst.institutionId}, 'ADM-S1', 'Child One', '2016-01-01', 'female')
        returning id
      `;
      const [s2] = await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        values (${inst.institutionId}, 'ADM-S2', 'Child Two', '2016-01-01', 'male')
        returning id
      `;

      const [g1] = await sql`
        select guardian_id from public.memberships
        where institution_id = ${inst.institutionId} and role = 'guardian'
      `;
      const [g2] = await sql`
        insert into public.guardians (institution_id, full_name, phone)
        values (${inst.institutionId}, 'Other Guardian', '9111111111')
        returning id
      `;

      await sql`
        insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
        values (${inst.institutionId}, ${g1.guardian_id}, ${s1.id}, 'mother', true)
      `;
      await sql`
        insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
        values (${inst.institutionId}, ${g2.id}, ${s2.id}, 'mother', true)
      `;

      const g1Students = await inst.clientAs("guardian").from("students").select("id");
      expect(g1Students.data?.map((r) => r.id)).toEqual([s1.id]);

      const g1Link = await inst.clientAs("guardian").from("guardian_students").select("student_id").eq("student_id", s2.id);
      expect(g1Link.data).toHaveLength(0);

      // AC4: a student sees only their own students row.
      const ownStudentId = (
        await sql`
          select student_id from public.memberships
          where institution_id = ${inst.institutionId} and role = 'student'
        `
      )[0].student_id;
      const studentRows = await inst.clientAs("student").from("students").select("id");
      expect(studentRows.data?.map((r) => r.id)).toEqual([ownStudentId]);
    } finally {
      await inst.cleanup();
    }
  });

  it("AC5: a second primary guardian for the same student is rejected", async () => {
    const inst = await createTestInstitution("people-ac5a");
    try {
      const [student] = await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        values (${inst.institutionId}, 'ADM-P1', 'Primary Test', '2016-01-01', 'other')
        returning id
      `;
      const [guardianA] = await sql`
        insert into public.guardians (institution_id, full_name, phone)
        values (${inst.institutionId}, 'Primary Guardian A', '9222222221')
        returning id
      `;
      const [guardianB] = await sql`
        insert into public.guardians (institution_id, full_name, phone)
        values (${inst.institutionId}, 'Primary Guardian B', '9222222222')
        returning id
      `;

      await sql`
        insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
        values (${inst.institutionId}, ${guardianA.id}, ${student.id}, 'mother', true)
      `;

      await expect(
        sql`
          insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
          values (${inst.institutionId}, ${guardianB.id}, ${student.id}, 'father', true)
        `,
      ).rejects.toThrow();
    } finally {
      await inst.cleanup();
    }
  });

  it("AC5: a duplicate guardian phone within the same institution is rejected", async () => {
    const inst = await createTestInstitution("people-ac5b");
    try {
      await sql`
        insert into public.guardians (institution_id, full_name, phone)
        values (${inst.institutionId}, 'Dup Phone A', '9333333333')
      `;

      await expect(
        sql`
          insert into public.guardians (institution_id, full_name, phone)
          values (${inst.institutionId}, 'Dup Phone B', '9333333333')
        `,
      ).rejects.toThrow();
    } finally {
      await inst.cleanup();
    }
  });

  it("AC5: a duplicate source_application_id across students is rejected", async () => {
    const inst = await createTestInstitution("people-ac5c");
    try {
      const applicationId = crypto.randomUUID();
      await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender, source_application_id)
        values (${inst.institutionId}, 'ADM-SRC1', 'Src One', '2016-01-01', 'other', ${applicationId})
      `;

      await expect(
        sql`
          insert into public.students (institution_id, admission_no, first_name, dob, gender, source_application_id)
          values (${inst.institutionId}, 'ADM-SRC2', 'Src Two', '2016-01-01', 'other', ${applicationId})
        `,
      ).rejects.toThrow();
    } finally {
      await inst.cleanup();
    }
  });
});
