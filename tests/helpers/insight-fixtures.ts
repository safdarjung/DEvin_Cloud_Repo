// M19-T4/T5/T6 — plant fixtures for insight_src_attendance/marks/submissions
// (migration 0092 part 3), insight_src_fees/admissions (part 4), and
// insight_src_workload/room_capacity/rooms (part 5).
// Admin-level direct DB connection (bypasses RLS, same convention as
// tests/helpers/factories.ts); explicit timestamps are set where a row's
// "as of" date must be backdated, since the `set_updated_at` trigger only
// fires on UPDATE, not on INSERT.
import postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

/** Shifts a date string back by `daysAgo` days, UTC-safe. */
function shiftDate(asOf: string, daysAgo: number): string {
  const d = new Date(`${asOf}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

/** 06:00 UTC = 11:30 IST — safely the same local calendar date in
 * Asia/Kolkata (the test institutions' default timezone), away from any
 * midnight boundary. */
function shiftTimestamp(asOf: string, daysAgo: number): string {
  return `${shiftDate(asOf, daysAgo)}T06:00:00Z`;
}

export interface AcademicSetup {
  academicYearId: string;
  termId: string;
  gradeId: string;
  classSectionId: string;
  subjectId: string;
  sectionLabel: string;
}

/** One grade/section/subject/year/term, reused across a test's fixtures. */
export async function plantAcademicSetup(admin: Sql, institutionId: string): Promise<AcademicSetup> {
  const [year] = await admin`
    insert into public.academic_years (institution_id, name, starts_on, ends_on, is_current)
    values (${institutionId}, '2026-27', '2026-04-01', '2027-03-31', true)
    returning id
  `;
  const [term] = await admin`
    insert into public.terms (institution_id, academic_year_id, name, sequence, starts_on, ends_on)
    values (${institutionId}, ${year.id}, 'Term 1', 1, '2026-04-01', '2026-09-30')
    returning id
  `;
  const [grade] = await admin`
    insert into public.grades (institution_id, code, display_name, sort_key, grade_group)
    values (${institutionId}, 'VI', 'Grade VI', 6, 'middle')
    returning id
  `;
  const [section] = await admin`
    insert into public.class_sections (institution_id, grade_id, academic_year_id, name)
    values (${institutionId}, ${grade.id}, ${year.id}, 'A')
    returning id
  `;
  const [subject] = await admin`
    insert into public.subjects (institution_id, code, name, kind)
    values (${institutionId}, ${`SUB-${crypto.randomUUID().slice(0, 8)}`}, 'Mathematics', 'scholastic')
    returning id
  `;
  return {
    academicYearId: year.id as string,
    termId: term.id as string,
    gradeId: grade.id as string,
    classSectionId: section.id as string,
    subjectId: subject.id as string,
    sectionLabel: "VI-A",
  };
}

export async function plantStudent(
  admin: Sql,
  institutionId: string,
  classSectionId: string,
  academicYearId: string,
): Promise<string> {
  const [student] = await admin`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'Test', '2015-01-01', 'other')
    returning id
  `;
  await admin`
    insert into public.enrolments (institution_id, student_id, class_section_id, academic_year_id, status, started_on)
    values (${institutionId}, ${student.id}, ${classSectionId}, ${academicYearId}, 'active', '2026-04-01')
  `;
  return student.id as string;
}

export interface SessionSpec {
  /** Days before `asOf` this session's date falls on. */
  daysAgo: number;
  /** Non-null makes it a period session (excluded by the source). */
  periodId?: string | null;
  /** studentId -> attendance status code. */
  records: Record<string, string>;
}

/** Plants one attendance_sessions row (+ its records) per spec entry. */
export async function plantAttendance(
  admin: Sql,
  institutionId: string,
  classSectionId: string,
  asOf: string,
  sessions: SessionSpec[],
): Promise<{ sessionIds: string[]; recordIds: string[] }> {
  const sessionIds: string[] = [];
  const recordIds: string[] = [];
  for (const session of sessions) {
    const date = shiftDate(asOf, session.daysAgo);
    const [row] = await admin`
      insert into public.attendance_sessions (institution_id, class_section_id, date, period_id, status)
      values (${institutionId}, ${classSectionId}, ${date}, ${session.periodId ?? null}, 'open')
      returning id
    `;
    sessionIds.push(row.id as string);
    for (const [studentId, status] of Object.entries(session.records)) {
      const [record] = await admin`
        insert into public.attendance_records (institution_id, session_id, student_id, status)
        values (${institutionId}, ${row.id}, ${studentId}, ${status})
        returning id
      `;
      recordIds.push(record.id as string);
    }
  }
  return { sessionIds, recordIds };
}

export interface ExamSpec {
  /** Days before `asOf` this exam's published_at falls on (ignored for drafts). */
  daysAgo: number;
  status?: "draft" | "published";
  maxMarks?: number;
  marks: Array<{ studentId: string; marksObtained: number | null; isAbsent?: boolean }>;
}

/** Plants one exam + one exam_paper (classSectionId/subjectId from the
 * academic setup) + its marks rows, per spec entry. */
export async function plantMarks(
  admin: Sql,
  institutionId: string,
  setup: AcademicSetup,
  asOf: string,
  exams: ExamSpec[],
): Promise<{ examIds: string[]; paperIds: string[]; markIds: string[] }> {
  const examIds: string[] = [];
  const paperIds: string[] = [];
  const markIds: string[] = [];
  for (const exam of exams) {
    const status = exam.status ?? "published";
    const publishedAt = status === "published" ? shiftTimestamp(asOf, exam.daysAgo) : null;
    const [examRow] = await admin`
      insert into public.exams (institution_id, academic_year_id, term_id, name, type, status, published_at)
      values (
        ${institutionId}, ${setup.academicYearId}, ${setup.termId},
        ${`Exam-${crypto.randomUUID().slice(0, 8)}`}, 'unit_test', ${status}, ${publishedAt}
      )
      returning id
    `;
    examIds.push(examRow.id as string);

    const maxMarks = exam.maxMarks ?? 100;
    const [paperRow] = await admin`
      insert into public.exam_papers (institution_id, exam_id, class_section_id, subject_id, max_marks, pass_marks)
      values (${institutionId}, ${examRow.id}, ${setup.classSectionId}, ${setup.subjectId}, ${maxMarks}, ${maxMarks * 0.33})
      returning id
    `;
    paperIds.push(paperRow.id as string);

    for (const mark of exam.marks) {
      const [markRow] = await admin`
        insert into public.marks (institution_id, exam_paper_id, student_id, marks_obtained, is_absent)
        values (${institutionId}, ${paperRow.id}, ${mark.studentId}, ${mark.marksObtained}, ${mark.isAbsent ?? false})
        returning id
      `;
      markIds.push(markRow.id as string);
    }
  }
  return { examIds, paperIds, markIds };
}

export interface SubmissionSpec {
  studentId: string;
  /** Days before `asOf`; defaults to the assignment's own `daysAgo`. */
  submittedDaysAgo?: number;
  status?: "submitted" | "graded";
}

export interface AssignmentSpec {
  /** Days before `asOf` this assignment's due_at falls on. */
  daysAgo: number;
  status?: "draft" | "published" | "closed";
  submissions?: SubmissionSpec[];
}

/** Plants one assignment (classSectionId/subjectId from the academic
 * setup) + its submissions, per spec entry. `teacherStaffId` fills
 * `created_by`; `teacherUserId` (a profiles id) fills graded submissions'
 * `graded_by`. */
export async function plantSubmissions(
  admin: Sql,
  institutionId: string,
  setup: AcademicSetup,
  teacherStaffId: string,
  teacherUserId: string,
  asOf: string,
  assignments: AssignmentSpec[],
): Promise<{ assignmentIds: string[]; submissionIds: string[] }> {
  const assignmentIds: string[] = [];
  const submissionIds: string[] = [];
  for (const assignment of assignments) {
    const status = assignment.status ?? "published";
    const dueAt = shiftTimestamp(asOf, assignment.daysAgo);
    const [row] = await admin`
      insert into public.assignments (institution_id, class_section_id, subject_id, title, due_at, status, created_by)
      values (
        ${institutionId}, ${setup.classSectionId}, ${setup.subjectId},
        'Insight fixture assignment', ${dueAt}, ${status}, ${teacherStaffId}
      )
      returning id
    `;
    assignmentIds.push(row.id as string);

    for (const submission of assignment.submissions ?? []) {
      const submittedAt = shiftTimestamp(asOf, submission.submittedDaysAgo ?? assignment.daysAgo);
      const subStatus = submission.status ?? "submitted";
      const graded = subStatus === "graded";
      const [subRow] = await admin`
        insert into public.assignment_submissions (
          institution_id, assignment_id, student_id, submitted_at, status, score, max_score, graded_by, graded_at
        )
        values (
          ${institutionId}, ${row.id}, ${submission.studentId}, ${submittedAt}, ${subStatus},
          ${graded ? 80 : null}, ${graded ? 100 : null}, ${graded ? teacherUserId : null}, ${graded ? submittedAt : null}
        )
        returning id
      `;
      submissionIds.push(subRow.id as string);
    }
  }
  return { assignmentIds, submissionIds };
}

export interface InvoicePaymentSpec {
  amount: number;
  /** Days before `asOf` the payment's `received_at` falls on. */
  receivedDaysAgo: number;
  /** Set to reverse this payment; its `created_at` is `asOf - reversalDaysAgo`. */
  reversalDaysAgo?: number;
  reversalAmount?: number;
}

export interface InvoiceSpec {
  /** `invoices_one_active_per_student_term_idx` allows only one active
   * invoice per (student, term): each invoice needs its own student. */
  studentId: string;
  total: number;
  /** `due_on = asOf - dueDaysAgo` (positive => overdue by that many days). */
  dueDaysAgo: number;
  /** Local `created_at` date; defaults to 60 days before `due_on`. */
  createdDaysAgo?: number;
  status?: "issued" | "part_paid" | "paid" | "cancelled";
  payments?: InvoicePaymentSpec[];
}

export interface ConcessionSpec {
  /** Days before `asOf` the concession's `created_at` falls on. */
  daysAgo: number;
  kind: "sibling" | "staff_ward" | "merit" | "ews_rte" | "hardship" | "other";
  amount?: number;
}

export interface FeesPlantResult {
  invoiceIds: string[];
  paymentIds: string[];
  reversalIds: string[];
  concessionIds: string[];
}

/** Plants invoices (+ payments + reversals, each invoice its own student —
 * see InvoiceSpec), and concessions against one fee assignment, per
 * `insight_src_fees` (rulings "fees"). */
export async function plantFees(
  admin: Sql,
  institutionId: string,
  academicYearId: string,
  termId: string,
  asOf: string,
  spec: {
    invoices?: InvoiceSpec[];
    concessions?: { feeAssignmentId: string; approvedBy: string; items: ConcessionSpec[] };
  },
): Promise<FeesPlantResult> {
  const invoiceIds: string[] = [];
  const paymentIds: string[] = [];
  const reversalIds: string[] = [];
  const concessionIds: string[] = [];

  for (const invoice of spec.invoices ?? []) {
    const dueOn = shiftDate(asOf, invoice.dueDaysAgo);
    const createdAt = shiftTimestamp(asOf, invoice.createdDaysAgo ?? invoice.dueDaysAgo + 60);
    const [row] = await admin`
      insert into public.invoices (
        institution_id, student_id, academic_year_id, term_id, invoice_no, status, total, due_on, created_at, updated_at
      )
      values (
        ${institutionId}, ${invoice.studentId}, ${academicYearId}, ${termId},
        ${`INV-${crypto.randomUUID().slice(0, 8)}`}, ${invoice.status ?? "issued"}, ${invoice.total}, ${dueOn}, ${createdAt}, ${createdAt}
      )
      returning id
    `;
    invoiceIds.push(row.id as string);

    for (const payment of invoice.payments ?? []) {
      const receivedAt = shiftTimestamp(asOf, payment.receivedDaysAgo);
      const [paymentRow] = await admin`
        insert into public.payments (
          institution_id, invoice_id, amount, mode, received_at, idempotency_key, created_at
        )
        values (
          ${institutionId}, ${row.id}, ${payment.amount}, 'cash', ${receivedAt},
          ${crypto.randomUUID()}, ${receivedAt}
        )
        returning id
      `;
      paymentIds.push(paymentRow.id as string);

      if (payment.reversalDaysAgo !== undefined) {
        const reversedAt = shiftTimestamp(asOf, payment.reversalDaysAgo);
        const [reversalRow] = await admin`
          insert into public.payment_reversals (
            institution_id, payment_id, invoice_id, kind, amount, reason, snapshot, idempotency_key, created_at, updated_at
          )
          values (
            ${institutionId}, ${paymentRow.id}, ${row.id}, 'void',
            ${payment.reversalAmount ?? payment.amount}, 'insight fixture reversal', '{}'::jsonb,
            ${crypto.randomUUID()}, ${reversedAt}, ${reversedAt}
          )
          returning id
        `;
        reversalIds.push(reversalRow.id as string);
      }
    }
  }

  if (spec.concessions) {
    const { feeAssignmentId, approvedBy, items } = spec.concessions;
    for (const concession of items) {
      const createdAt = shiftTimestamp(asOf, concession.daysAgo);
      const [row] = await admin`
        insert into public.concessions (
          institution_id, fee_assignment_id, kind, amount, approved_by, reason, created_at, updated_at
        )
        values (
          ${institutionId}, ${feeAssignmentId}, ${concession.kind}, ${concession.amount ?? 1000},
          ${approvedBy}, 'insight fixture concession', ${createdAt}, ${createdAt}
        )
        returning id
      `;
      concessionIds.push(row.id as string);
    }
  }

  return { invoiceIds, paymentIds, reversalIds, concessionIds };
}

export interface EnquirySpec {
  status: "new" | "contacted" | "visit_scheduled" | "application_sent" | "converted" | "closed";
  /** Local `created_at` date, as days before `asOf`. */
  createdDaysAgo: number;
  /** Local `updated_at` date, as days before `asOf` (dwell = asOf - this). */
  updatedDaysAgo: number;
}

export interface ApplicationSpec {
  status: "submitted" | "under_review" | "interaction_scheduled" | "offered" | "accepted" | "rejected" | "withdrawn" | "enrolled";
  createdDaysAgo: number;
  updatedDaysAgo: number;
  gradeAppliedId: string;
  academicYearId: string;
}

/** Plants enquiries and applications per `insight_src_admissions`
 * (rulings "admissions"). */
export async function plantAdmissions(
  admin: Sql,
  institutionId: string,
  asOf: string,
  spec: { enquiries?: EnquirySpec[]; applications?: ApplicationSpec[] },
): Promise<{ enquiryIds: string[]; applicationIds: string[] }> {
  const enquiryIds: string[] = [];
  const applicationIds: string[] = [];

  for (const enquiry of spec.enquiries ?? []) {
    const createdAt = shiftTimestamp(asOf, enquiry.createdDaysAgo);
    const updatedAt = shiftTimestamp(asOf, enquiry.updatedDaysAgo);
    const [row] = await admin`
      insert into public.enquiries (
        institution_id, child_name, guardian_name, phone, status, created_at, updated_at
      )
      values (
        ${institutionId}, 'Insight Fixture Child', 'Insight Fixture Guardian',
        ${`98${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`}, ${enquiry.status}, ${createdAt}, ${updatedAt}
      )
      returning id
    `;
    enquiryIds.push(row.id as string);
  }

  for (const application of spec.applications ?? []) {
    const createdAt = shiftTimestamp(asOf, application.createdDaysAgo);
    const updatedAt = shiftTimestamp(asOf, application.updatedDaysAgo);
    const applicant = { firstName: "Insight", lastName: "Fixture", dob: "2015-01-01", gender: "other" };
    const guardian = { fullName: "Insight Fixture Guardian", phone: "9800000900", relationship: "father" };
    const [row] = await admin`
      insert into public.applications (
        institution_id, applicant, guardian, grade_applied_id, academic_year_id, status, created_at, updated_at
      )
      values (
        ${institutionId}, ${admin.json(applicant)}, ${admin.json(guardian)},
        ${application.gradeAppliedId}, ${application.academicYearId}, ${application.status}, ${createdAt}, ${updatedAt}
      )
      returning id
    `;
    applicationIds.push(row.id as string);
  }

  return { enquiryIds, applicationIds };
}

export interface TimetablePeriodSpec {
  seq: number;
  isBreak?: boolean;
}

export interface TimetableRoomSpec {
  name: string;
  capacity: number;
}

export interface TimetableSlotSpec {
  weekday: number;
  periodSeq: number;
  teacherStaffId: string;
  classSectionId: string;
  subjectId: string;
  /** Looked up against `rooms` by name (see `TimetableRoomSpec`); omitted => no room. */
  roomName?: string;
}

export interface TimetablePlantResult {
  periodIds: Record<number, string>;
  roomIds: Record<string, string>;
  versionId: string;
}

/** Plants periods, rooms, one timetable_versions row and its slots, per
 * insight_src_workload/insight_src_room_capacity/insight_src_rooms
 * (rulings "workload", "timetable-conflicts", "resource-shortage"). Status
 * defaults to "published"; the guard trigger only blocks a status *update*,
 * so this direct insert is unaffected by it. */
export async function plantTimetable(
  admin: Sql,
  institutionId: string,
  academicYearId: string,
  createdBy: string,
  spec: {
    periods: TimetablePeriodSpec[];
    rooms?: TimetableRoomSpec[];
    status?: "draft" | "published";
    slots: TimetableSlotSpec[];
  },
): Promise<TimetablePlantResult> {
  const periodIds: Record<number, string> = {};
  for (const period of spec.periods) {
    const [row] = await admin`
      insert into public.periods (institution_id, seq, name, starts_at, ends_at, is_break)
      values (${institutionId}, ${period.seq}, ${`Period ${period.seq}`}, '09:00', '09:40', ${period.isBreak ?? false})
      returning id
    `;
    periodIds[period.seq] = row.id as string;
  }

  const roomIds: Record<string, string> = {};
  for (const room of spec.rooms ?? []) {
    const [row] = await admin`
      insert into public.rooms (institution_id, name, capacity)
      values (${institutionId}, ${room.name}, ${room.capacity})
      returning id
    `;
    roomIds[room.name] = row.id as string;
  }

  const [version] = await admin`
    insert into public.timetable_versions (institution_id, academic_year_id, name, status, created_by)
    values (${institutionId}, ${academicYearId}, 'Insight fixture timetable', ${spec.status ?? "published"}, ${createdBy})
    returning id
  `;

  for (const slot of spec.slots) {
    const roomId = slot.roomName ? roomIds[slot.roomName] : null;
    await admin`
      insert into public.timetable_slots (
        institution_id, version_id, class_section_id, subject_id, teacher_id, room_id, weekday, period_id
      )
      values (
        ${institutionId}, ${version.id}, ${slot.classSectionId}, ${slot.subjectId}, ${slot.teacherStaffId},
        ${roomId}, ${slot.weekday}, ${periodIds[slot.periodSeq]}
      )
    `;
  }

  return { periodIds, roomIds, versionId: version.id as string };
}
