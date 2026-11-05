// X07-T2 — migration 0090 RLS + guards: visitor_entries, pickup_persons,
// gate_passes. Real signed-in clients + real RLS, same pattern as
// operations-rls.test.ts (0075).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { isModuleEnabled } from "@/lib/modules/catalog";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createEnrolment,
  createGrade,
  createSubject,
  createSubjectAssignment,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });
const PASSWORD = "correct-horse-battery-staple";
const bareInstitutionIds: string[] = [];

afterAll(async () => {
  if (bareInstitutionIds.length > 0) {
    await sql`delete from public.institutions where id in ${sql(bareInstitutionIds)}`;
  }
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

function adminClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
}

function randomPhone(): string {
  const first = String(6 + Math.floor(Math.random() * 4));
  const rest = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join("");
  return first + rest;
}

/** A second guardian + their own child in an already-created institution. */
async function addGuardianWithChild(inst: TestInstitution, label: string): Promise<{ client: SupabaseClient; guardianId: string; studentId: string }> {
  const admin = adminClient();
  const email = `second-${label}-${crypto.randomUUID()}@test.coolskool.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw error ?? new Error(`failed to create ${label}`);

  const [guardian] = await sql`
    insert into public.guardians (institution_id, full_name, phone)
    values (${inst.institutionId}, ${label}, ${randomPhone()})
    returning id
  `;
  await sql`
    insert into public.memberships (institution_id, user_id, role, guardian_id)
    values (${inst.institutionId}, ${data.user.id}, 'guardian', ${guardian.id})
  `;
  const [student] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${inst.institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, ${label}, '2015-01-01', 'other')
    returning id
  `;
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${inst.institutionId}, ${guardian.id}, ${student.id}, 'father', true, true)
  `;

  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError) throw signInError;
  return { client, guardianId: guardian.id as string, studentId: student.id as string };
}

/** A second staff member (any staff role) in an already-created institution. */
async function addStaffMember(inst: TestInstitution, role: string, label: string): Promise<{ client: SupabaseClient; staffId: string }> {
  const admin = adminClient();
  const email = `second-${label}-${crypto.randomUUID()}@test.coolskool.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw error ?? new Error(`failed to create ${label}`);

  const [staff] = await sql`
    insert into public.staff (institution_id, employee_no, full_name, designation)
    values (${inst.institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, ${label}, ${role})
    returning id
  `;
  await sql`
    insert into public.memberships (institution_id, user_id, role, staff_id)
    values (${inst.institutionId}, ${data.user.id}, ${role}, ${staff.id})
  `;

  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError) throw signInError;
  return { client, staffId: staff.id as string };
}

async function fixtureStaffId(institutionId: string, role: string): Promise<string> {
  const [row] = await sql`select staff_id from public.memberships where institution_id = ${institutionId} and role = ${role}`;
  return row.staff_id as string;
}

async function fixtureStudentId(institutionId: string, role: string): Promise<string> {
  const [row] = await sql`select student_id from public.memberships where institution_id = ${institutionId} and role = ${role}`;
  return row.student_id as string;
}

async function fixtureGuardianId(institutionId: string, role: string): Promise<string> {
  const [row] = await sql`select guardian_id from public.memberships where institution_id = ${institutionId} and role = ${role}`;
  return row.guardian_id as string;
}

