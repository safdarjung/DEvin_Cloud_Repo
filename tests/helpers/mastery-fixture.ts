// M20-T4 — fixture for mastery_snapshots / exam_papers.unit_ids RLS
// (migration 0093 part 1). Reuses tests/helpers/factories.ts builders where
// they fit; direct admin-level inserts (bypassing RLS) for rows no factory
// covers yet (curriculum_units, guardian link, plain students).
import postgres from "postgres";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createEnrolment,
  createGrade,
  createSubject,
  createSubjectAssignment,
  createTerm,
} from "./factories";
import type { TestInstitution } from "./roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

export async function closeMasteryFixtureHelper(): Promise<void> {
  await sql.end();
  await closeFactoriesHelper();
}

/** `today ± days`, UTC-safe, `YYYY-MM-DD`. */
function shiftFromToday(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function membershipIds(
  institutionId: string,
  userId: string,
): Promise<{ staffId: string | null; guardianId: string | null; studentId: string | null }> {
  const [row] = await sql`
    select staff_id, guardian_id, student_id from public.memberships
    where institution_id = ${institutionId} and user_id = ${userId}
  `;
  return {
    staffId: (row?.staff_id as string | null) ?? null,
    guardianId: (row?.guardian_id as string | null) ?? null,
    studentId: (row?.student_id as string | null) ?? null,
  };
}

async function insertCurriculumUnit(
  institutionId: string,
  subjectId: string,
  gradeId: string,
  sequence: number,
  title: string,
): Promise<string> {
  const [row] = await sql`
    insert into public.curriculum_units (institution_id, subject_id, grade_id, title, sequence)
    values (${institutionId}, ${subjectId}, ${gradeId}, ${title}, ${sequence})
    returning id
  `;
  return row.id as string;
}

async function insertPlainStudent(institutionId: string, admissionNo: string): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo}, 'Test', '2014-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

export interface MasteryFixture {
  academicYearId: string;
  termId: string;
  gradeId: string;
  subjects: {
    maths: { id: string; units: [string, string] };
    science: { id: string; units: [string, string] };
  };
  sections: { a: string; b: string; c: string };
  /** Fixture teacher's staff id: class teacher of A, teaches Maths at A and Science at B only. */
  teacherStaffId: string;
  students: {
    /** `inst.users.student`'s own student row — enrolled in A, linked to `inst.users.guardian`. */
    fixture: string;
    a2: string;
    b1: string;
    c1: string;
  };
}

/**
 * Current year + one term covering today; one grade; subjects Maths/Science
 * with 2 curriculum units each; section A (class teacher = fixture teacher,
 * who teaches Maths there), section B (fixture teacher teaches Science
 * only, no class teacher), section C (no fixture teacher); the fixture
 * student enrolled in A and linked to the fixture guardian, student A2 in
 * A, B1 in B, C1 in C (M20-tasks.md Task 4 FILES).
 */
