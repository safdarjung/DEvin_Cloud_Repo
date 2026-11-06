import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mock (BRIEF-COMMON #13) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { addPickupPerson, removePickupPerson } from "@/modules/visitors/pickup.actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

// X07-T6 — visitors.pickup.add / visitors.pickup.remove. Columns exactly as
// 0090: pickup_persons.{student_id, full_name, relation, phone, created_by}.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

async function createExtraStudent(institutionId: string, label: string): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, ${label}, '2015-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

async function guardianIdFor(inst: TestInstitution): Promise<string> {
  const [row] = await sql`
    select guardian_id from public.memberships
    where institution_id = ${inst.institutionId} and user_id = ${inst.users.guardian.id}
  `;
  return row.guardian_id as string;
}

async function linkGuardian(institutionId: string, guardianId: string, studentId: string): Promise<void> {
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
    values (${institutionId}, ${guardianId}, ${studentId}, 'mother', true)
  `;
}

describe("visitors.pickup.add / visitors.pickup.remove", () => {
  it("guardian adds a pickup person for their own child", async () => {
    const inst = await createTestInstitution("pickup-own-child");
    try {
      const guardianId = await guardianIdFor(inst);
      const studentId = await createExtraStudent(inst.institutionId, "Own Child");
      await linkGuardian(inst.institutionId, guardianId, studentId);

      const result = await callAs(inst, "guardian", addPickupPerson, {
        studentId,
        fullName: "Ramesh Sharma",
        relation: "grandparent",
        phone: "9700000011",
      });
      expect(result.ok).toBe(true);
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian cannot add a pickup person for another family's child", async () => {
    const inst = await createTestInstitution("pickup-other-family");
    try {
      const otherStudentId = await createExtraStudent(inst.institutionId, "Other Family Child");

      const result = await callAs(inst, "guardian", addPickupPerson, {
        studentId: otherStudentId,
        fullName: "Stranger",
        relation: "other",
        phone: "9700000012",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("duplicate phone for the same child → conflict with fieldErrors.phone", async () => {
    const inst = await createTestInstitution("pickup-dup-phone");
    try {
      const guardianId = await guardianIdFor(inst);
      const studentId = await createExtraStudent(inst.institutionId, "Dup Phone Child");
      await linkGuardian(inst.institutionId, guardianId, studentId);

      const first = await callAs(inst, "guardian", addPickupPerson, {
        studentId,
        fullName: "Ramesh Sharma",
        relation: "grandparent",
        phone: "9700000013",
      });
      expect(first.ok).toBe(true);

      const dup = await callAs(inst, "guardian", addPickupPerson, {
        studentId,
        fullName: "Ramesh Sharma Again",
        relation: "grandparent",
        phone: "9700000013",
      });
      expect(dup.ok).toBe(false);
      if (dup.ok) return;
      expect(dup.error.code).toBe("conflict");
      expect(dup.error.fieldErrors?.phone).toBeDefined();
    } finally {
      await inst.cleanup();
    }
  });

  it("the same phone on a sibling is fine (unique per student, not per family)", async () => {
    const inst = await createTestInstitution("pickup-sibling-phone");
    try {
      const guardianId = await guardianIdFor(inst);
      const studentA = await createExtraStudent(inst.institutionId, "Sibling A");
      const studentB = await createExtraStudent(inst.institutionId, "Sibling B");
      await linkGuardian(inst.institutionId, guardianId, studentA);
      await linkGuardian(inst.institutionId, guardianId, studentB);

      const first = await callAs(inst, "guardian", addPickupPerson, {
        studentId: studentA,
        fullName: "Suresh Yadav",
        relation: "driver",
        phone: "9700000014",
      });
      expect(first.ok).toBe(true);

      const second = await callAs(inst, "guardian", addPickupPerson, {
        studentId: studentB,
        fullName: "Suresh Yadav",
        relation: "driver",
        phone: "9700000014",
      });
      expect(second.ok).toBe(true);
    } finally {
      await inst.cleanup();
    }
  });

  it("admin adds a pickup person on behalf of a guardian", async () => {
    const inst = await createTestInstitution("pickup-admin-on-behalf");
    try {
      const studentId = await createExtraStudent(inst.institutionId, "Admin Added Child");

      const result = await callAs(inst, "admin", addPickupPerson, {
        studentId,
        fullName: "Driver On Behalf",
        relation: "driver",
        phone: "9700000015",
      });
      expect(result.ok).toBe(true);
    } finally {
      await inst.cleanup();
    }
  });

  it("removing twice → not_found the second time", async () => {
    const inst = await createTestInstitution("pickup-remove-twice");
    try {
      const studentId = await createExtraStudent(inst.institutionId, "Remove Twice Child");
      const added = await callAs(inst, "admin", addPickupPerson, {
        studentId,
        fullName: "Driver To Remove",
        relation: "driver",
        phone: "9700000016",
      });
      expect(added.ok).toBe(true);
      if (!added.ok) return;

      const first = await callAs(inst, "admin", removePickupPerson, { id: added.data.id });
      expect(first.ok).toBe(true);

      const second = await callAs(inst, "admin", removePickupPerson, { id: added.data.id });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.error.code).toBe("not_found");
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher cannot add or remove a pickup person", async () => {
    const inst = await createTestInstitution("pickup-teacher-forbidden");
    try {
      const studentId = await createExtraStudent(inst.institutionId, "Teacher Forbidden Child");

      const add = await callAs(inst, "teacher", addPickupPerson, {
        studentId,
        fullName: "Driver",
        relation: "driver",
        phone: "9700000017",
      });
      expect(add.ok).toBe(false);
      if (add.ok) return;
      expect(add.error.code).toBe("forbidden");

      const remove = await callAs(inst, "teacher", removePickupPerson, { id: crypto.randomUUID() });
      expect(remove.ok).toBe(false);
      if (remove.ok) return;
      expect(remove.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("student cannot add or remove a pickup person", async () => {
    const inst = await createTestInstitution("pickup-student-forbidden");
    try {
      const studentId = await createExtraStudent(inst.institutionId, "Student Forbidden Child");

      const add = await callAs(inst, "student", addPickupPerson, {
        studentId,
        fullName: "Driver",
        relation: "driver",
        phone: "9700000018",
      });
      expect(add.ok).toBe(false);
      if (add.ok) return;
      expect(add.error.code).toBe("forbidden");

      const remove = await callAs(inst, "student", removePickupPerson, { id: crypto.randomUUID() });
      expect(remove.ok).toBe(false);
      if (remove.ok) return;
      expect(remove.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });
});
