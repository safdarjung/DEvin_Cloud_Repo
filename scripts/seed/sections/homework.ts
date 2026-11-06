import { insertBatch } from "../lib/batch.ts";
import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";

// Owner decision (2026-11-07): the demo student section must not be empty.
// 3 published homework assignments per section (English/Mathematics/Science
// units 1-3) for every section of grades VI, VIII and X — the demo logins'
// grades — plus a 4th quiz-type assignment (with an `assignment_answer_keys`
// row) for the 3 named sections only (VI-A, VIII-B, X-A). Dates are relative
// to the run date (homeroom.ts/staffing.ts/library.ts convention), so the
// live demo always has one past-due graded item, one due this week with
// partial submissions, and one due next week with none — `student.one`
// (Ananya Sharma, X-A) and her guardian see all three states.

const NAMED_SECTION_GRADER_LOGIN: Record<string, string> = {
  "VI-A": "teacher.vi-a",
  "VIII-B": "teacher.viii-b",
  "X-A": "teacher.x-a",
};
const HOMEWORK_GRADE_CODES = ["VI", "VIII", "X"];
// Always present regardless of SEED_SCALE: subjectsFor("middle"/"secondary", ...)
// includes these 3 for every section letter.
const ASSIGNMENT_SUBJECTS = [
  { code: "ENG", unitSequence: 1, variant: "past" as const },
  { code: "MATH", unitSequence: 2, variant: "week" as const },
  { code: "SCI", unitSequence: 3, variant: "next" as const },
];
const QUIZ_SUBJECT_CODE = "MATH";
const QUIZ_UNIT_SEQUENCE = 4;

// Most students (roll 1-38 of 42) submitted and are graded; roll 39-42 never submitted.
const GRADED_ROLL_CUTOFF = 38;
// Some students (roll 1-15 of 42) submitted the "due this week" item, ungraded.
const SUBMITTED_ROLL_CUTOFF = 15;

function todayIST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dueAt(iso: string): string {
  return `${iso}T23:59:00+05:30`;
}

/** Deterministic 60-99 score from roll number — no PRNG draw, so it never shifts any other section's rng-dependent output. */
function scoreFor(rollNo: number): number {
  return 60 + ((rollNo * 7) % 40);
}

