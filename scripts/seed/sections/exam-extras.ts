import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";
import { demoUsers, insertOnce, isoAt } from "../lib/util.ts";

// answer_sheets: scanned-script metadata for three Grade X-A papers of the marks-entry exam
// (Periodic Test 2). Only the row is seeded; no PDF is uploaded, so a download from the
// bucket 404s (honest limit, scans are P1 and re-uploadable).
// result_remarks: class-teacher remarks on the *current* Half-Yearly results of the three demo
// class teachers' sections, worded from the result's own grade.
// Not seeded: recheck_decisions (only 2 recheck requests exist and one is already decided;
// the rest would need new requests plus the marks-revision engine); exam_seating_plans/
// exam_seats are already filled by the exam_seating section.

const SHEET_SUBJECTS = ["MATH", "SCI", "ENG"];

const REMARKS: Record<string, string[]> = {
  A: ["Outstanding result. Keeps a clear, methodical approach to every subject.", "Excellent work this term. Encourage participation in olympiads."],
  B: ["Good, steady performance. A little more revision before tests will lift the grade further.", "Consistent effort. Should attempt the extension questions in mathematics and science."],
  C: ["Satisfactory. Needs regular practice in written work and timely completion of homework.", "Can do better with focused revision. Please check the diary daily."],
  D: ["Needs extra support. Please meet the class teacher to plan weekly practice.", "Below expectation in several subjects. Remedial classes are recommended."],
};

function remarkFor(grade: string, index: number): string {
  const band = grade.startsWith("A") ? "A" : grade.startsWith("B") ? "B" : grade.startsWith("C") ? "C" : "D";
  return REMARKS[band]![index % REMARKS[band]!.length]!;
}

export async function run(ctx: SeedContext): Promise<void> {
  const inst = ctx.institutionId;
  const users = await demoUsers(ctx.sql, inst);

  const papers = await ctx.sql<{ id: string; section_id: string }[]>`
    select p.id, p.class_section_id as section_id
    from public.exam_papers p
    join public.exams e on e.id = p.exam_id
    join public.subjects s on s.id = p.subject_id
    join public.class_sections cs on cs.id = p.class_section_id
    join public.grades g on g.id = cs.grade_id
    where p.institution_id = ${inst} and e.status = 'marks_entry' and g.code = 'X' and cs.name = 'A' and s.code = any(${SHEET_SUBJECTS})`;
  const sheets = [];
  for (const paper of papers) {
    const students = await ctx.sql<{ student_id: string }[]>`
      select student_id from public.enrolments where class_section_id = ${paper.section_id} and status = 'active' order by student_id`;
    for (const [i, s] of students.entries()) {
      sheets.push({
        id: uuidV5("exam-extras", `sheet:${paper.id}:${s.student_id}`),
        institution_id: inst,
        exam_paper_id: paper.id,
        student_id: s.student_id,
        storage_path: `${inst}/answer-sheets/${paper.id}/${s.student_id}.pdf`,
        uploaded_by: users["teacher.x-a"]!,
        created_at: isoAt(-3, 5, 20 + Math.floor(i / 3)),
      });
    }
  }
  await insertOnce(ctx.admin, "answer_sheets", sheets);

  const results = await ctx.sql<{ id: string; grade: string; teacher_email: string }[]>`
    select r.id, r.grade, u.email as teacher_email
    from public.results r
    join public.exams e on e.id = r.exam_id and e.status = 'published'
    join public.enrolments en on en.student_id = r.student_id and en.status = 'active'
    join public.class_sections cs on cs.id = en.class_section_id
    join public.memberships m on m.staff_id = cs.class_teacher_id and m.role = 'teacher' and m.institution_id = r.institution_id
    join auth.users u on u.id = m.user_id
    where r.institution_id = ${inst} and r.superseded_by is null and u.email like '%@demo.coolskool.test'
    order by r.id`;
  const remarks = results.map((r, i) => ({
    id: uuidV5("exam-extras", `remark:${r.id}`),
    institution_id: inst,
    result_id: r.id,
    remark: remarkFor(r.grade, i),
    created_by: users[r.teacher_email.split("@")[0]!]!,
    created_at: isoAt(-12, 6, i % 50),
  }));
  await insertOnce(ctx.admin, "result_remarks", remarks);
}
