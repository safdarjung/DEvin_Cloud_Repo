import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

// Opt-in mocks (T-022 lead review pattern) — only this file's module graph.
import { vi } from "vitest";
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { linkGuardian, updateGuardian, updateStudent } from "@/modules/people/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

// M14-T7 — people.student.update / people.guardian.update / people.guardian.link
// (rulings: plain RLS updates mirror people/actions.ts's upsertStaff; link is
// a thin wrapper over 0076's public.link_guardian).

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

async function studentId(institutionId: string): Promise<string> {
  const [row] = await sql`
    select student_id from public.memberships
    where institution_id = ${institutionId} and role = 'student'
  `;
  return row.student_id as string;
}

async function guardianId(institutionId: string): Promise<string> {
  const [row] = await sql`
    select guardian_id from public.memberships
    where institution_id = ${institutionId} and role = 'guardian'
  `;
  return row.guardian_id as string;
}

describe("people student/guardian actions (M14-T7)", () => {
  it("admissions updates a student's name and dob", async () => {
    const inst = await createTestInstitution("people-student-update-ok");
    const sid = await studentId(inst.institutionId);

    const result = await callAs(inst, "admissions", updateStudent, {
      studentId: sid,
      firstName: "Updated",
      dob: "2016-02-02",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.firstName).toBe("Updated");
    expect(result.data.dob).toBe("2016-02-02");

    const [audit] = await sql`
      select after from public.audit_events
      where entity_id = ${sid}::uuid and action = 'people.student.update'
      order by created_at desc limit 1
    `;
    expect(audit.after).toEqual({ changedFields: ["first_name", "dob"] });
  });

  it("a duplicate admission_no is a conflict", async () => {
    const inst = await createTestInstitution("people-student-update-conflict");
    const sid = await studentId(inst.institutionId);
    const takenAdmissionNo = `ADM-TAKEN-${crypto.randomUUID().slice(0, 8)}`;
    await sql`insert into public.students (institution_id, admission_no, first_name, dob, gender)
      values (${inst.institutionId}, ${takenAdmissionNo}, 'Other', '2015-01-01', 'other')`;

    const result = await callAs(inst, "admin", updateStudent, { studentId: sid, admissionNo: takenAdmissionNo });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("conflict");
    expect(result.error.fieldErrors?.admissionNo).toBeTruthy();
  });

  it("a student from another institution is not_found", async () => {
    const instA = await createTestInstitution("people-student-update-fk-a");
    const instB = await createTestInstitution("people-student-update-fk-b");
    const sidB = await studentId(instB.institutionId);

    const result = await callAs(instA, "admin", updateStudent, { studentId: sidB, firstName: "Nope" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("not_found");
  });

  it("a teacher is forbidden", async () => {
    const inst = await createTestInstitution("people-student-update-forbidden");
    const sid = await studentId(inst.institutionId);

    const result = await callAs(inst, "teacher", updateStudent, { studentId: sid, firstName: "Nope" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("forbidden");
  });

  it("a duplicate guardian phone is a conflict", async () => {
    const inst = await createTestInstitution("people-guardian-update-conflict");
    const gid = await guardianId(inst.institutionId);
    const takenPhone = "9123456780";
    await sql`insert into public.guardians (institution_id, full_name, phone)
      values (${inst.institutionId}, 'Other Guardian', ${takenPhone})`;

    const result = await callAs(inst, "admin", updateGuardian, { guardianId: gid, phone: takenPhone });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("conflict");
    expect(result.error.fieldErrors?.phone).toBeTruthy();
  });

  it("links a new guardian by phone, then reuses it on a second student", async () => {
    const inst = await createTestInstitution("people-guardian-link-ok");
    const sid = await studentId(inst.institutionId);
    const phone = "9988776655";

    const first = await callAs(inst, "admissions", linkGuardian, {
      studentId: sid,
      relationship: "father",
      isPrimary: true,
      guardian: { fullName: "New Guardian", phone },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data.created).toBe(true);

    const [sibling] = await sql`
      insert into public.students (institution_id, admission_no, first_name, dob, gender)
      values (${inst.institutionId}, ${`ADM-SIB-${crypto.randomUUID().slice(0, 8)}`}, 'Sibling', '2017-01-01', 'other')
      returning id
    `;

    const second = await callAs(inst, "admissions", linkGuardian, {
      studentId: sibling.id as string,
      relationship: "father",
      guardian: { fullName: "New Guardian", phone },
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.created).toBe(false);
    expect(second.data.guardianId).toBe(first.data.guardianId);

    const auditRows = await sql`
      select after from public.audit_events
      where entity_id = ${first.data.guardianId}::uuid and action = 'people.guardian.link'
      order by created_at
    `;
    for (const row of auditRows) {
      const text = JSON.stringify(row.after);
      expect(text).not.toContain(phone);
      expect(text).not.toContain("New Guardian");
    }
  });

  it("a teacher is forbidden from linking a guardian", async () => {
    const inst = await createTestInstitution("people-guardian-link-forbidden");
    const sid = await studentId(inst.institutionId);

    const result = await callAs(inst, "teacher", linkGuardian, {
      studentId: sid,
      relationship: "mother",
      guardian: { fullName: "Nope", phone: "9000000001" },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("forbidden");
  });
});
