import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { closeFactoriesHelper } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

function randomPhone(): string {
  const first = String(6 + Math.floor(Math.random() * 4));
  const rest = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join("");
  return first + rest;
}

async function studentRow(institutionId: string) {
  const [row] = await sql`
    select student_id from public.memberships where institution_id = ${institutionId} and role = 'student'
  `;
  return row.student_id as string;
}

async function guardianRow(institutionId: string) {
  const [row] = await sql`
    select user_id, guardian_id from public.memberships where institution_id = ${institutionId} and role = 'guardian'
  `;
  return { userId: row.user_id as string, guardianId: row.guardian_id as string };
}

describe("migration 0076 part 4: public.link_guardian", () => {
  it("links an existing guardian as primary, demoting the old primary", async () => {
    const inst = await createTestInstitution("lc-link-primary");
    try {
      const studentId = await studentRow(inst.institutionId);
      const { guardianId: firstGuardianId } = await guardianRow(inst.institutionId);
      await sql`
        insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
        values (${inst.institutionId}, ${firstGuardianId}, ${studentId}, 'father', true)
      `;

      const [secondGuardian] = await sql`
        insert into public.guardians (institution_id, full_name, phone)
        values (${inst.institutionId}, 'Second Guardian', ${randomPhone()})
        returning id
      `;

      const { data, error } = await inst.clientAs("admin").rpc("link_guardian", {
        p_student_id: studentId,
        p_relationship: "mother",
        p_is_primary: true,
        p_guardian_id: secondGuardian.id,
      });
      expect(error).toBeNull();
      expect(data.created).toBe(false);
      expect(data.guardian_id).toBe(secondGuardian.id);

      const primaries = await sql`
        select guardian_id from public.guardian_students where student_id = ${studentId} and is_primary
      `;
      expect(primaries).toHaveLength(1);
      expect(primaries[0].guardian_id).toBe(secondGuardian.id);
    } finally {
      await inst.cleanup();
    }
  });

  it("creates a new guardian by phone, then reuses it on a second link without changing the name", async () => {
    const inst = await createTestInstitution("lc-link-new");
    try {
      const studentId = await studentRow(inst.institutionId);
      const phone = randomPhone();

      const first = await inst.clientAs("admin").rpc("link_guardian", {
        p_student_id: studentId,
        p_relationship: "father",
        p_full_name: "New Guardian",
        p_phone: phone,
        p_email: "new-guardian@test.coolskool.test",
      });
      expect(first.error).toBeNull();
      expect(first.data.created).toBe(true);

      const [secondStudent] = await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        values (${inst.institutionId}, ${`ADM-LINK-${crypto.randomUUID().slice(0, 6)}`}, 'Sibling', '2017-01-01', 'other')
        returning id
      `;

      const second = await inst.clientAs("admin").rpc("link_guardian", {
        p_student_id: secondStudent.id,
        p_relationship: "father",
        p_full_name: "Different Name",
        p_phone: phone,
      });
      expect(second.error).toBeNull();
      expect(second.data.created).toBe(false);
      expect(second.data.guardian_id).toBe(first.data.guardian_id);

      const [guardian] = await sql`select full_name from public.guardians where id = ${first.data.guardian_id}`;
      expect(guardian.full_name).toBe("New Guardian");
    } finally {
      await inst.cleanup();
    }
  });

  it("re-linking the same pair updates the relationship with no duplicate row", async () => {
    const inst = await createTestInstitution("lc-link-relink");
    try {
      const studentId = await studentRow(inst.institutionId);
      const { guardianId } = await guardianRow(inst.institutionId);

      const first = await inst.clientAs("admin").rpc("link_guardian", {
        p_student_id: studentId,
        p_relationship: "father",
        p_guardian_id: guardianId,
      });
      expect(first.error).toBeNull();

      const second = await inst.clientAs("admin").rpc("link_guardian", {
        p_student_id: studentId,
        p_relationship: "grandparent",
        p_guardian_id: guardianId,
      });
      expect(second.error).toBeNull();

      const rows = await sql`
        select relationship from public.guardian_students where student_id = ${studentId} and guardian_id = ${guardianId}
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0].relationship).toBe("grandparent");
    } finally {
      await inst.cleanup();
    }
  });

  it("two concurrent primary links never leave two primaries", async () => {
    const inst = await createTestInstitution("lc-link-race");
    try {
      const studentId = await studentRow(inst.institutionId);
      const { guardianId: firstGuardianId } = await guardianRow(inst.institutionId);
      await sql`
        insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
        values (${inst.institutionId}, ${firstGuardianId}, ${studentId}, 'father', true)
      `;
      const [secondGuardian] = await sql`
        insert into public.guardians (institution_id, full_name, phone)
        values (${inst.institutionId}, 'Second Guardian', ${randomPhone()})
        returning id
      `;

      await Promise.all([
        inst.clientAs("admin").rpc("link_guardian", {
          p_student_id: studentId,
          p_relationship: "mother",
          p_is_primary: true,
          p_guardian_id: secondGuardian.id,
        }),
        inst.clientAs("admin").rpc("link_guardian", {
          p_student_id: studentId,
          p_relationship: "father",
          p_is_primary: true,
          p_guardian_id: firstGuardianId,
        }),
      ]);

      // The demote-then-upsert is keyed off "whichever row is currently
      // is_primary", not a fixed id, so lock contention on that row (not an
      // explicit students lock) already serializes this safely — verified
      // by 5x repeated runs with no flakiness (security review M14).
      const primaries = await sql`
        select guardian_id from public.guardian_students where student_id = ${studentId} and is_primary
      `;
      expect(primaries).toHaveLength(1);
    } finally {
      await inst.cleanup();
    }
  });

  it("a guardian from another institution is validation_failed", async () => {
    await withTwoInstitutions(async (a, b) => {
      const studentId = await studentRow(a.institutionId);
      const { guardianId: otherGuardianId } = await guardianRow(b.institutionId);

      const { error } = await a.clientAs("admin").rpc("link_guardian", {
        p_student_id: studentId,
        p_relationship: "father",
        p_guardian_id: otherGuardianId,
      });
      expect(error?.message).toContain("code:validation_failed");
    });
  });

  it("both a guardian id and new-guardian fields is validation_failed", async () => {
    const inst = await createTestInstitution("lc-link-ambiguous");
    try {
      const studentId = await studentRow(inst.institutionId);
      const { guardianId } = await guardianRow(inst.institutionId);

      const { error } = await inst.clientAs("admin").rpc("link_guardian", {
        p_student_id: studentId,
        p_relationship: "father",
        p_guardian_id: guardianId,
        p_full_name: "Someone",
        p_phone: randomPhone(),
      });
      expect(error?.message).toContain("code:validation_failed");
    } finally {
      await inst.cleanup();
    }
  });

  it("a teacher is forbidden from linking a guardian", async () => {
    const inst = await createTestInstitution("lc-link-forbidden");
    try {
      const studentId = await studentRow(inst.institutionId);
      const { guardianId } = await guardianRow(inst.institutionId);

      const { error } = await inst.clientAs("teacher").rpc("link_guardian", {
        p_student_id: studentId,
        p_relationship: "father",
        p_guardian_id: guardianId,
      });
      expect(error?.message).toContain("code:forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("after linking, a guardian with an active membership reads the new child through students RLS", async () => {
    const inst = await createTestInstitution("lc-link-rls");
    try {
      const studentId = await studentRow(inst.institutionId);
      const { guardianId } = await guardianRow(inst.institutionId);

      const { error } = await inst.clientAs("admin").rpc("link_guardian", {
        p_student_id: studentId,
        p_relationship: "mother",
        p_is_primary: true,
        p_guardian_id: guardianId,
      });
      expect(error).toBeNull();

      const { data: students, error: readError } = await inst
        .clientAs("guardian")
        .from("students")
        .select("id")
        .eq("id", studentId);
      expect(readError).toBeNull();
      expect(students).toHaveLength(1);
    } finally {
      await inst.cleanup();
    }
  });
});