export async function run(ctx: SeedContext): Promise<void> {
  const today = todayIST();

  const { data: grades, error: gradesError } = await ctx.admin
    .from("grades")
    .select("id, code")
    .eq("institution_id", ctx.institutionId)
    .in("code", HOMEWORK_GRADE_CODES);
  if (gradesError) throw new Error(`homework: grades query failed: ${gradesError.message}`);
  const gradeIds = (grades ?? []).map((g) => g.id);
  const gradeCodeById = new Map((grades ?? []).map((g) => [g.id, g.code]));

  const { data: sections, error: sectionsError } = await ctx.admin
    .from("class_sections")
    .select("id, grade_id, name")
    .eq("institution_id", ctx.institutionId)
    .eq("academic_year_id", ctx.academicYearId)
    .in("grade_id", gradeIds);
  if (sectionsError) throw new Error(`homework: class_sections query failed: ${sectionsError.message}`);
  const sectionIds = (sections ?? []).map((s) => s.id);

  const { data: subjects, error: subjectsError } = await ctx.admin
    .from("subjects")
    .select("id, code, name")
    .eq("institution_id", ctx.institutionId)
    .in("code", [...ASSIGNMENT_SUBJECTS.map((s) => s.code), QUIZ_SUBJECT_CODE]);
  if (subjectsError) throw new Error(`homework: subjects query failed: ${subjectsError.message}`);
  const subjectByCode = new Map((subjects ?? []).map((s) => [s.code, s]));

  const { data: units, error: unitsError } = await ctx.admin
    .from("curriculum_units")
    .select("id, subject_id, grade_id, sequence")
    .eq("institution_id", ctx.institutionId)
    .in("grade_id", gradeIds);
  if (unitsError) throw new Error(`homework: curriculum_units query failed: ${unitsError.message}`);
  const unitBySubjectGradeSeq = new Map(units?.map((u) => [`${u.subject_id}:${u.grade_id}:${u.sequence}`, u.id]));

  const { data: teaching, error: teachingError } = await ctx.admin
    .from("subject_assignments")
    .select("class_section_id, subject_id, teacher_id")
    .eq("institution_id", ctx.institutionId)
    .in("class_section_id", sectionIds);
  if (teachingError) throw new Error(`homework: subject_assignments query failed: ${teachingError.message}`);
  const teacherBySectionSubject = new Map(teaching?.map((t) => [`${t.class_section_id}:${t.subject_id}`, t.teacher_id]));

  const { data: enrolments, error: enrolmentsError } = await ctx.admin
    .from("enrolments")
    .select("student_id, class_section_id, roll_no")
    .eq("institution_id", ctx.institutionId)
    .eq("status", "active")
    .in("class_section_id", sectionIds)
    .order("roll_no");
  if (enrolmentsError) throw new Error(`homework: enrolments query failed: ${enrolmentsError.message}`);
  const enrolmentsBySection = new Map<string, { studentId: string; rollNo: number }[]>();
  for (const e of enrolments ?? []) {
    const list = enrolmentsBySection.get(e.class_section_id) ?? [];
    list.push({ studentId: e.student_id, rollNo: e.roll_no! });
    enrolmentsBySection.set(e.class_section_id, list);
  }

  const assignmentRows: Record<string, unknown>[] = [];
  const submissionRows: Record<string, unknown>[] = [];
  const answerKeyRows: Record<string, unknown>[] = [];

  for (const section of sections ?? []) {
    const gradeCode = gradeCodeById.get(section.grade_id)!;
    const sectionKey = `${gradeCode}-${section.name}`;
    const namedLogin = NAMED_SECTION_GRADER_LOGIN[sectionKey];
    const graderUserId = namedLogin ? ctx.userIdByLogin[namedLogin]! : ctx.userIdByLogin.principal!;
    const roster = enrolmentsBySection.get(section.id) ?? [];

    for (const { code, unitSequence, variant } of ASSIGNMENT_SUBJECTS) {
      const subject = subjectByCode.get(code)!;
      const unitId = unitBySubjectGradeSeq.get(`${subject.id}:${section.grade_id}:${unitSequence}`) ?? null;
      const teacherId = teacherBySectionSubject.get(`${section.id}:${subject.id}`)!;
      const assignmentId = uuidV5("homework", `assignment:${sectionKey}:${code}:${variant}`);
      const dueOn = variant === "past" ? addDays(today, -14) : variant === "week" ? addDays(today, 3) : addDays(today, 10);

      assignmentRows.push({
        id: assignmentId,
        institution_id: ctx.institutionId,
        class_section_id: section.id,
        subject_id: subject.id,
        curriculum_unit_id: unitId,
        title: `${subject.name} Homework: ${variant === "past" ? "Unit 1 exercises" : variant === "week" ? "Unit 2 practice set" : "Unit 3 preview"}`,
        instructions: `Complete the exercises for the current unit and submit before the due date.`,
        due_at: dueAt(dueOn),
        status: "published",
        created_by: teacherId,
        ai_generated: false,
      });

      if (variant === "past") {
        for (const { studentId, rollNo } of roster) {
          if (rollNo > GRADED_ROLL_CUTOFF) continue;
          submissionRows.push({
            id: uuidV5("homework", `submission:${sectionKey}:${code}:${variant}:${rollNo}`),
            institution_id: ctx.institutionId,
            assignment_id: assignmentId,
            student_id: studentId,
            submitted_at: `${addDays(dueOn, -2)}T18:00:00+05:30`,
            status: "graded",
            attempt: 1,
            is_late: false,
            score: scoreFor(rollNo),
            max_score: 100,
            feedback: "Good work. Review the worked examples for the steps you missed.",
            graded_by: graderUserId,
            graded_at: `${addDays(dueOn, 3)}T10:00:00+05:30`,
          });
        }
      } else if (variant === "week") {
        for (const { studentId, rollNo } of roster) {
          if (rollNo > SUBMITTED_ROLL_CUTOFF) continue;
          submissionRows.push({
            id: uuidV5("homework", `submission:${sectionKey}:${code}:${variant}:${rollNo}`),
            institution_id: ctx.institutionId,
            assignment_id: assignmentId,
            student_id: studentId,
            submitted_at: `${addDays(today, -1)}T19:00:00+05:30`,
            status: "submitted",
            attempt: 1,
            is_late: false,
          });
        }
      }
      // variant === "next": no submissions.
    }

    if (namedLogin) {
      const subject = subjectByCode.get(QUIZ_SUBJECT_CODE)!;
      const unitId = unitBySubjectGradeSeq.get(`${subject.id}:${section.grade_id}:${QUIZ_UNIT_SEQUENCE}`) ?? null;
      const teacherId = teacherBySectionSubject.get(`${section.id}:${subject.id}`)!;
      const assignmentId = uuidV5("homework", `assignment:${sectionKey}:${QUIZ_SUBJECT_CODE}:quiz`);

      assignmentRows.push({
        id: assignmentId,
        institution_id: ctx.institutionId,
        class_section_id: section.id,
        subject_id: subject.id,
        curriculum_unit_id: unitId,
        title: `${subject.name} Quiz: Unit 4 check`,
        instructions: "Answer both questions. This is an AI-generated practice quiz.",
        // QuizStoredContentSchema shape (src/modules/academics/assignments.schemas.ts):
        // answers/explanations live only in assignment_answer_keys (DBT-21).
        content: {
          questions: [
            { stem: "Which of these is a quadratic equation?", options: ["x + 2 = 5", "x^2 - 4 = 0", "2x = 10", "x/2 = 3"] },
            { stem: "What is the value of x in x^2 = 9, x > 0?", options: ["1", "2", "3", "9"] },
          ],
        },
        due_at: dueAt(addDays(today, 10)),
        status: "published",
        created_by: teacherId,
        ai_generated: true,
      });

      answerKeyRows.push({
        id: uuidV5("homework", `answer_key:${sectionKey}`),
        institution_id: ctx.institutionId,
        assignment_id: assignmentId,
        answers: {
          questions: [
            { answer: "x^2 - 4 = 0", explanation: "A quadratic equation has a term with the variable squared." },
            { answer: "3", explanation: "3^2 = 9 and 3 is positive." },
          ],
        },
      });
      // No submissions for the quiz: it's due next week, same as the "next" variant above.
    }
  }

  await insertBatch(ctx.admin, "assignments", assignmentRows);
  await insertBatch(ctx.admin, "assignment_submissions", submissionRows);
  await insertBatch(ctx.admin, "assignment_answer_keys", answerKeyRows);
}
