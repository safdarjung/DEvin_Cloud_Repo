import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mock (leave-actions.test.ts pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { permissionsFor } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import type { Database } from "@/lib/db/types";
import { createGatePass, setGatePassStatus } from "@/modules/visitors/gate-pass.actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createEnrolment,
  createGrade,
} from "../helpers/factories";
import { setActingClient } from "../helpers/server-client-mock";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

// X07-T5 — visitors.gatePass.create / visitors.gatePass.setStatus
// (X07-tasks.md Task 5 rulings; migration 0090 built in T2).
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const PASSWORD = "correct-horse-battery-staple";

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
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

async function linkGuardianToStudent(institutionId: string, guardianId: string, studentId: string): Promise<void> {
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${institutionId}, ${guardianId}, ${studentId}, 'father', true, true)
  `;
}

/** A second staff member (any staff role) in an already-created institution — not the class teacher. */
async function addStaffMember(inst: TestInstitution, role: string, label: string): Promise<{ client: SupabaseClient; staffId: string; userId: string }> {
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
  return { client, staffId: staff.id as string, userId: data.user.id };
}

/** Sets up a class-teacher section with the fixture student enrolled, and links the fixture guardian as primary. */
async function setupClassTeacherAndStudent(inst: TestInstitution): Promise<{ studentId: string; guardianId: string }> {
  const classTeacherStaffId = await fixtureStaffId(inst.institutionId, "teacher");
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId);
  const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { classTeacherId: classTeacherStaffId });
  const studentId = await fixtureStudentId(inst.institutionId, "student");
  await createEnrolment(inst.institutionId, studentId, sectionId, yearId);
  const guardianId = await fixtureGuardianId(inst.institutionId, "guardian");
  await linkGuardianToStudent(inst.institutionId, guardianId, studentId);
  return { studentId, guardianId };
}

/** TenantContext for a staff member outside the fixture's role map (e.g. a second teacher), mirroring tests/helpers/actions.ts's buildContext. */
async function buildStaffContext(inst: TestInstitution, userId: string, staffId: string, role: "teacher"): Promise<TenantContext> {
  const [institution] = await sql`
    select id, slug, name, settings, ai_policy, is_demo from public.institutions where id = ${inst.institutionId}
  `;
  const [profile] = await sql`
    select full_name, phone, avatar_path, is_platform_admin from public.profiles where id = ${userId}
  `;
  return {
    institution: {
      id: institution.id,
      slug: institution.slug,
      name: institution.name,
      settings: institution.settings ?? {},
      ai_policy: institution.ai_policy,
      is_demo: institution.is_demo,
    },
    user: {
      id: userId,
      profile: {
        fullName: profile.full_name,
        phone: profile.phone,
        avatarPath: profile.avatar_path,
        isPlatformAdmin: profile.is_platform_admin,
      },
    },
    membership: { role, staffId, guardianId: null, studentId: null },
    permissions: new Set(permissionsFor(role)),
  };
}

describe("visitors.gatePass.* actions (X07-T5)", () => {
  it("class teacher creates for own-section student with primary guardian -> pending, collectorName = guardian name", async () => {
    const inst = await createTestInstitution("gp-act-create");
    try {
      const { studentId, guardianId } = await setupClassTeacherAndStudent(inst);
      const result = await callAs(inst, "teacher", createGatePass, {
        studentId,
        guardianId,
        reason: "Dentist appointment",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.status).toBe("pending");

      const [row] = await sql`select collector_name, requested_by from public.gate_passes where id = ${result.data.id}`;
      expect(row.collector_name).toBe("Test Guardian guardian");
      expect(row.requested_by).toBe(inst.users.teacher.id);
    } finally {
      await inst.cleanup();
    }
  });

  it("admin approves -> approved + one queued notify.gate_pass job; exit -> exited; exited -> approved is invalid_state", async () => {
    const inst = await createTestInstitution("gp-act-lifecycle");
    try {
      const { studentId, guardianId } = await setupClassTeacherAndStudent(inst);
      const created = await callAs(inst, "teacher", createGatePass, { studentId, guardianId, reason: "Dentist appointment" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const approved = await callAs(inst, "admin", setGatePassStatus, { id: created.data.id, status: "approved" });
      expect(approved.ok).toBe(true);
      if (!approved.ok) return;
      expect(approved.data.status).toBe("approved");

      const jobs = await sql`select type from public.jobs where idempotency_key = ${`gatepass:${created.data.id}`}`;
      expect(jobs).toHaveLength(1);
      expect(jobs[0].type).toBe("notify.gate_pass");

      const auditRows = await sql`
        select before, after from public.audit_events
        where entity_id = ${created.data.id}::uuid and action = 'visitors.gate_pass.set_status'
      `;
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].before).toEqual({ status: "pending" });
      expect(auditRows[0].after).toEqual({ status: "approved" });

      const exited = await callAs(inst, "admin", setGatePassStatus, { id: created.data.id, status: "exited" });
      expect(exited.ok).toBe(true);
      if (!exited.ok) return;
      expect(exited.data.status).toBe("exited");

      const backToApproved = await callAs(inst, "admin", setGatePassStatus, { id: created.data.id, status: "approved" });
      expect(backToApproved.ok).toBe(false);
      if (backToApproved.ok) return;
      expect(backToApproved.error.code).toBe("invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("second open pass for the same student is a conflict with fieldErrors.studentId", async () => {
    const inst = await createTestInstitution("gp-act-conflict");
    try {
      const { studentId, guardianId } = await setupClassTeacherAndStudent(inst);
      const first = await callAs(inst, "teacher", createGatePass, { studentId, guardianId, reason: "First" });
      expect(first.ok).toBe(true);

      const second = await callAs(inst, "teacher", createGatePass, { studentId, guardianId, reason: "Second" });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.error.code).toBe("conflict");
      expect(second.error.fieldErrors?.studentId).toBeDefined();
    } finally {
      await inst.cleanup();
    }
  });

  it("pickup person of another student is validation_failed", async () => {
    const inst = await createTestInstitution("gp-act-cross-pickup");
    try {
      const { studentId } = await setupClassTeacherAndStudent(inst);

      // A second student + pickup person, not linked to our student.
      const [otherStudent] = await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        values (${inst.institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'Other', '2015-01-01', 'other')
        returning id
      `;
      const [otherPickup] = await sql`
        insert into public.pickup_persons (institution_id, student_id, full_name, relation, phone, created_by)
        values (${inst.institutionId}, ${otherStudent.id}, 'Someone', 'other', ${randomPhone()}, ${inst.users.admin.id})
        returning id
      `;

      const result = await callAs(inst, "teacher", createGatePass, {
        studentId,
        reason: "Dentist",
        pickupPersonId: otherPickup.id,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("validation_failed");
    } finally {
      await inst.cleanup();
    }
  });

  it("subject-only teacher -> create forbidden; setStatus on that pass -> not_found", async () => {
    const inst = await createTestInstitution("gp-act-scope");
    try {
      const { studentId, guardianId } = await setupClassTeacherAndStudent(inst);
      const subjectTeacher = await addStaffMember(inst, "teacher", "subject-only");

      const created = await callAs(inst, "teacher", createGatePass, { studentId, guardianId, reason: "Dentist" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      setActingClient(subjectTeacher.client as unknown as SupabaseClient<Database>);
      try {
        const ctx = await buildStaffContext(inst, subjectTeacher.userId, subjectTeacher.staffId, "teacher");

        const createDenied = await createGatePass(inst.slug, { studentId, guardianId, reason: "Dentist" }, ctx);
        expect(createDenied.ok).toBe(false);
        if (createDenied.ok) return;
        expect(createDenied.error.code).toBe("forbidden");

        const setStatusDenied = await setGatePassStatus(inst.slug, { id: created.data.id, status: "approved" }, ctx);
        expect(setStatusDenied.ok).toBe(false);
        if (setStatusDenied.ok) return;
        expect(setStatusDenied.error.code).toBe("not_found");
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("accountant has neither permission -> forbidden on create and setStatus", async () => {
    const inst = await createTestInstitution("gp-act-accountant");
    try {
      const { studentId, guardianId } = await setupClassTeacherAndStudent(inst);
      const created = await callAs(inst, "teacher", createGatePass, { studentId, guardianId, reason: "Dentist" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const createDenied = await callAs(inst, "accountant", createGatePass, { studentId, guardianId, reason: "Dentist" });
      expect(createDenied.ok).toBe(false);
      if (createDenied.ok) return;
      expect(createDenied.error.code).toBe("forbidden");

      const setStatusDenied = await callAs(inst, "accountant", setGatePassStatus, { id: created.data.id, status: "approved" });
      expect(setStatusDenied.ok).toBe(false);
      if (setStatusDenied.ok) return;
      expect(setStatusDenied.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });
});