export async function buildMasteryFixture(inst: TestInstitution): Promise<MasteryFixture> {
  const academicYearId = await createAcademicYear(inst.institutionId, {
    startsOn: shiftFromToday(-240),
    endsOn: shiftFromToday(240),
    isCurrent: true,
  });
  const termId = await createTerm(inst.institutionId, academicYearId, {
    startsOn: shiftFromToday(-30),
    endsOn: shiftFromToday(30),
  });
  const gradeId = await createGrade(inst.institutionId);

  const mathsId = await createSubject(inst.institutionId, {
    name: "Maths",
    code: `MATH-${crypto.randomUUID().slice(0, 8)}`,
  });
  const scienceId = await createSubject(inst.institutionId, {
    name: "Science",
    code: `SCI-${crypto.randomUUID().slice(0, 8)}`,
  });

  const mathsUnits: [string, string] = [
    await insertCurriculumUnit(inst.institutionId, mathsId, gradeId, 1, "Algebra basics"),
    await insertCurriculumUnit(inst.institutionId, mathsId, gradeId, 2, "Geometry basics"),
  ];
  const scienceUnits: [string, string] = [
    await insertCurriculumUnit(inst.institutionId, scienceId, gradeId, 1, "Forces"),
    await insertCurriculumUnit(inst.institutionId, scienceId, gradeId, 2, "Energy"),
  ];

  const teacher = await membershipIds(inst.institutionId, inst.users.teacher.id);
  if (!teacher.staffId) throw new Error("mastery fixture: teacher membership has no staff_id");

  const sectionA = await createClassSection(inst.institutionId, gradeId, academicYearId, {
    name: "A",
    classTeacherId: teacher.staffId,
  });
  const sectionB = await createClassSection(inst.institutionId, gradeId, academicYearId, { name: "B" });
  const sectionC = await createClassSection(inst.institutionId, gradeId, academicYearId, { name: "C" });

  await createSubjectAssignment(inst.institutionId, sectionA, mathsId, teacher.staffId);
  await createSubjectAssignment(inst.institutionId, sectionB, scienceId, teacher.staffId);

  const fixtureMembership = await membershipIds(inst.institutionId, inst.users.student.id);
  const guardianMembership = await membershipIds(inst.institutionId, inst.users.guardian.id);
  if (!fixtureMembership.studentId) throw new Error("mastery fixture: student membership has no student_id");
  if (!guardianMembership.guardianId) throw new Error("mastery fixture: guardian membership has no guardian_id");

  await createEnrolment(inst.institutionId, fixtureMembership.studentId, sectionA, academicYearId);
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
    values (${inst.institutionId}, ${guardianMembership.guardianId}, ${fixtureMembership.studentId}, 'father', true)
  `;

  const a2 = await insertPlainStudent(inst.institutionId, `ADM-A2-${crypto.randomUUID().slice(0, 6)}`);
  await createEnrolment(inst.institutionId, a2, sectionA, academicYearId);

  const b1 = await insertPlainStudent(inst.institutionId, `ADM-B1-${crypto.randomUUID().slice(0, 6)}`);
  await createEnrolment(inst.institutionId, b1, sectionB, academicYearId);

  const c1 = await insertPlainStudent(inst.institutionId, `ADM-C1-${crypto.randomUUID().slice(0, 6)}`);
  await createEnrolment(inst.institutionId, c1, sectionC, academicYearId);

  return {
    academicYearId,
    termId,
    gradeId,
    subjects: { maths: { id: mathsId, units: mathsUnits }, science: { id: scienceId, units: scienceUnits } },
    sections: { a: sectionA, b: sectionB, c: sectionC },
    teacherStaffId: teacher.staffId,
    students: { fixture: fixtureMembership.studentId, a2, b1, c1 },
  };
}

export interface SnapshotInput {
  studentId: string;
  classSectionId: string;
  subjectId: string;
  curriculumUnitId: string;
  score?: number;
  confidence?: number;
  markCount?: number;
  submissionCount?: number;
  evidence?: Record<string, string | number | boolean | null>[];
  detectorVersion?: string;
  computedAt?: string;
}

export interface PublishExamMark {
  studentId: string;
  subjectKey: "maths" | "science";
  marksObtained: number | null;
  isAbsent?: boolean;
}

export interface PublishExamInput {
  status?: "draft" | "marks_entry" | "verification" | "published";
  classSectionId?: string;
  maxMarks?: number;
  unitIdsBySubject: Partial<Record<"maths" | "science", string[]>>;
  marks: PublishExamMark[];
  heldOn?: string;
}

export interface PublishedExam {
  examId: string;
  paperIdsBySubject: Partial<Record<"maths" | "science", string>>;
  markIds: string[];
}

/**
 * Service-role insert of one exam + one exam_paper per subject key in
 * `unitIdsBySubject` + marks against those papers (M20-tasks.md Task 5
 * FILES). `status` default `published` (with `published_at` stamped so
 * `held_on`-less papers still get an `on` evidence date).
 */
export async function publishExam(
  inst: TestInstitution,
  fx: MasteryFixture,
  input: PublishExamInput,
): Promise<PublishedExam> {
  const status = input.status ?? "published";
  const classSectionId = input.classSectionId ?? fx.sections.a;
  const maxMarks = input.maxMarks ?? 100;

  const [exam] = await sql`
    insert into public.exams (institution_id, academic_year_id, term_id, name, type, status, published_at)
    values (
      ${inst.institutionId}, ${fx.academicYearId}, ${fx.termId}, ${`Exam-${crypto.randomUUID().slice(0, 8)}`},
      'unit_test', ${status}, ${status === "published" ? new Date().toISOString() : null}
    )
    returning id
  `;
  const examId = exam.id as string;

  const paperIdsBySubject: Partial<Record<"maths" | "science", string>> = {};
  for (const subjectKey of Object.keys(input.unitIdsBySubject) as ("maths" | "science")[]) {
    const unitIds = input.unitIdsBySubject[subjectKey] ?? [];
    const subjectId = fx.subjects[subjectKey].id;
    const [paper] = await sql`
      insert into public.exam_papers (institution_id, exam_id, class_section_id, subject_id, max_marks, pass_marks, held_on, unit_ids)
      values (
        ${inst.institutionId}, ${examId}, ${classSectionId}, ${subjectId}, ${maxMarks}, ${maxMarks * 0.33},
        ${input.heldOn ?? null}, ${unitIds}
      )
      returning id
    `;
    paperIdsBySubject[subjectKey] = paper.id as string;
  }

  const markIds: string[] = [];
  for (const mark of input.marks) {
    const paperId = paperIdsBySubject[mark.subjectKey];
    if (!paperId) throw new Error(`publishExam: no paper for subject ${mark.subjectKey}`);
    const [row] = await sql`
      insert into public.marks (institution_id, exam_paper_id, student_id, marks_obtained, is_absent)
      values (${inst.institutionId}, ${paperId}, ${mark.studentId}, ${mark.marksObtained}, ${mark.isAbsent ?? false})
      returning id
    `;
    markIds.push(row.id as string);
  }

  return { examId, paperIdsBySubject, markIds };
}

export interface GradeSubmissionInput {
  studentId: string;
  classSectionId: string;
  subjectId: string;
  curriculumUnitId: string;
  score: number;
  maxScore?: number;
  status?: "submitted" | "graded";
  gradedAt?: string;
}

/**
 * Service-role insert of one assignment (mapped to `curriculumUnitId`) +
 * one submission (M20-tasks.md Task 5 FILES). `status: "submitted"` (the
 * default for ungraded-submission tests) leaves score/max_score/graded_at/
 * graded_by null per `assignment_submissions_graded_consistency` (0071).
 */
export async function gradeSubmission(inst: TestInstitution, fx: MasteryFixture, input: GradeSubmissionInput): Promise<string> {
  const status = input.status ?? "graded";
  const isGraded = status === "graded";
  const maxScore = input.maxScore ?? 10;

  const [assignment] = await sql`
    insert into public.assignments (institution_id, class_section_id, subject_id, curriculum_unit_id, title, status, created_by)
    values (
      ${inst.institutionId}, ${input.classSectionId}, ${input.subjectId}, ${input.curriculumUnitId},
      ${`Assignment-${crypto.randomUUID().slice(0, 8)}`}, 'published', ${fx.teacherStaffId}
    )
    returning id
  `;

  const [submission] = await sql`
    insert into public.assignment_submissions (
      institution_id, assignment_id, student_id, status, score, max_score, graded_at, graded_by
    )
    values (
      ${inst.institutionId}, ${assignment.id}, ${input.studentId}, ${status},
      ${isGraded ? input.score : null}, ${isGraded ? maxScore : null},
      ${isGraded ? input.gradedAt ?? new Date().toISOString() : null},
      ${isGraded ? inst.users.teacher.id : null}
    )
    returning id
  `;
  return submission.id as string;
}

/** Service-role (direct admin connection) insert of mastery_snapshots rows. */
export async function insertSnapshots(
  inst: TestInstitution,
  fx: MasteryFixture,
  rows: SnapshotInput[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const row of rows) {
    const evidence = row.evidence ?? [{ src: "mark", id: crypto.randomUUID(), score: row.score ?? 0.75, w: 2, on: shiftFromToday(0) }];
    const [inserted] = await sql`
      insert into public.mastery_snapshots (
        institution_id, academic_year_id, student_id, class_section_id, subject_id, curriculum_unit_id,
        score, confidence, mark_count, submission_count, evidence, detector_version, computed_at
      )
      values (
        ${inst.institutionId}, ${fx.academicYearId}, ${row.studentId}, ${row.classSectionId}, ${row.subjectId}, ${row.curriculumUnitId},
        ${row.score ?? 0.75}, ${row.confidence ?? 0.75}, ${row.markCount ?? 1}, ${row.submissionCount ?? 0},
        ${sql.json(evidence)}, ${row.detectorVersion ?? "mastery_v1"}, ${row.computedAt ?? new Date().toISOString()}
      )
      returning id
    `;
    ids.push(inserted.id as string);
  }
  return ids;
}

export interface GapPlan {
  insightId: string;
  actionId: string;
}

/**
 * Service-role (direct `postgres` connection, trusted by `app.guard_intervention`)
 * insert of one insight + one `kind = 'intervention'` insight_actions row for
 * `studentId` (M20-tasks.md Task 6 FILES). M19 columns per the contract in
 * `.superpowers/sdd/M20-tasks/progress.md` § M19 contract — `signal` uses an
 * existing enum value (M19 owns that check constraint; `mastery_gap` isn't
 * one of its values yet, T12's problem, not this fixture's).
 */
export async function insertGapPlan(
  inst: TestInstitution,
  fx: MasteryFixture,
  studentId: string,
  status: "proposed" | "active" | "review" | "closed" = "proposed",
): Promise<GapPlan> {
  const [insight] = await sql`
    insert into public.insights (
      institution_id, signal, detector_version, dedupe_key, domain, kind, severity,
      title, pattern, evidence, date_from, date_to, confidence, reviewer_role,
      entity_type, entity_id
    )
    values (
      ${inst.institutionId}, 'academics.marks_decline', 1, ${`mastery-gap-${crypto.randomUUID()}`},
      'academics', 'diagnostic', 'warning', 'Learning gaps need support',
      '2 units below 60% mastery; overall 45%', ${sql.json([{ label: "Gap units", value: 2 }])},
      ${shiftFromToday(-30)}, ${shiftFromToday(0)}, 0.5, 'exam_controller', 'student', ${studentId}
    )
    returning id
  `;

  const [action] = await sql`
    insert into public.insight_actions (
      institution_id, insight_id, action, owner, rationale, expected_outcome, status, created_by,
      kind, student_id, goal, steps, review_date, intervention_status, owner_staff_id
    )
    values (
      ${inst.institutionId}, ${insight.id}, 'Intervention plan', 'Fixture Teacher',
      'mastery_gap_v1: 2 gap units, overall 45%', 'Listed units at or above 60% mastery', 'planned',
      ${inst.users.owner.id}, 'intervention', ${studentId}, 'Raise 2 gap units to 60% mastery',
      ${sql.json([{ title: "Re-teach: Algebra basics (Maths)", due: shiftFromToday(7), done: false }])},
      ${shiftFromToday(14)}, ${status}, ${fx.teacherStaffId}
    )
    returning id
  `;

  return { insightId: insight.id as string, actionId: action.id as string };
}