async function linkGuardianToStudent(institutionId: string, guardianId: string, studentId: string) {
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${institutionId}, ${guardianId}, ${studentId}, 'father', true, true)
  `;
}

describe("visitors migration (0090) RLS + guards", () => {
  it("id_last4 must be 4 chars (12-digit Aadhaar rejected); id_type without id_last4 rejected", async () => {
    const inst = await createTestInstitution("vis-id-checks");
    try {
      const staffId = await fixtureStaffId(inst.institutionId, "admin");
      await expect(
        sql`
          insert into public.visitor_entries (institution_id, full_name, phone, purpose, host_staff_id, checked_in_by, id_type, id_last4)
          values (${inst.institutionId}, 'V One', '9800000001', 'Enquiry', ${staffId}, ${inst.users.admin.id}, 'aadhaar', '123456789012')
        `,
      ).rejects.toMatchObject({ code: "23514" });

      await expect(
        sql`
          insert into public.visitor_entries (institution_id, full_name, phone, purpose, host_staff_id, checked_in_by, id_type)
          values (${inst.institutionId}, 'V Two', '9800000002', 'Enquiry', ${staffId}, ${inst.users.admin.id}, 'pan')
        `,
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await inst.cleanup();
    }
  });

  it("admin checks in (checked_in_by forced to caller, backdated checked_in_at overwritten) and checks out; a second check-out is invalid_state", async () => {
    const inst = await createTestInstitution("vis-checkin");
    try {
      const staffId = await fixtureStaffId(inst.institutionId, "admin");
      const otherUser = await addStaffMember(inst, "teacher", "other-teacher");

      const backdated = "2020-01-01T00:00:00Z";
      const checkIn = await inst
        .clientAs("admin")
        .from("visitor_entries")
        .insert({
          institution_id: inst.institutionId,
          full_name: "Ramesh",
          phone: "9800000003",
          purpose: "Fee enquiry",
          host_staff_id: staffId,
          checked_in_at: backdated,
          checked_in_by: otherUser.staffId, // not a valid profile id either way — must be overwritten, not used
        })
        .select("id, checked_in_at, checked_in_by")
        .single();
      expect(checkIn.error).toBeNull();
      expect(checkIn.data?.checked_in_by).toBe(inst.users.admin.id);
      expect(new Date(checkIn.data?.checked_in_at as string).getFullYear()).toBeGreaterThan(2020);
      const entryId = checkIn.data?.id as string;

      const checkOut = await inst.clientAs("admin").from("visitor_entries").update({ checked_out_at: new Date().toISOString() }).eq("id", entryId).select("checked_out_at, checked_out_by").single();
      expect(checkOut.error).toBeNull();
      expect(checkOut.data?.checked_out_by).toBe(inst.users.admin.id);

      await expect(sql`update public.visitor_entries set checked_out_at = now() where id = ${entryId}`).rejects.toThrow(/invalid_state/);
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher cannot read visitor_entries", async () => {
    const inst = await createTestInstitution("vis-teacher-read");
    try {
      const staffId = await fixtureStaffId(inst.institutionId, "admin");
      await sql`
        insert into public.visitor_entries (institution_id, full_name, phone, purpose, host_staff_id, checked_in_by)
        values (${inst.institutionId}, 'V', '9800000004', 'p', ${staffId}, ${inst.users.admin.id})
      `;
      const teacherRead = await inst.clientAs("teacher").from("visitor_entries").select("id");
      expect(teacherRead.error).toBeNull();
      expect(teacherRead.data).toEqual([]);
    } finally {
      await inst.cleanup();
    }
  });

  it("deletes a 181-day-old visitor entry but not a fresh one (retention purge)", async () => {
    const inst = await createTestInstitution("vis-retention");
    try {
      const staffId = await fixtureStaffId(inst.institutionId, "admin");
      const [fresh] = await sql`
        insert into public.visitor_entries (institution_id, full_name, phone, purpose, host_staff_id, checked_in_by)
        values (${inst.institutionId}, 'Fresh', '9800000005', 'p', ${staffId}, ${inst.users.admin.id})
        returning id
      `;
      const [old] = await sql`
        insert into public.visitor_entries (institution_id, full_name, phone, purpose, host_staff_id, checked_in_by, checked_in_at)
        values (${inst.institutionId}, 'Old', '9800000006', 'p', ${staffId}, ${inst.users.admin.id}, now() - interval '181 days')
        returning id
      `;

      const freshDelete = await inst.clientAs("admin").from("visitor_entries").delete().eq("id", fresh.id).select("id");
      expect(freshDelete.data).toEqual([]);

      const oldDelete = await inst.clientAs("admin").from("visitor_entries").delete().eq("id", old.id).select("id");
      expect(oldDelete.error).toBeNull();
      expect((oldDelete.data ?? []).map((r) => r.id)).toEqual([old.id]);
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian adds a pickup person for own child, not for another family's child; student cannot insert", async () => {
    const inst = await createTestInstitution("vis-pickup-write");
    try {
      const guardianId = await fixtureGuardianId(inst.institutionId, "guardian");
      const studentId = await fixtureStudentId(inst.institutionId, "student");
      await linkGuardianToStudent(inst.institutionId, guardianId, studentId);

      const ownAdd = await inst
        .clientAs("guardian")
        .from("pickup_persons")
        .insert({ institution_id: inst.institutionId, student_id: studentId, full_name: "Grandpa", relation: "grandparent", phone: "9800000007" })
        .select("id")
        .single();
      expect(ownAdd.error).toBeNull();

      const familyB = await addGuardianWithChild(inst, "family-b");
      const crossAdd = await inst
        .clientAs("guardian")
        .from("pickup_persons")
        .insert({ institution_id: inst.institutionId, student_id: familyB.studentId, full_name: "Stranger", relation: "other", phone: "9800000008" })
        .select("id");
      expect(crossAdd.error).not.toBeNull();
      expect(crossAdd.error?.code).toBe("42501");

      const studentAdd = await inst
        .clientAs("student")
        .from("pickup_persons")
        .insert({ institution_id: inst.institutionId, student_id: studentId, full_name: "X", relation: "other", phone: "9800000009" })
        .select("id");
      expect(studentAdd.error).not.toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("class teacher reads pickups of own section only; a subject-only teacher of the same section reads none", async () => {
    const inst = await createTestInstitution("vis-pickup-teacher-scope");
    try {
      const classTeacherStaffId = await fixtureStaffId(inst.institutionId, "teacher");
      const subjectTeacher = await addStaffMember(inst, "teacher", "subject-only");

      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { classTeacherId: classTeacherStaffId });
      const subjectId = await createSubject(inst.institutionId);
      await createSubjectAssignment(inst.institutionId, sectionId, subjectId, subjectTeacher.staffId);

      const studentId = await fixtureStudentId(inst.institutionId, "student");
      await createEnrolment(inst.institutionId, studentId, sectionId, yearId);

      await sql`
        insert into public.pickup_persons (institution_id, student_id, full_name, relation, phone, created_by)
        values (${inst.institutionId}, ${studentId}, 'Driver', 'driver', '9800000010', ${inst.users.admin.id})
      `;

      const classTeacherRead = await inst.clientAs("teacher").from("pickup_persons").select("id").eq("student_id", studentId);
      expect(classTeacherRead.error).toBeNull();
      expect(classTeacherRead.data).toHaveLength(1);

      const subjectTeacherRead = await subjectTeacher.client.from("pickup_persons").select("id").eq("student_id", studentId);
      expect(subjectTeacherRead.error).toBeNull();
      expect(subjectTeacherRead.data).toEqual([]);
    } finally {
      await inst.cleanup();
    }
  });

  it("gate pass validation: pickup person of another student is validation_failed; an unlinked guardian is validation_failed", async () => {
    const inst = await createTestInstitution("vis-gatepass-validation");
    try {
      const classTeacherStaffId = await fixtureStaffId(inst.institutionId, "teacher");
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { classTeacherId: classTeacherStaffId });
      const studentId = await fixtureStudentId(inst.institutionId, "student");
      await createEnrolment(inst.institutionId, studentId, sectionId, yearId);

      const familyB = await addGuardianWithChild(inst, "family-b-gp");
      const [otherStudentsPickup] = await sql`
        insert into public.pickup_persons (institution_id, student_id, full_name, relation, phone, created_by)
        values (${inst.institutionId}, ${familyB.studentId}, 'Someone', 'other', '9800000011', ${inst.users.admin.id})
        returning id
      `;

      const crossPickup = await inst
        .clientAs("teacher")
        .from("gate_passes")
        .insert({ institution_id: inst.institutionId, student_id: studentId, reason: "Dentist", pickup_person_id: otherStudentsPickup.id })
        .select("id");
      expect(crossPickup.error).not.toBeNull();
      expect(crossPickup.error?.message).toMatch(/validation_failed/);

      const guardianId = await fixtureGuardianId(inst.institutionId, "guardian"); // never linked to this institution's student
      const unlinkedGuardian = await inst
        .clientAs("teacher")
        .from("gate_passes")
        .insert({ institution_id: inst.institutionId, student_id: studentId, reason: "Dentist", guardian_id: guardianId })
        .select("id");
      expect(unlinkedGuardian.error).not.toBeNull();
      expect(unlinkedGuardian.error?.message).toMatch(/validation_failed/);
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher insert forced to pending with collector snapshotted; second open pass for the same student is a conflict; teacher cannot update a pass of another section", async () => {
    const inst = await createTestInstitution("vis-gatepass-lifecycle");
    try {
      const classTeacherStaffId = await fixtureStaffId(inst.institutionId, "teacher");
      const otherSectionTeacher = await addStaffMember(inst, "teacher", "other-section");

      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { classTeacherId: classTeacherStaffId });
      await createClassSection(inst.institutionId, gradeId, yearId, { name: "B", classTeacherId: otherSectionTeacher.staffId });

      const studentId = await fixtureStudentId(inst.institutionId, "student");
      await createEnrolment(inst.institutionId, studentId, sectionId, yearId);

      const guardianId = await fixtureGuardianId(inst.institutionId, "guardian");
      await linkGuardianToStudent(inst.institutionId, guardianId, studentId);

      const created = await inst
        .clientAs("teacher")
        .from("gate_passes")
        .insert({ institution_id: inst.institutionId, student_id: studentId, reason: "Dentist appointment", guardian_id: guardianId })
        .select("id, status, collector_name, requested_by")
        .single();
      expect(created.error).toBeNull();
      expect(created.data?.status).toBe("pending");
      expect(created.data?.collector_name).toBe("Test Guardian guardian"); // createTestInstitution's fixture guardian full_name
      expect(created.data?.requested_by).toBe(inst.users.teacher.id);
      const passId = created.data?.id as string;

      const second = await inst
        .clientAs("teacher")
        .from("gate_passes")
        .insert({ institution_id: inst.institutionId, student_id: studentId, reason: "Second one", guardian_id: guardianId })
        .select("id");
      expect(second.error).not.toBeNull();
      expect(second.error?.code).toBe("23505");

      const otherSectionUpdate = await otherSectionTeacher.client.from("gate_passes").update({ status: "approved" }).eq("id", passId).select("id");
      expect(otherSectionUpdate.data).toEqual([]);

      const approve = await inst.clientAs("admin").from("gate_passes").update({ status: "approved" }).eq("id", passId).select("status, decided_by").single();
      expect(approve.error).toBeNull();
      expect(approve.data?.status).toBe("approved");

      const job = await sql`select type, payload from public.jobs where idempotency_key = ${`gatepass:${passId}`}`;
      expect(job).toHaveLength(1);
      expect(job[0].type).toBe("notify.gate_pass");

      const exit = await inst.clientAs("admin").from("gate_passes").update({ status: "exited" }).eq("id", passId).select("status, exited_at").single();
      expect(exit.error).toBeNull();
      expect(exit.data?.status).toBe("exited");

      await expect(sql`update public.gate_passes set status = 'approved' where id = ${passId}`).rejects.toThrow(/invalid_state/);
      await expect(sql`update public.gate_passes set reason = 'edited' where id = ${passId}`).rejects.toThrow(/invalid_state/);
    } finally {
      await inst.cleanup();
    }
  });

  it("a guardian removing a pickup person used by an exited gate pass leaves the pass with collector_name and pickup_person_id null", async () => {
    const inst = await createTestInstitution("vis-gatepass-cascade");
    try {
      const classTeacherStaffId = await fixtureStaffId(inst.institutionId, "teacher");
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { classTeacherId: classTeacherStaffId });
      const studentId = await fixtureStudentId(inst.institutionId, "student");
      await createEnrolment(inst.institutionId, studentId, sectionId, yearId);

      const guardianId = await fixtureGuardianId(inst.institutionId, "guardian");
      await linkGuardianToStudent(inst.institutionId, guardianId, studentId);

      const pickup = await inst
        .clientAs("guardian")
        .from("pickup_persons")
        .insert({ institution_id: inst.institutionId, student_id: studentId, full_name: "Driver Suresh", relation: "driver", phone: "9800000012" })
        .select("id")
        .single();
      expect(pickup.error).toBeNull();
      const pickupId = pickup.data?.id as string;

      const [pass] = await sql`
        insert into public.gate_passes (institution_id, student_id, reason, pickup_person_id, requested_by)
        values (${inst.institutionId}, ${studentId}, 'Driver pickup', ${pickupId}, ${inst.users.admin.id})
        returning id, collector_name
      `;
      await sql`update public.gate_passes set status = 'approved' where id = ${pass.id}`;
      await sql`update public.gate_passes set status = 'exited' where id = ${pass.id}`;

      const removed = await inst.clientAs("guardian").from("pickup_persons").delete().eq("id", pickupId).select("id");
      expect(removed.error).toBeNull();
      expect((removed.data ?? []).map((r) => r.id)).toEqual([pickupId]);

      const [after] = await sql`select pickup_person_id, collector_name, status from public.gate_passes where id = ${pass.id}`;
      expect(after.pickup_person_id).toBeNull();
      expect(after.collector_name).toBe(pass.collector_name);
      expect(after.status).toBe("exited");
    } finally {
      await inst.cleanup();
    }
  });

  it("admin of institution A cannot reference institution B's staff, student, guardian or pickup person", async () => {
    await withTwoInstitutions(async (instA, instB) => {
      const staffB = await fixtureStaffId(instB.institutionId, "admin");
      const studentB = await fixtureStudentId(instB.institutionId, "student");
      const guardianB = await fixtureGuardianId(instB.institutionId, "guardian");
      const [pickupB] = await sql`
        insert into public.pickup_persons (institution_id, student_id, full_name, relation, phone, created_by)
        values (${instB.institutionId}, ${studentB}, 'B Pickup', 'other', '9800000013', ${instB.users.admin.id})
        returning id
      `;

      const admin = instA.clientAs("admin");

      const crossHost = await admin
        .from("visitor_entries")
        .insert({ institution_id: instA.institutionId, full_name: "X", phone: "9800000014", purpose: "p", host_staff_id: staffB, checked_in_by: instA.users.admin.id })
        .select("id");
      expect(crossHost.error).not.toBeNull();

      const crossPickupStudent = await admin
        .from("pickup_persons")
        .insert({ institution_id: instA.institutionId, student_id: studentB, full_name: "X", relation: "other", phone: "9800000015", created_by: instA.users.admin.id })
        .select("id");
      expect(crossPickupStudent.error).not.toBeNull();

      const studentA = await fixtureStudentId(instA.institutionId, "student");
      const crossGuardian = await admin
        .from("gate_passes")
        .insert({ institution_id: instA.institutionId, student_id: studentA, reason: "p", guardian_id: guardianB })
        .select("id");
      expect(crossGuardian.error).not.toBeNull();

      const crossPickupPass = await admin
        .from("gate_passes")
        .insert({ institution_id: instA.institutionId, student_id: studentA, reason: "p", pickup_person_id: pickupB.id })
        .select("id");
      expect(crossPickupPass.error).not.toBeNull();
    });
  });

  it("app.module_enabled('visitors') is false for a bare institution and true once allModulesOn() is applied", async () => {
    const institutionId = crypto.randomUUID();
    bareInstitutionIds.push(institutionId);
    await sql`
      insert into public.institutions (id, slug, name, settings)
      values (${institutionId}, ${`test-vis-mod-${institutionId}`}, 'visitors module test', '{}')
    `;
    const [bare] = await sql`select app.module_enabled(${institutionId}::uuid, 'visitors') as enabled`;
    expect(bare.enabled).toBe(isModuleEnabled({ institution: { settings: {} } }, "visitors"));
    expect(bare.enabled).toBe(false);

    const inst = await createTestInstitution("vis-module-on"); // allModulesOn() via roles.ts
    try {
      const [on] = await sql`select app.module_enabled(${inst.institutionId}::uuid, 'visitors') as enabled`;
      expect(on.enabled).toBe(true);
    } finally {
      await inst.cleanup();
    }
  });
});
