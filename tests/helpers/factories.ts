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

// T-030 — finance + admissions builders, same bypassing-RLS shape as above.

export async function createApplication(
  institutionId: string,
  gradeAppliedId: string,
  academicYearId: string,
  overrides: Partial<{
    status: string;
    applicant: Record<string, string>;
    guardian: Record<string, string>;
  }> = {},
): Promise<string> {
  const status = overrides.status ?? "accepted";
  const applicant = overrides.applicant ?? { firstName: "Test", lastName: "Applicant", dob: "2015-01-01", gender: "other" };
  const guardian = overrides.guardian ?? { fullName: "Test Guardian", phone: "9800000900", relationship: "father" };

  const [row] = await sql`
    insert into public.applications (institution_id, applicant, guardian, grade_applied_id, academic_year_id, status)
    values (${institutionId}, ${sql.json(applicant)}, ${sql.json(guardian)}, ${gradeAppliedId}, ${academicYearId}, ${status})
    returning id
  `;
  return row.id as string;
}

// T-027 — admissions builder, same bypassing-RLS shape as above.

export async function createEnquiry(
  institutionId: string,
  overrides: Partial<{
    childName: string;
    guardianName: string;
    phone: string;
    status: string;
    gradeAppliedId: string | null;
    assignedTo: string | null;
    notes: postgres.JSONValue;
  }> = {},
): Promise<string> {
  const childName = overrides.childName ?? "Test Child";
  const guardianName = overrides.guardianName ?? "Test Guardian";
  const phone = overrides.phone ?? "9800000800";
  const status = overrides.status ?? "new";
  const gradeAppliedId = overrides.gradeAppliedId ?? null;
  const assignedTo = overrides.assignedTo ?? null;
  const notes = overrides.notes === undefined ? null : sql.json(overrides.notes);

  const [row] = await sql`
    insert into public.enquiries (institution_id, child_name, guardian_name, phone, status, grade_applied_id, assigned_to, notes)
    values (${institutionId}, ${childName}, ${guardianName}, ${phone}, ${status}, ${gradeAppliedId}, ${assignedTo}, ${notes})
    returning id
  `;
  return row.id as string;
}

export async function createFeeStructure(
  institutionId: string,
  academicYearId: string,
  gradeId: string,
  overrides: Partial<{ name: string; isDefault: boolean }> = {},
): Promise<string> {
  const name = overrides.name ?? "Standard";
  const isDefault = overrides.isDefault ?? true;

  const [row] = await sql`
    insert into public.fee_structures (institution_id, academic_year_id, grade_id, name, is_default)
    values (${institutionId}, ${academicYearId}, ${gradeId}, ${name}, ${isDefault})
    returning id
  `;
  return row.id as string;
}

export async function createFeeComponent(
  institutionId: string,
  feeStructureId: string,
  overrides: Partial<{ head: string; amount: number; frequency: string; appliesToNewOnly: boolean }> = {},
): Promise<string> {
  const head = overrides.head ?? "tuition";
  const amount = overrides.amount ?? 10000;
  const frequency = overrides.frequency ?? "term";
  const appliesToNewOnly = overrides.appliesToNewOnly ?? false;

  const [row] = await sql`
    insert into public.fee_components (institution_id, fee_structure_id, head, amount, frequency, applies_to_new_only)
    values (${institutionId}, ${feeStructureId}, ${head}, ${amount}, ${frequency}, ${appliesToNewOnly})
    returning id
  `;
  return row.id as string;
}

export async function createFeeAssignment(
  institutionId: string,
  studentId: string,
  feeStructureId: string,
  academicYearId: string,
): Promise<string> {
  const [row] = await sql`
    insert into public.fee_assignments (institution_id, student_id, fee_structure_id, academic_year_id)
    values (${institutionId}, ${studentId}, ${feeStructureId}, ${academicYearId})
    returning id
  `;
  return row.id as string;
}

export async function closeFactoriesHelper(): Promise<void> {
  await sql.end();
}
