// M23-T4 — migration 0096 part 3: public.workflow_metric (M23-tasks.md
// rulings: Metrics table). Each `it` sets up fixture rows for exactly one
// metric at a fixed `p_as_of`, tz Asia/Kolkata (the default for a test
// institution — settings has no `locale` key, so the function's own
// coalesce fallback applies).
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createAttendanceRecord,
  createAttendanceSession,
  createClassSection,
  createEnrolment,
  createEnquiry,
  createGrade,
  createSubject,
  createTerm,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

process.env.SERVICE_ROLE_CALLER = "test";
const { createAdminClient } = await import("@/lib/supabase/admin");
const admin = createAdminClient();

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

// Mirrors DEFAULT_INSTITUTION_SETTINGS so the notify-code jsonb path has data.
const ATTENDANCE_STATUSES = [
  { code: "P", label: "Present", counts_present: 1, in_denominator: true },
  { code: "A", label: "Absent", counts_present: 0, in_denominator: true, notify_guardian: true },
];

async function setAttendanceStatuses(institutionId: string): Promise<void> {
  await sql`
    update public.institutions
    set settings = settings || jsonb_build_object('attendance', jsonb_build_object('statuses', ${sql.json(ATTENDANCE_STATUSES)}::jsonb))
    where id = ${institutionId}
  `;
}

async function insertStudent(institutionId: string, admissionNo: string): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo}, 'Test Student', '2016-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

async function markSession(sessionId: string, status: string): Promise<void> {
  await sql`update public.attendance_sessions set status = ${status} where id = ${sessionId}::uuid`;
}

async function markSessionDate(sessionId: string, date: string, periodId: string | null = null): Promise<void> {
  await sql`update public.attendance_sessions set date = ${date}, period_id = ${periodId} where id = ${sessionId}::uuid`;
}

async function createPeriod(institutionId: string): Promise<string> {
  const [row] = await sql`
    insert into public.periods (institution_id, seq, name, starts_at, ends_at)
    values (${institutionId}, 9, 'Period 9', '09:00', '09:40')
    returning id
  `;
  return row.id as string;
}

async function insertAssignment(
  institutionId: string,
  classSectionId: string,
  subjectId: string,
  createdBy: string,
  overrides: Partial<{ dueAt: string; status: string }> = {},
): Promise<string> {
  const [row] = await sql`
    insert into public.assignments (institution_id, class_section_id, subject_id, title, due_at, status, created_by)
    values (
      ${institutionId}, ${classSectionId}, ${subjectId}, 'Metric fixture',
      ${overrides.dueAt ?? null}, ${overrides.status ?? "published"}, ${createdBy}
    )
    returning id
  `;
  return row.id as string;
}

async function insertSubmission(institutionId: string, assignmentId: string, studentId: string): Promise<void> {
  await sql`
    insert into public.assignment_submissions (institution_id, assignment_id, student_id)
    values (${institutionId}, ${assignmentId}, ${studentId})
  `;
}

async function insertExam(
  institutionId: string,
  academicYearId: string,
  termId: string,
  overrides: Partial<{ status: string }> = {},
): Promise<string> {
  const [row] = await sql`
    insert into public.exams (institution_id, academic_year_id, term_id, name, type, status)
    values (
      ${institutionId}, ${academicYearId}, ${termId}, ${`Exam-${crypto.randomUUID().slice(0, 8)}`},
      'unit_test', ${overrides.status ?? "draft"}
    )
    returning id
  `;
  return row.id as string;
}

async function insertExamPaper(
  institutionId: string,
  examId: string,
  classSectionId: string,
  subjectId: string,
  heldOn: string | null,
): Promise<string> {
  const [row] = await sql`
    insert into public.exam_papers (institution_id, exam_id, class_section_id, subject_id, max_marks, pass_marks, held_on)
    values (${institutionId}, ${examId}, ${classSectionId}, ${subjectId}, 100, 33, ${heldOn})
    returning id
  `;
  return row.id as string;
}

async function insertInvoice(
  institutionId: string,
  studentId: string,
  academicYearId: string,
  termId: string,
  overrides: Partial<{ status: string; total: number; paidTotal: number; dueOn: string }> = {},
): Promise<string> {
  const [row] = await sql`
    insert into public.invoices (institution_id, student_id, academic_year_id, term_id, invoice_no, status, total, paid_total, due_on)
    values (
      ${institutionId}, ${studentId}, ${academicYearId}, ${termId}, ${`INV-${crypto.randomUUID().slice(0, 8)}`},
      ${overrides.status ?? "issued"}, ${overrides.total ?? 1000}, ${overrides.paidTotal ?? 0}, ${overrides.dueOn ?? null}
    )
    returning id
  `;
  return row.id as string;
}

