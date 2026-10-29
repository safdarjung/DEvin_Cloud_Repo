import { insertBatch } from "../lib/batch.ts";
import type { SeedContext } from "../lib/context.ts";
import { GRADES, sectionKey, sectionNames } from "../lib/grades.ts";
import { uuidV5 } from "../lib/ids.ts";
import { curriculumUnits, subjectsFor, type SubjectDef } from "../lib/subjects.ts";

// 05 §8 / §2.3 — 12 grades x 6 sections = 72 (capacity 45), class teachers
// (3 already created by core.ts/people.ts for the named demo teachers),
// subjects by grade group, subject_assignments (round-robin, class teacher
// gets one subject — Mathematics when the section teaches it, matching
// 05 §8.1's "teacher.x-a also teaches X-A Mathematics"), enrolments with
// roll_no 1-42 alphabetical, 4 curriculum units per subject actually taught
// in that grade.

const NAMED_CLASS_TEACHER_LOGIN: Record<string, string> = {
  "VI-A": "teacher.vi-a",
  "VIII-B": "teacher.viii-b",
  "X-A": "teacher.x-a",
};

function byFirstName(a: { firstName: string }, b: { firstName: string }): number {
  return a.firstName.toLowerCase().localeCompare(b.firstName.toLowerCase());
}

export async function run(ctx: SeedContext): Promise<void> {
  // ---- grades ----
  const gradeIdByCode: Record<string, string> = {};
  const gradeRows = GRADES.map((grade) => {
    const id = uuidV5("academics", `grade:${grade.code}`);
    gradeIdByCode[grade.code] = id;
    return {
      id,
      institution_id: ctx.institutionId,
      code: grade.code,
      display_name: grade.displayName,
      sort_key: grade.sortKey,
      grade_group: grade.gradeGroup,
    };
  });
  await insertBatch(ctx.admin, "grades", gradeRows);

  // ---- subjects: global catalog, deduped by code across every grade/stream ----
  const subjectDefByCode: Record<string, SubjectDef> = {};
  for (const grade of GRADES) {
    for (const sectionName of sectionNames(grade.code)) {
      for (const subject of subjectsFor(grade.gradeGroup, sectionName)) {
        subjectDefByCode[subject.code] = subject;
      }
    }
  }
  const subjectIdByCode: Record<string, string> = {};
  const subjectRows = Object.values(subjectDefByCode).map((subject) => {
    const id = uuidV5("academics", `subject:${subject.code}`);
    subjectIdByCode[subject.code] = id;
    return { id, institution_id: ctx.institutionId, code: subject.code, name: subject.name, kind: subject.kind };
  });
  await insertBatch(ctx.admin, "subjects", subjectRows);

  // ---- class_sections + subject_assignments + enrolments (one pass per section) ----
  const sectionRows: Record<string, unknown>[] = [];
  const assignmentRows: Record<string, unknown>[] = [];
  const enrolmentRows: Record<string, unknown>[] = [];
  let subjectTeacherCursor = 0;

  // T-016 fix: unnamed sections must draw their class teacher from a pool
  // that excludes the 3 named demo class teachers, and from a cursor of its
  // own (not shared with subjectTeacherCursor) — otherwise modulo
  // wraparound over 100 staff ids previously let the same staff member
  // (sometimes one of the 3 named teachers) become class teacher of more
  // than one section.
  const namedClassTeacherIds = new Set(
    Object.values(NAMED_CLASS_TEACHER_LOGIN).map((login) => ctx.linkIdByLogin[login]!),
  );
  const unnamedClassTeacherPool = ctx.teacherStaffIds.filter((id) => !namedClassTeacherIds.has(id));
  let classTeacherCursor = 0;

  for (const grade of GRADES) {
    for (const sectionName of sectionNames(grade.code)) {
      const key = sectionKey(grade.code, sectionName);
      const namedLogin = NAMED_CLASS_TEACHER_LOGIN[key];
      const classTeacherId = namedLogin
        ? ctx.linkIdByLogin[namedLogin]!
        : unnamedClassTeacherPool[classTeacherCursor++ % unnamedClassTeacherPool.length]!;

      const sectionId = uuidV5("academics", `section:${key}`);
      sectionRows.push({
        id: sectionId,
        institution_id: ctx.institutionId,
        grade_id: gradeIdByCode[grade.code],
        academic_year_id: ctx.academicYearId,
        name: sectionName,
        class_teacher_id: classTeacherId,
        capacity: 45,
      });

      const subjects = subjectsFor(grade.gradeGroup, sectionName);
      const mathIndex = subjects.findIndex((s) => s.code === "MATH");
      const classTeacherSubjectIndex = mathIndex >= 0 ? mathIndex : 0;
      for (let si = 0; si < subjects.length; si++) {
        const subject = subjects[si]!;
        const teacherId =
          si === classTeacherSubjectIndex
            ? classTeacherId
            : ctx.teacherStaffIds[subjectTeacherCursor++ % ctx.teacherStaffIds.length]!;
        assignmentRows.push({
          id: uuidV5("academics", `assignment:${key}:${subject.code}`),
          institution_id: ctx.institutionId,
          class_section_id: sectionId,
          subject_id: subjectIdByCode[subject.code],
          teacher_id: teacherId,
        });
      }

      const students = [...(ctx.studentsBySection[key] ?? [])].sort(byFirstName);
      students.forEach((student, idx) => {
        enrolmentRows.push({
          id: uuidV5("academics", `enrolment:${key}:${idx}`),
          institution_id: ctx.institutionId,
          student_id: student.id,
          class_section_id: sectionId,
          academic_year_id: ctx.academicYearId,
          roll_no: idx + 1,
          status: "active",
          started_on: "2026-04-01",
        });
      });
    }
  }

  await insertBatch(ctx.admin, "class_sections", sectionRows);
  await insertBatch(ctx.admin, "subject_assignments", assignmentRows);
  await insertBatch(ctx.admin, "enrolments", enrolmentRows);

  // ---- curriculum_units: 4 per subject actually taught in that grade ----
  const curriculumRows: Record<string, unknown>[] = [];
  for (const grade of GRADES) {
    const codesInGrade = new Set<string>();
    for (const sectionName of sectionNames(grade.code)) {
      for (const subject of subjectsFor(grade.gradeGroup, sectionName)) codesInGrade.add(subject.code);
    }
    for (const code of codesInGrade) {
      const subject = subjectDefByCode[code]!;
      curriculumUnits(subject, grade.displayName).forEach((unit, idx) => {
        curriculumRows.push({
          id: uuidV5("academics", `unit:${grade.code}:${code}:${idx + 1}`),
          institution_id: ctx.institutionId,
          subject_id: subjectIdByCode[code],
          grade_id: gradeIdByCode[grade.code],
          title: unit.title,
          description: unit.description,
          sequence: idx + 1,
        });
      });
    }
  }
  await insertBatch(ctx.admin, "curriculum_units", curriculumRows);
}
