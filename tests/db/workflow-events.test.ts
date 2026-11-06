// M23-T14 — event emission wired into notify.attendance_absence,
// notify.results_published, notify.enquiry_received (rulings §Events).
// `public.emit_workflow_event` itself is exercised exhaustively by
// tests/db/workflows-lifecycle.test.ts (T3); this file only proves each
// handler calls it at the right point with the right institution/entity,
// that the handler's own notification behavior is unchanged, and that
// many jobs of one subject dedupe into one run (unique trigger key).
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  notifyAttendanceAbsence,
  notifyEnquiryReceived,
  notifyResultsPublished,
} from "@/modules/jobs/handlers/index";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

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

const NODES = [{ id: "t" }, { id: "e" }];
const EDGES = [{ source: "t", target: "e" }];

async function setModuleEnabled(institutionId: string, key: string, enabled: boolean): Promise<void> {
  await sql`
    update public.institutions
    set settings = jsonb_set(coalesce(settings, '{}'::jsonb), array['modules', ${key}], ${enabled}::text::jsonb)
    where id = ${institutionId}::uuid
  `;
}

async function insertEventWorkflow(
  inst: TestInstitution,
  event: string,
  status: "active" | "paused" = "active",
): Promise<{ id: string }> {
  const { data, error } = await admin
    .from("workflows")
    .insert({
      institution_id: inst.institutionId,
      name: `Workflow ${crypto.randomUUID().slice(0, 8)}`,
      created_by: inst.users.principal.id,
      nodes: NODES,
      edges: EDGES,
      status,
      trigger_type: "event",
      trigger_config: event,
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("workflow insert failed");
  return data as { id: string };
}

async function runsFor(workflowId: string) {
  return sql`select entity_id, trigger_kind from public.workflow_runs where workflow_id = ${workflowId}::uuid`;
}

function makeJob(type: string, institutionId: string, payload: Record<string, unknown>, key: string) {
  return {
    id: crypto.randomUUID(),
    institution_id: institutionId,
    type,
    payload,
    idempotency_key: key,
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

// Merges attendance/communication settings without wiping the
// `modules` key createTestInstitution already set (all modules on).
async function setAttendanceSettings(institutionId: string): Promise<void> {
  await sql`
    update public.institutions
    set settings = jsonb_set(
      jsonb_set(coalesce(settings, '{}'::jsonb), array['attendance'], '{"statuses": [
        {"code": "P", "label": "Present", "counts_present": 1, "in_denominator": true},
        {"code": "A", "label": "Absent", "counts_present": 0, "in_denominator": true, "notify_guardian": true}
      ]}'::jsonb),
      array['communication'], '{"languages": ["en", "hi"]}'::jsonb
    )
    where id = ${institutionId}::uuid
  `;
}

/** Session with two absent, guardian-notified students sharing one guardian (so no extra auth user is needed), plus one present-status record that must not emit. */
async function makeAttendanceFixture(inst: TestInstitution) {
  await setAttendanceSettings(inst.institutionId);

  const [year] = await sql`
    insert into public.academic_years (institution_id, name, starts_on, ends_on, is_current)
    values (${inst.institutionId}, 'AY', '2026-04-01', '2027-03-31', true) returning id
  `;
  const [grade] = await sql`
    insert into public.grades (institution_id, code, display_name, sort_key, grade_group)
    values (${inst.institutionId}, 'VI', 'Grade VI', 6, 'middle') returning id
  `;
  const [section] = await sql`
    insert into public.class_sections (institution_id, grade_id, academic_year_id, name)
    values (${inst.institutionId}, ${grade.id}, ${year.id}, 'A') returning id
  `;
  const [session] = await sql`
    insert into public.attendance_sessions (institution_id, class_section_id, date)
    values (${inst.institutionId}, ${section.id}, '2026-10-29') returning id
  `;

  const [student1] = await sql`
    select student_id as id from public.memberships
    where institution_id = ${inst.institutionId} and user_id = ${inst.users.student.id}
  `;
  const [student2] = await sql`
    insert into public.students (institution_id, admission_no, first_name, last_name, dob, gender)
    values (${inst.institutionId}, ${`WFE-${crypto.randomUUID().slice(0, 8)}`}, 'Second', 'Student', '2015-01-01', 'female')
    returning id
  `;
  const [student3] = await sql`
    insert into public.students (institution_id, admission_no, first_name, last_name, dob, gender)
    values (${inst.institutionId}, ${`WFE-${crypto.randomUUID().slice(0, 8)}`}, 'Third', 'Student', '2015-01-01', 'female')
    returning id
  `;

  const [guardianMembership] = await sql`
    select guardian_id from public.memberships
    where institution_id = ${inst.institutionId} and user_id = ${inst.users.guardian.id}
  `;
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
    values (${inst.institutionId}, ${guardianMembership.guardian_id}, ${student1.id}, 'father', true),
           (${inst.institutionId}, ${guardianMembership.guardian_id}, ${student2.id}, 'father', true)
  `;

  const [record1] = await sql`
    insert into public.attendance_records (institution_id, session_id, student_id, status)
    values (${inst.institutionId}, ${session.id}, ${student1.id}, 'A') returning id
  `;
  const [record2] = await sql`
    insert into public.attendance_records (institution_id, session_id, student_id, status)
    values (${inst.institutionId}, ${session.id}, ${student2.id}, 'A') returning id
  `;
  const [presentRecord] = await sql`
    insert into public.attendance_records (institution_id, session_id, student_id, status)
    values (${inst.institutionId}, ${session.id}, ${student3.id}, 'P') returning id
  `;

  return {
    sessionId: session.id as string,
    recordId1: record1.id as string,
    recordId2: record2.id as string,
    presentRecordId: presentRecord.id as string,
    guardianUserId: inst.users.guardian.id,
  };
}

async function makeExamFixture(inst: TestInstitution, resultCount: number) {
  const [year] = await sql`
    insert into public.academic_years (institution_id, name, starts_on, ends_on, is_current)
    values (${inst.institutionId}, 'AY', '2026-04-01', '2027-03-31', true) returning id
  `;
  const [term] = await sql`
    insert into public.terms (institution_id, academic_year_id, name, sequence, starts_on, ends_on)
    values (${inst.institutionId}, ${year.id}, 'Term 1', 1, '2026-04-01', '2026-09-30') returning id
  `;
  const [exam] = await sql`
    insert into public.exams (institution_id, academic_year_id, term_id, name, type, status)
    values (${inst.institutionId}, ${year.id}, ${term.id}, 'Unit Test (wfe)', 'unit_test', 'published') returning id
  `;

  const resultIds: string[] = [];
  for (let i = 0; i < resultCount; i++) {
    const [student] = await sql`
      insert into public.students (institution_id, admission_no, first_name, last_name, dob, gender)
      values (${inst.institutionId}, ${`WFE-EX-${crypto.randomUUID().slice(0, 8)}`}, 'Exam', 'Student', '2015-01-01', 'female')
      returning id
    `;
    const [result] = await sql`
      insert into public.results (institution_id, exam_id, student_id, snapshot, total, max_total, percentage, grade, version_no, published_at)
      values (${inst.institutionId}, ${exam.id}, ${student.id}, '{"subjects": [], "attendancePercentage": 0}'::jsonb, 80, 100, 80, 'A2', 1, now())
      returning id
    `;
    resultIds.push(result.id as string);
  }

  return { examId: exam.id as string, resultIds };
}

async function makeEnquiryFixture(inst: TestInstitution) {
  const [enquiry] = await sql`
    insert into public.enquiries (institution_id, child_name, guardian_name, phone, status)
    values (${inst.institutionId}, 'Enquiry Child', 'Enquiry Guardian', '9800000001', 'new')
    returning id
  `;
  return { enquiryId: enquiry.id as string };
}

describe("workflow event emission (M23-T14)", () => {
  it("attendance.absences_submitted: 2 notify-worthy jobs in one session dedupe to 1 run; guardians still notified", async () => {
    const inst = await createTestInstitution("wfe-attendance");
    createdInstitutions.push(inst);
    const workflow = await insertEventWorkflow(inst, "attendance.absences_submitted");
    const { sessionId, recordId1, recordId2, guardianUserId } = await makeAttendanceFixture(inst);

    await notifyAttendanceAbsence(
      makeJob("notify.attendance_absence", inst.institutionId, { record_id: recordId1 }, "k1"),
      { admin },
    );
    await notifyAttendanceAbsence(
      makeJob("notify.attendance_absence", inst.institutionId, { record_id: recordId2 }, "k2"),
      { admin },
    );

    const runs = await runsFor(workflow.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].entity_id).toBe(sessionId);
    expect(runs[0].trigger_kind).toBe("event");

    const notifications = await sql`
      select id from public.notifications
      where institution_id = ${inst.institutionId}::uuid and recipient_user_id = ${guardianUserId}::uuid
    `;
    expect(notifications).toHaveLength(2);
  });

  it("a non-notify-worthy absence status does not emit", async () => {
    const inst = await createTestInstitution("wfe-attendance-no-emit");
    createdInstitutions.push(inst);
    const workflow = await insertEventWorkflow(inst, "attendance.absences_submitted");
    const { presentRecordId } = await makeAttendanceFixture(inst);

    await notifyAttendanceAbsence(
      makeJob("notify.attendance_absence", inst.institutionId, { record_id: presentRecordId }, "k1"),
      { admin },
    );

    expect(await runsFor(workflow.id)).toHaveLength(0);
  });

  it("a paused workflow does not run", async () => {
    const inst = await createTestInstitution("wfe-paused");
    createdInstitutions.push(inst);
    const workflow = await insertEventWorkflow(inst, "attendance.absences_submitted", "paused");
    const { recordId1 } = await makeAttendanceFixture(inst);

    await notifyAttendanceAbsence(
      makeJob("notify.attendance_absence", inst.institutionId, { record_id: recordId1 }, "k1"),
      { admin },
    );

    expect(await runsFor(workflow.id)).toHaveLength(0);
  });

  it("workflows module off: no run, notification unchanged", async () => {
    const inst = await createTestInstitution("wfe-module-off");
    createdInstitutions.push(inst);
    const workflow = await insertEventWorkflow(inst, "attendance.absences_submitted");
    const { recordId1, guardianUserId } = await makeAttendanceFixture(inst);
    await setModuleEnabled(inst.institutionId, "workflows", false);

    await notifyAttendanceAbsence(
      makeJob("notify.attendance_absence", inst.institutionId, { record_id: recordId1 }, "k1"),
      { admin },
    );

    expect(await runsFor(workflow.id)).toHaveLength(0);
    const notifications = await sql`
      select id from public.notifications
      where institution_id = ${inst.institutionId}::uuid and recipient_user_id = ${guardianUserId}::uuid
    `;
    expect(notifications).toHaveLength(1);
  });

  it("results.published: 3 result jobs for one exam dedupe to 1 run", async () => {
    const inst = await createTestInstitution("wfe-results");
    createdInstitutions.push(inst);
    const workflow = await insertEventWorkflow(inst, "results.published");
    const { examId, resultIds } = await makeExamFixture(inst, 3);

    for (const [i, resultId] of resultIds.entries()) {
      await notifyResultsPublished(
        makeJob("notify.results_published", inst.institutionId, { result_id: resultId }, `k${i}`),
        { admin },
      );
    }

    const runs = await runsFor(workflow.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].entity_id).toBe(examId);
  });

  it("enquiry.received: 1 enquiry job -> 1 run", async () => {
    const inst = await createTestInstitution("wfe-enquiry");
    createdInstitutions.push(inst);
    const workflow = await insertEventWorkflow(inst, "enquiry.received");
    const { enquiryId } = await makeEnquiryFixture(inst);

    await notifyEnquiryReceived(
      makeJob("notify.enquiry_received", inst.institutionId, { enquiry_id: enquiryId }, "k1"),
      { admin },
    );

    const runs = await runsFor(workflow.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].entity_id).toBe(enquiryId);
  });
});