async function teacherStaffId(institutionId: string): Promise<string> {
  const [row] = await sql`select staff_id from public.memberships where institution_id = ${institutionId} and role = 'teacher'`;
  return row.staff_id as string;
}

async function setEnquiryCreatedAt(enquiryId: string, createdAt: string): Promise<void> {
  await sql`update public.enquiries set created_at = ${createdAt}::timestamptz where id = ${enquiryId}::uuid`;
}

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

const createdInstitutions: TestInstitution[] = [];
afterEach(async () => {
  await Promise.all(createdInstitutions.splice(0).map((inst) => inst.cleanup()));
});

const AS_OF = new Date("2026-07-15T06:00:00Z"); // 2026-07-15 11:30 IST

describe("public.workflow_metric (0096 part 3)", () => {
  it("attendance.session_absences counts only notify-code records of that session", async () => {
    const inst = await createTestInstitution("metric-absences");
    createdInstitutions.push(inst);
    await setAttendanceStatuses(inst.institutionId);

    const yearId = await createAcademicYear(inst.institutionId);
    const gradeId = await createGrade(inst.institutionId);
    const sectionId = await createClassSection(inst.institutionId, gradeId, yearId);
    const sessionId = await createAttendanceSession(inst.institutionId, sectionId);

    const [s1, s2, s3] = await Promise.all([
      insertStudent(inst.institutionId, "ADM-ABS-1"),
      insertStudent(inst.institutionId, "ADM-ABS-2"),
      insertStudent(inst.institutionId, "ADM-ABS-3"),
    ]);
    await createAttendanceRecord(inst.institutionId, sessionId, s1, { status: "A" });
    await createAttendanceRecord(inst.institutionId, sessionId, s2, { status: "A" });
    await createAttendanceRecord(inst.institutionId, sessionId, s3, { status: "P" });

    const { data, error } = await admin.rpc("workflow_metric", {
      p_institution_id: inst.institutionId,
      p_metric: "attendance.session_absences",
      p_entity_id: sessionId,
      p_as_of: AS_OF.toISOString(),
    });
    expect(error).toBeNull();
    expect(data).toBe(2);
  });

  it("attendance.session_absences: a session id of another institution counts 0", async () => {
    const a = await createTestInstitution("metric-absences-a");
    const b = await createTestInstitution("metric-absences-b");
    createdInstitutions.push(a, b);
    await setAttendanceStatuses(b.institutionId);

    const yearId = await createAcademicYear(b.institutionId);
    const gradeId = await createGrade(b.institutionId);
    const sectionId = await createClassSection(b.institutionId, gradeId, yearId);
    const sessionId = await createAttendanceSession(b.institutionId, sectionId);
    const studentId = await insertStudent(b.institutionId, "ADM-ABS-B1");
    await createAttendanceRecord(b.institutionId, sessionId, studentId, { status: "A" });

    const { data } = await admin.rpc("workflow_metric", {
      p_institution_id: a.institutionId,
      p_metric: "attendance.session_absences",
      p_entity_id: sessionId,
      p_as_of: AS_OF.toISOString(),
    });
    expect(data).toBe(0);
  });

  it("attendance.repeat_absentees: a student absent on all of the last 3 submitted daily sessions -> 1; a period session is ignored", async () => {
    const inst = await createTestInstitution("metric-repeat");
    createdInstitutions.push(inst);
    await setAttendanceStatuses(inst.institutionId);

    const yearId = await createAcademicYear(inst.institutionId);
    const gradeId = await createGrade(inst.institutionId);
    const sectionId = await createClassSection(inst.institutionId, gradeId, yearId);

    const [studentAllThree, studentTwo] = await Promise.all([
      insertStudent(inst.institutionId, "ADM-REP-1"),
      insertStudent(inst.institutionId, "ADM-REP-2"),
    ]);

    const dates = ["2026-07-10", "2026-07-11", "2026-07-13"]; // currentSession's 3 preceding daily sessions
    const sessionIds: string[] = [];
    for (const date of dates) {
      const id = await createAttendanceSession(inst.institutionId, sectionId, { date });
      await markSession(id, "submitted");
      sessionIds.push(id);
    }

    for (const [i, id] of sessionIds.entries()) {
      await createAttendanceRecord(inst.institutionId, id, studentAllThree, { status: "A" });
      // studentTwo is absent on only the first two of the three.
      await createAttendanceRecord(inst.institutionId, id, studentTwo, { status: i < 2 ? "A" : "P" });
    }

    // A period session dated after the three dailies, but its period_id is
    // set, so it must never enter the "last 3" window.
    const periodId = await createPeriod(inst.institutionId);
    const periodSessionId = await createAttendanceSession(inst.institutionId, sectionId, { date: "2026-07-14" });
    await markSessionDate(periodSessionId, "2026-07-14", periodId);
    await markSession(periodSessionId, "submitted");

    const currentSessionId = await createAttendanceSession(inst.institutionId, sectionId, { date: "2026-07-15" });

    const { data, error } = await admin.rpc("workflow_metric", {
      p_institution_id: inst.institutionId,
      p_metric: "attendance.repeat_absentees",
      p_entity_id: currentSessionId,
      p_as_of: AS_OF.toISOString(),
    });
    expect(error).toBeNull();
    expect(data).toBe(1);
  });

  it("attendance.repeat_absentees: fewer than 3 submitted sessions -> 0", async () => {
    const inst = await createTestInstitution("metric-repeat-few");
    createdInstitutions.push(inst);
    await setAttendanceStatuses(inst.institutionId);

    const yearId = await createAcademicYear(inst.institutionId);
    const gradeId = await createGrade(inst.institutionId);
    const sectionId = await createClassSection(inst.institutionId, gradeId, yearId);
    const studentId = await insertStudent(inst.institutionId, "ADM-REP-FEW");

    for (const date of ["2026-07-13", "2026-07-14"]) {
      const id = await createAttendanceSession(inst.institutionId, sectionId, { date });
      await markSession(id, "submitted");
      await createAttendanceRecord(inst.institutionId, id, studentId, { status: "A" });
    }

    const currentSessionId = await createAttendanceSession(inst.institutionId, sectionId, { date: "2026-07-15" });

    const { data } = await admin.rpc("workflow_metric", {
      p_institution_id: inst.institutionId,
      p_metric: "attendance.repeat_absentees",
      p_entity_id: currentSessionId,
      p_as_of: AS_OF.toISOString(),
    });
    expect(data).toBe(0);
  });

  it("assignments.missing_due_tomorrow counts active-enrolled students with no submission; a withdrawn enrolment is not counted", async () => {
    const inst = await createTestInstitution("metric-assignments");
    createdInstitutions.push(inst);

    const yearId = await createAcademicYear(inst.institutionId);
    const gradeId = await createGrade(inst.institutionId);
    const sectionId = await createClassSection(inst.institutionId, gradeId, yearId);
    const subjectId = await createSubject(inst.institutionId);

    const createdBy = await teacherStaffId(inst.institutionId);
    const assignmentId = await insertAssignment(inst.institutionId, sectionId, subjectId, createdBy, {
      dueAt: "2026-07-16T10:00:00Z", // 2026-07-16 15:30 IST -> local date d+1
      status: "published",
    });

    const [submitted, missing1, missing2, withdrawn] = await Promise.all([
      insertStudent(inst.institutionId, "ADM-ASG-1"),
      insertStudent(inst.institutionId, "ADM-ASG-2"),
      insertStudent(inst.institutionId, "ADM-ASG-3"),
      insertStudent(inst.institutionId, "ADM-ASG-4"),
    ]);
    await createEnrolment(inst.institutionId, submitted, sectionId, yearId);
    await createEnrolment(inst.institutionId, missing1, sectionId, yearId);
    await createEnrolment(inst.institutionId, missing2, sectionId, yearId);
    await createEnrolment(inst.institutionId, withdrawn, sectionId, yearId, { status: "withdrawn" });

    await insertSubmission(inst.institutionId, assignmentId, submitted);

    const { data, error } = await admin.rpc("workflow_metric", {
      p_institution_id: inst.institutionId,
      p_metric: "assignments.missing_due_tomorrow",
      p_entity_id: null as unknown as string,
      p_as_of: AS_OF.toISOString(),
    });
    expect(error).toBeNull();
    expect(data).toBe(2);
  });

  it("exams.papers_next_7_days counts only unpublished exams within the window", async () => {
    const inst = await createTestInstitution("metric-exams");
    createdInstitutions.push(inst);

    const yearId = await createAcademicYear(inst.institutionId);
    const termId = await createTerm(inst.institutionId, yearId);
    const gradeId = await createGrade(inst.institutionId);
    const sectionId = await createClassSection(inst.institutionId, gradeId, yearId);
    const subjectInWindow = await createSubject(inst.institutionId, { code: "SUB-WIN" });
    const subjectOutOfWindow = await createSubject(inst.institutionId, { code: "SUB-OUT" });
    const subjectPublished = await createSubject(inst.institutionId, { code: "SUB-PUB" });

    const draftExam = await insertExam(inst.institutionId, yearId, termId, { status: "draft" });
    const publishedExam = await insertExam(inst.institutionId, yearId, termId, { status: "published" });

    await insertExamPaper(inst.institutionId, draftExam, sectionId, subjectInWindow, "2026-07-18"); // d + 3 -> in window
    await insertExamPaper(inst.institutionId, draftExam, sectionId, subjectOutOfWindow, "2026-07-24"); // d + 9 -> out of window
    await insertExamPaper(inst.institutionId, publishedExam, sectionId, subjectPublished, "2026-07-18"); // published -> excluded

    const { data, error } = await admin.rpc("workflow_metric", {
      p_institution_id: inst.institutionId,
      p_metric: "exams.papers_next_7_days",
      p_entity_id: null as unknown as string,
      p_as_of: AS_OF.toISOString(),
    });
    expect(error).toBeNull();
    expect(data).toBe(1);
  });

  it("finance.overdue_invoices counts issued/part_paid invoices with outstanding balance past due", async () => {
    const inst = await createTestInstitution("metric-finance");
    createdInstitutions.push(inst);

    const yearId = await createAcademicYear(inst.institutionId);
    const termId = await createTerm(inst.institutionId, yearId);
    const [overdueStudent, paidStudent, dueTodayStudent] = await Promise.all([
      insertStudent(inst.institutionId, "ADM-FIN-1"),
      insertStudent(inst.institutionId, "ADM-FIN-2"),
      insertStudent(inst.institutionId, "ADM-FIN-3"),
    ]);

    await insertInvoice(inst.institutionId, overdueStudent, yearId, termId, {
      status: "issued",
      total: 1000,
      paidTotal: 0,
      dueOn: "2026-07-10", // before d
    });
    await insertInvoice(inst.institutionId, paidStudent, yearId, termId, {
      status: "paid",
      total: 1000,
      paidTotal: 1000,
      dueOn: "2026-07-10",
    });
    await insertInvoice(inst.institutionId, dueTodayStudent, yearId, termId, {
      status: "issued",
      total: 1000,
      paidTotal: 0,
      dueOn: "2026-07-15", // == d, not overdue yet
    });

    const { data, error } = await admin.rpc("workflow_metric", {
      p_institution_id: inst.institutionId,
      p_metric: "finance.overdue_invoices",
      p_entity_id: null as unknown as string,
      p_as_of: AS_OF.toISOString(),
    });
    expect(error).toBeNull();
    expect(data).toBe(1);
  });

  it("admissions.stale_enquiries counts only 'new' enquiries older than 48 hours", async () => {
    const inst = await createTestInstitution("metric-admissions");
    createdInstitutions.push(inst);

    const stale = await createEnquiry(inst.institutionId, { status: "new" });
    await setEnquiryCreatedAt(stale, "2026-07-12T06:00:00Z"); // > 48h before AS_OF

    const fresh = await createEnquiry(inst.institutionId, { status: "new" });
    await setEnquiryCreatedAt(fresh, "2026-07-14T06:00:00Z"); // < 48h before AS_OF

    const contacted = await createEnquiry(inst.institutionId, { status: "contacted" });
    await setEnquiryCreatedAt(contacted, "2026-07-01T06:00:00Z");

    const { data, error } = await admin.rpc("workflow_metric", {
      p_institution_id: inst.institutionId,
      p_metric: "admissions.stale_enquiries",
      p_entity_id: null as unknown as string,
      p_as_of: AS_OF.toISOString(),
    });
    expect(error).toBeNull();
    expect(data).toBe(1);
  });

  it("unknown metric is validation_failed", async () => {
    const inst = await createTestInstitution("metric-unknown");
    createdInstitutions.push(inst);

    const { error } = await admin.rpc("workflow_metric", {
      p_institution_id: inst.institutionId,
      p_metric: "not.a.real.metric",
      p_entity_id: null as unknown as string,
      p_as_of: AS_OF.toISOString(),
    });
    expect(error?.message).toContain("code:validation_failed");
  });

  it("a subject metric with a null entity is validation_failed", async () => {
    const inst = await createTestInstitution("metric-null-entity");
    createdInstitutions.push(inst);

    const { error } = await admin.rpc("workflow_metric", {
      p_institution_id: inst.institutionId,
      p_metric: "attendance.session_absences",
      p_entity_id: null as unknown as string,
      p_as_of: AS_OF.toISOString(),
    });
    expect(error?.message).toContain("code:validation_failed");
  });

  it("an authenticated caller is permission denied", async () => {
    const inst = await createTestInstitution("metric-perm");
    createdInstitutions.push(inst);

    const { error } = await inst.clientAs("principal").rpc("workflow_metric", {
      p_institution_id: inst.institutionId,
      p_metric: "admissions.stale_enquiries",
      p_entity_id: null as unknown as string,
      p_as_of: AS_OF.toISOString(),
    });
    expect(error?.code).toBe("42501");
  });
});
