import postgres from "postgres";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

// Deterministic builders, insert via the admin-level direct DB connection
// (bypassing RLS, like a service role). Student/guardian/staff builders
// weren't added here (T-010/T-011's own test files insert those directly);
// grade/subject/section/enrolment builders are added by T-011.

export async function createAcademicYear(
  institutionId: string,
  overrides: Partial<{ name: string; startsOn: string; endsOn: string; isCurrent: boolean }> = {},
): Promise<string> {
  const name = overrides.name ?? "2026-27";
  const startsOn = overrides.startsOn ?? "2026-04-01";
  const endsOn = overrides.endsOn ?? "2027-03-31";
  const isCurrent = overrides.isCurrent ?? true;

  const [row] = await sql`
    insert into public.academic_years (institution_id, name, starts_on, ends_on, is_current)
    values (${institutionId}, ${name}, ${startsOn}, ${endsOn}, ${isCurrent})
    returning id
  `;
  return row.id as string;
}

export async function createTerm(
  institutionId: string,
  academicYearId: string,
  overrides: Partial<{ name: string; sequence: number; startsOn: string; endsOn: string }> = {},
): Promise<string> {
  const name = overrides.name ?? "Term 1";
  const sequence = overrides.sequence ?? 1;
  const startsOn = overrides.startsOn ?? "2026-04-01";
  const endsOn = overrides.endsOn ?? "2026-09-30";

  const [row] = await sql`
    insert into public.terms (institution_id, academic_year_id, name, sequence, starts_on, ends_on)
    values (${institutionId}, ${academicYearId}, ${name}, ${sequence}, ${startsOn}, ${endsOn})
    returning id
  `;
  return row.id as string;
}

export async function createGrade(
  institutionId: string,
  overrides: Partial<{ code: string; displayName: string; sortKey: number; gradeGroup: string }> = {},
): Promise<string> {
  const code = overrides.code ?? "VI";
  const displayName = overrides.displayName ?? `Grade ${code}`;
  const sortKey = overrides.sortKey ?? 6;
  const gradeGroup = overrides.gradeGroup ?? "middle";

  const [row] = await sql`
    insert into public.grades (institution_id, code, display_name, sort_key, grade_group)
    values (${institutionId}, ${code}, ${displayName}, ${sortKey}, ${gradeGroup})
    returning id
  `;
  return row.id as string;
}

export async function createSubject(
  institutionId: string,
  overrides: Partial<{ code: string; name: string; kind: string }> = {},
): Promise<string> {
  const code = overrides.code ?? `SUB-${crypto.randomUUID().slice(0, 8)}`;
  const name = overrides.name ?? "Mathematics";
  const kind = overrides.kind ?? "scholastic";

  const [row] = await sql`
    insert into public.subjects (institution_id, code, name, kind)
    values (${institutionId}, ${code}, ${name}, ${kind})
    returning id
  `;
  return row.id as string;
}

export async function createClassSection(
  institutionId: string,
  gradeId: string,
  academicYearId: string,
  overrides: Partial<{ name: string; classTeacherId: string | null; capacity: number | null }> = {},
): Promise<string> {
  const name = overrides.name ?? "A";
  const classTeacherId = overrides.classTeacherId ?? null;
  const capacity = overrides.capacity ?? null;

  const [row] = await sql`
    insert into public.class_sections (institution_id, grade_id, academic_year_id, name, class_teacher_id, capacity)
    values (${institutionId}, ${gradeId}, ${academicYearId}, ${name}, ${classTeacherId}, ${capacity})
    returning id
  `;
  return row.id as string;
}

export async function createSubjectAssignment(
  institutionId: string,
  classSectionId: string,
  subjectId: string,
  teacherId: string,
): Promise<string> {
  const [row] = await sql`
    insert into public.subject_assignments (institution_id, class_section_id, subject_id, teacher_id)
    values (${institutionId}, ${classSectionId}, ${subjectId}, ${teacherId})
    returning id
  `;
  return row.id as string;
}

export async function createEnrolment(
  institutionId: string,
  studentId: string,
  classSectionId: string,
  academicYearId: string,
  overrides: Partial<{ rollNo: number; startedOn: string; status: string }> = {},
): Promise<string> {
  const rollNo = overrides.rollNo ?? null;
  const startedOn = overrides.startedOn ?? "2026-04-01";
  const status = overrides.status ?? "active";

  const [row] = await sql`
    insert into public.enrolments (institution_id, student_id, class_section_id, academic_year_id, roll_no, started_on, status)
    values (${institutionId}, ${studentId}, ${classSectionId}, ${academicYearId}, ${rollNo}, ${startedOn}, ${status})
    returning id
  `;
  return row.id as string;
}

export async function createAttendanceSession(
  institutionId: string,
  classSectionId: string,
  overrides: Partial<{ date: string; status: string }> = {},
): Promise<string> {
  const date = overrides.date ?? "2026-07-01";
  const status = overrides.status ?? "open";

  const [row] = await sql`
    insert into public.attendance_sessions (institution_id, class_section_id, date, status)
    values (${institutionId}, ${classSectionId}, ${date}, ${status})
    returning id
  `;
  return row.id as string;
}

export async function createAttendanceRecord(
  institutionId: string,
  sessionId: string,
  studentId: string,
  overrides: Partial<{ status: string; note: string }> = {},
): Promise<string> {
  const status = overrides.status ?? "P";
  const note = overrides.note ?? null;

  const [row] = await sql`
    insert into public.attendance_records (institution_id, session_id, student_id, status, note)
    values (${institutionId}, ${sessionId}, ${studentId}, ${status}, ${note})
    returning id
  `;
  return row.id as string;
}

export async function closeFactoriesHelper(): Promise<void> {
  await sql.end();
}
