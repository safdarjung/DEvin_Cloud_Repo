// M19-T4 — plant fixtures for insight_src_attendance/marks/submissions
// (migration 0092 part 3). Admin-level direct DB connection (bypasses RLS,
// same convention as tests/helpers/factories.ts); explicit timestamps are
// set where a row's "as of" date must be backdated, since the
// `set_updated_at` trigger only fires on UPDATE, not on INSERT.
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
