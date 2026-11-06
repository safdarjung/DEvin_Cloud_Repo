import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { notifyGatePass } from "@/modules/jobs/handlers/index";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

// X07-T7 — real DB test against the service-role client, same shape as
// tests/db/notify-announcement.test.ts: recipients resolved from current
// guardian_students/memberships rows (never the payload), and the pass's
// own current state re-checked at send time (lesson 11).
process.env.SERVICE_ROLE_CALLER = "test";
const { createAdminClient } = await import("@/lib/supabase/admin");
const admin = createAdminClient();

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

const createdInstitutions: TestInstitution[] = [];
afterEach(async () => {
  await Promise.all(createdInstitutions.splice(0).map((inst) => inst.cleanup()));
});

function makeJob(institutionId: string, gatePassId: string | undefined, idempotencyKey = "k") {
  return {
    id: "job-1",
    institution_id: institutionId,
    type: "notify.gate_pass" as const,
    payload: gatePassId === undefined ? {} : { gate_pass_id: gatePassId },
    idempotency_key: idempotencyKey,
    status: "running" as const,
    attempts: 1,
    max_attempts: 5,
    run_after: new Date().toISOString(),
    locked_at: null,
    locked_by: null,
    last_error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/** Current academic year + grade VI-A, with the fixture's own student enrolled (no guardian link yet). */
async function makeEnrolledStudent(inst: TestInstitution): Promise<string> {
  const [year] = await sql`
    insert into public.academic_years (institution_id, name, starts_on, ends_on, is_current)
    values (${inst.institutionId}, 'AY', '2026-04-01', '2027-03-31', true)
    returning id
  `;
  const [grade] = await sql`
    insert into public.grades (institution_id, code, display_name, sort_key, grade_group)
    values (${inst.institutionId}, 'VI', 'Grade VI', 6, 'middle')
    returning id
  `;
  const [section] = await sql`
    insert into public.class_sections (institution_id, grade_id, academic_year_id, name)
    values (${inst.institutionId}, ${grade.id}, ${year.id}, 'A')
    returning id
  `;
  const [studentMembership] = await sql`
    select student_id from public.memberships where institution_id = ${inst.institutionId} and user_id = ${inst.users.student.id}
  `;
  const studentId = studentMembership.student_id as string;
  await sql`
    insert into public.enrolments (institution_id, student_id, class_section_id, academic_year_id, started_on, status)
    values (${inst.institutionId}, ${studentId}, ${section.id}, ${year.id}, '2026-04-01', 'active')
  `;
  return studentId;
}

/** Links the fixture's own guardian to `studentId` as primary, with an active portal membership. */
async function linkPrimaryGuardian(inst: TestInstitution, studentId: string): Promise<string> {
  const [guardianMembership] = await sql`
    select guardian_id from public.memberships where institution_id = ${inst.institutionId} and user_id = ${inst.users.guardian.id}
  `;
  const guardianId = guardianMembership.guardian_id as string;
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${inst.institutionId}, ${guardianId}, ${studentId}, 'father', true, true)
  `;
  return guardianId;
}

async function makeStudentFixture(inst: TestInstitution) {
  const studentId = await makeEnrolledStudent(inst);
  const guardianId = await linkPrimaryGuardian(inst, studentId);
  return { studentId, guardianId };
}

/** Inserts a gate_passes row directly as the trusted (postgres) role, bypassing the pending/requested_* forcing on INSERT — the before-insert collector snapshot still runs (rulings). */
async function insertGatePass(
  inst: TestInstitution,
  params: { studentId: string; guardianId: string; status: string; decidedAt: string | null },
) {
  const [pass] = await sql`
    insert into public.gate_passes (institution_id, student_id, reason, guardian_id, status, requested_by, requested_at, decided_by, decided_at)
    values (
      ${inst.institutionId}, ${params.studentId}, 'Dentist appointment', ${params.guardianId}, ${params.status},
      ${inst.users.admin.id}, now(), ${params.decidedAt ? inst.users.admin.id : null}, ${params.decidedAt}
    )
    returning id, collector_name
  `;
  return pass as { id: string; collector_name: string };
}

describe("notify.gate_pass handler (X07-T7)", () => {
  it("approved pass notifies the primary guardian in-app and attempts a simulated sms with collector and HH:MM", async () => {
    const inst = await createTestInstitution("notif-gatepass-approved");
    createdInstitutions.push(inst);
    const { studentId, guardianId } = await makeStudentFixture(inst);
    const decidedAt = "2026-10-29T08:30:00.000Z"; // 14:00 IST
    const pass = await insertGatePass(inst, { studentId, guardianId, status: "approved", decidedAt });

    await notifyGatePass(makeJob(inst.institutionId, pass.id), { admin });

    const [notification] = await sql`
      select id, recipient_user_id, type from public.notifications
      where institution_id = ${inst.institutionId}::uuid and type = 'gate_pass_approved'
    `;
    expect(notification.recipient_user_id).toBe(inst.users.guardian.id);

    const attempts = await sql`select channel, status, rendered_body from public.delivery_attempts where notification_id = ${notification.id}::uuid`;
    const bodies = attempts.map((a) => a.rendered_body as string);
    expect(attempts.map((a) => a.channel)).toEqual(expect.arrayContaining(["in_app", "sms"]));
    const smsAttempt = attempts.find((a) => a.channel === "sms");
    expect(smsAttempt?.status).toBe("simulated");
    expect(bodies.some((b) => b.includes(pass.collector_name) && b.includes("14:00"))).toBe(true);
  });

  it("a pass cancelled before the job runs is not notified", async () => {
    const inst = await createTestInstitution("notif-gatepass-cancelled");
    createdInstitutions.push(inst);
    const { studentId, guardianId } = await makeStudentFixture(inst);
    const pass = await insertGatePass(inst, { studentId, guardianId, status: "cancelled", decidedAt: new Date().toISOString() });

    await expect(notifyGatePass(makeJob(inst.institutionId, pass.id), { admin })).resolves.toBeUndefined();

    const notified = await sql`select id from public.notifications where institution_id = ${inst.institutionId}::uuid`;
    expect(notified).toHaveLength(0);
  });

  it("no primary guardian membership means no notification, job still succeeds", async () => {
    const inst = await createTestInstitution("notif-gatepass-no-membership");
    createdInstitutions.push(inst);
    const studentId = await makeEnrolledStudent(inst);

    // A guardian with no portal membership, linked as primary for this student.
    const [unlinkedGuardian] = await sql`
      insert into public.guardians (institution_id, full_name, phone)
      values (${inst.institutionId}, 'Unlinked Guardian', '9811111111')
      returning id
    `;
    await sql`
      insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
      values (${inst.institutionId}, ${unlinkedGuardian.id}, ${studentId}, 'mother', true, true)
    `;
    const pass = await insertGatePass(inst, {
      studentId,
      guardianId: unlinkedGuardian.id as string,
      status: "approved",
      decidedAt: new Date().toISOString(),
    });

    await expect(notifyGatePass(makeJob(inst.institutionId, pass.id), { admin })).resolves.toBeUndefined();

    const notified = await sql`select id from public.notifications where institution_id = ${inst.institutionId}::uuid`;
    expect(notified).toHaveLength(0);
  });

  it("missing payload gate_pass_id throws", async () => {
    const inst = await createTestInstitution("notif-gatepass-missing-id");
    createdInstitutions.push(inst);

    await expect(notifyGatePass(makeJob(inst.institutionId, undefined), { admin })).rejects.toThrow();
  });
});
