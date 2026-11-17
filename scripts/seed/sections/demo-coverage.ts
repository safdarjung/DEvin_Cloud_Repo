import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";
import { asUser, demoUsers, isoDay } from "../lib/util.ts";

// Fills portal/teacher tabs that were empty for the featured demo logins (student.one / guardian.one /
// teacher.vi-a): houses for every student, student leave, class files + student documents, school-owned
// textbooks with searchable text, and a VI Mathematics paper + online test + student questions for teacher.vi-a.
// Insert-if-missing with uuidV5 ids, no rng draws, no updates. Run alone: `pnpm seed --only demo-coverage`.
// Needs core/people/academics/staffing/clubs/learning-exams (question_bank) to have run. Alumni and the
// remaining Ananya rows (achievements, library) come from `node scripts/demo-fill.ts --apply`, not here.

const KEY = "demo-coverage";
const id = (k: string) => uuidV5(KEY, k);
const BUCKET = "tenant-docs";
// shortcut: one tiny valid single-page PDF reused for every file; swap for real handouts if a demo opens them.
const PDF = Buffer.from(
  "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R/Size 4>>\n%%EOF\n",
);

type Sql = SeedContext["sql"];

async function addDocument(ctx: SeedContext, d: { docId: string; entityType: string; entityId: string; kind: string; fileName: string; by: string }): Promise<void> {
  const path = `${ctx.institutionId}/${d.entityType}/${d.entityId}/${d.docId}.pdf`;
  const up = await ctx.admin.storage.from(BUCKET).upload(path, PDF, { contentType: "application/pdf", upsert: true });
  if (up.error) throw new Error(`storage upload ${path}: ${up.error.message}`);
  await ctx.sql`
    insert into public.documents (id, institution_id, entity_type, entity_id, kind, file_name, mime, size_bytes, path, status, created_by)
    values (${d.docId}, ${ctx.institutionId}, ${d.entityType}, ${d.entityId}, ${d.kind}, ${d.fileName}, 'application/pdf', ${PDF.length}, ${path}, 'active', ${d.by})
    on conflict (id) do nothing`;
}

async function houses(ctx: SeedContext): Promise<void> {
  const inst = ctx.institutionId;
  const hs = await ctx.sql<{ id: string }[]>`select id from public.houses where institution_id = ${inst} order by name`;
  if (hs.length === 0) return console.warn("  demo-coverage: no houses (run clubs first); skipped houses.");
  const students = await ctx.sql<{ id: string }[]>`
    select s.id from public.students s where s.institution_id = ${inst} and s.status = 'active'
      and not exists (select 1 from public.house_members h where h.student_id = s.id) order by s.admission_no`;
  const rows = students.map((s, i) => ({ id: uuidV5("clubs", `hm:${s.id}`), institution_id: inst, house_id: hs[i % hs.length]!.id, student_id: s.id }));
  for (let o = 0; o < rows.length; o += 1000) {
    await ctx.sql`insert into public.house_members ${ctx.sql(rows.slice(o, o + 1000), "id", "institution_id", "house_id", "student_id")} on conflict do nothing`;
  }
  console.log(`  demo-coverage: ${rows.length} students added to houses`);
}

async function studentLeave(ctx: SeedContext, users: Record<string, string>): Promise<void> {
  const inst = ctx.institutionId;
  const parent = users["guardian.one"];
  if (!parent) return;
  const kids = await ctx.sql<{ student_id: string; class_section_id: string; first_name: string }[]>`
    select gs.student_id, e.class_section_id, s.first_name from public.guardian_students gs
    join public.memberships m on m.guardian_id = gs.guardian_id and m.user_id = ${parent} and m.institution_id = ${inst}
    join public.students s on s.id = gs.student_id
    join public.enrolments e on e.student_id = gs.student_id and e.status = 'active'
    order by s.first_name`;
  const plan: [string, number, number, string, string, string | null][] = [
    ["Ananya", -10, -9, "Fever and doctor's advice to rest.", "approved", "Get well soon."],
    ["Ananya", 5, 6, "Family wedding out of town.", "pending", null],
    ["Ananya", -25, -25, "Dental appointment.", "rejected", "Unit test that day; please reschedule."],
    // Aarav's pending leave comes from the homeroom section (tests/db/seed-homeroom.test.ts expects exactly one).
  ];
  const decider = users["principal"] ?? parent;
  for (const [name, from, to, reason, status, note] of plan) {
    const kid = kids.find((k) => k.first_name === name);
    if (!kid) continue;
    const decided = status !== "pending";
    await ctx.sql`
      insert into public.student_leave_requests (id, institution_id, student_id, class_section_id, start_date, end_date, reason, status, created_by, decided_by, decided_at, decision_note)
      values (${id(`leave:${name}:${from}`)}, ${inst}, ${kid.student_id}, ${kid.class_section_id}, ${isoDay(from)}, ${isoDay(to)}, ${reason}, ${status}, ${parent},
        ${decided ? decider : null}, ${decided ? new Date(Date.parse(isoDay(from)) - 86_400_000).toISOString() : null}, ${decided ? note : null})
      on conflict (id) do nothing`;
  }
}

/** Class files (grade X + VI Maths) and Ananya's student documents. */
async function files(ctx: SeedContext, users: Record<string, string>): Promise<void> {
  const inst = ctx.institutionId;
  const rows = await ctx.sql<{ grade_id: string; gcode: string; subject_id: string; scode: string; sname: string }[]>`
    select g.id as grade_id, g.code as gcode, s.id as subject_id, s.code as scode, s.name as sname
    from public.grades g cross join public.subjects s
    where g.institution_id = ${inst} and s.institution_id = ${inst}
      and ((g.code = 'X' and s.code in ('MATH', 'SCI', 'ENG')) or (g.code = 'VI' and s.code in ('MATH', 'SCI', 'ENG')))`;
  for (const r of rows) {
    const author = r.gcode === "X" ? users["teacher.x-a"] : users["teacher.vi-a"];
    if (!author) continue;
    const materialId = id(`material:${r.gcode}:${r.scode}`);
    await ctx.sql`
      insert into public.curriculum_materials (id, institution_id, title, grade_id, subject_id, owner_kind, visibility, created_by)
      values (${materialId}, ${inst}, ${`${r.sname} revision notes (Grade ${r.gcode})`}, ${r.grade_id}, ${r.subject_id}, 'staff', 'class', ${author})
      on conflict (id) do nothing`;
    await addDocument(ctx, { docId: id(`material-doc:${r.gcode}:${r.scode}`), entityType: "curriculum_material", entityId: materialId, kind: "curriculum", fileName: `${r.sname}-revision-notes.pdf`, by: author });
  }
  const ananya = ctx.linkIdByLogin["student.one"];
  const admin = users["admin"] ?? users["principal"];
  if (ananya && admin) {
    for (const [k, name] of [["birth-certificate", "Birth certificate.pdf"], ["transfer-certificate", "Previous school transfer certificate.pdf"], ["address-proof", "Address proof.pdf"]] as const) {
      await addDocument(ctx, { docId: id(`student-doc:${k}`), entityType: "student", entityId: ananya, kind: k, fileName: name, by: admin });
    }
  }
}

const CHUNKS: Record<string, [number, string, string][]> = {
  MATH: [
    [1, "Real numbers", "Euclid's division lemma states that for positive integers a and b there exist unique integers q and r with a = bq + r and 0 <= r < b. It is used to find the HCF of two numbers."],
    [1, "Fundamental theorem of arithmetic", "Every composite number can be expressed as a product of primes, and this factorisation is unique apart from the order of the primes."],
    [2, "Polynomials", "The zeroes of a polynomial p(x) are the values of x where p(x) = 0. A quadratic polynomial has at most two zeroes."],
    [3, "Quadratic equations", "A quadratic equation ax2 + bx + c = 0 can be solved by factorisation or by the quadratic formula. The discriminant b2 - 4ac tells the nature of the roots."],
    [4, "Triangles", "Two triangles are similar if their corresponding angles are equal and their sides are in the same ratio. The Pythagoras theorem relates the sides of a right triangle."],
  ],
  SCI: [
    [1, "Chemical reactions", "A chemical reaction rearranges atoms to form new substances. A balanced chemical equation has the same number of atoms of each element on both sides."],
    [2, "Acids, bases and salts", "Acids turn blue litmus red and bases turn red litmus blue. The pH scale measures how acidic or basic a solution is."],
    [3, "Light", "Light travels in straight lines and is reflected or refracted at boundaries. Photosynthesis uses light energy to make food in green plants."],
  ],
};

/** School-owned textbooks with read text, so /textbooks/search and the portal study search have something to find. */
async function textbooks(ctx: SeedContext, users: Record<string, string>): Promise<void> {
  const inst = ctx.institutionId;
  const by = users["principal"] ?? users["admin"];
  if (!by) return;
  const pairs = await ctx.sql<{ grade_id: string; gcode: string; subject_id: string; scode: string; sname: string }[]>`
    select g.id as grade_id, g.code as gcode, s.id as subject_id, s.code as scode, s.name as sname
    from public.grades g cross join public.subjects s
    where g.institution_id = ${inst} and s.institution_id = ${inst}
      and ((g.code = 'X' and s.code in ('MATH', 'SCI')) or (g.code = 'VI' and s.code = 'MATH'))`;
  for (const p of pairs) {
    const bookId = id(`book:${p.gcode}:${p.scode}`);
    const docId = id(`book-doc:${p.gcode}:${p.scode}`);
    const exId = id(`book-extraction:${p.gcode}:${p.scode}`);
    await ctx.sql`
      insert into public.subject_textbooks (id, institution_id, grade_id, subject_id, custom_title, custom_publisher, position, created_by, rights_status, permitted_use)
      values (${bookId}, ${inst}, ${p.grade_id}, ${p.subject_id}, ${`${p.sname} Class ${p.gcode} (school edition)`}, 'St. Joseph''s Academic Team', 9, ${by}, 'school_owned', 'search and study inside the school')
      on conflict (id) do nothing`;
    await addDocument(ctx, { docId, entityType: "subject_textbook", entityId: bookId, kind: "textbook", fileName: `${p.sname}-class-${p.gcode}.pdf`, by });
    const chunks = CHUNKS[p.scode] ?? [];
    await ctx.sql`
      insert into public.content_extractions (id, institution_id, subject_textbook_id, document_id, status, pages_total, pages_done, started_at, finished_at, created_by)
      values (${exId}, ${inst}, ${bookId}, ${docId}, 'done', ${chunks.length * 2}, ${chunks.length * 2}, now(), now(), ${by})
      on conflict (id) do nothing`;
    for (const [i, [chapter, heading, body]] of chunks.entries()) {
      await ctx.sql`
        insert into public.content_chunks (id, institution_id, extraction_id, subject_textbook_id, chapter_no, page_from, page_to, heading, body)
        values (${id(`chunk:${p.gcode}:${p.scode}:${i}`)}, ${inst}, ${exId}, ${bookId}, ${chapter}, ${i * 2 + 1}, ${i * 2 + 2}, ${heading}, ${body})
        on conflict (id) do nothing`;
    }
  }
}

/** teacher.vi-a teaches VI-A Mathematics: a published paper, a live practice test, and student questions. */
async function viMaths(ctx: SeedContext, users: Record<string, string>): Promise<void> {
  const inst = ctx.institutionId;
  const teacher = users["teacher.vi-a"];
  const controller = users["examcontroller"];
  if (!teacher || !controller) return;
  const [ref] = await ctx.sql<{ gvi: string; math: string; via: string }[]>`
    select (select id from public.grades where institution_id = ${inst} and code = 'VI') gvi,
      (select id from public.subjects where institution_id = ${inst} and code = 'MATH') math,
      (select cs.id from public.class_sections cs join public.grades g on g.id = cs.grade_id
        where cs.institution_id = ${inst} and g.code = 'VI' and cs.name = 'A' and cs.academic_year_id = ${ctx.academicYearId}) via`;
  if (!ref?.via) return;

  const paperId = id("paper:vi-math-ut1");
  const [existing] = await ctx.sql`select 1 from public.question_papers where id = ${paperId}`;
  if (!existing) {
    const qs = await ctx.sql<{ id: string; type: string; body: string; options: unknown; answer: string | null; difficulty: string; curriculum_unit_id: string | null; curriculum_topic_id: string | null }[]>`
      select id, type, body, options, answer, difficulty, curriculum_unit_id, curriculum_topic_id from public.question_bank
      where institution_id = ${inst} and grade_id = ${ref.gvi} and subject_id = ${ref.math} and status = 'approved' and type = 'mcq' and stem_question_id is null
      order by body limit 10`;
    if (qs.length === 0) return console.warn("  demo-coverage: no VI Mathematics bank questions; skipped paper.");
    const sectionId = id("paper:vi-math-ut1:section:A");
    await ctx.sql`
      insert into public.question_papers (id, institution_id, academic_year_id, grade_id, section_id, subject_id, title, exam_type, duration_minutes, total_marks, pass_marks, instructions, created_by)
      values (${paperId}, ${inst}, ${ctx.academicYearId}, ${ref.gvi}, ${ref.via}, ${ref.math}, 'VI Mathematics — Unit Test 1', 'Unit Test', 30, ${qs.length}, ${Math.ceil(qs.length * 0.35)}, 'Answer every question.', ${teacher})
      on conflict (id) do nothing`;
    await ctx.sql`
      insert into public.question_paper_sections (id, institution_id, paper_id, title, position)
      values (${sectionId}, ${inst}, ${paperId}, 'Section A: Multiple choice (1 mark each)', 0) on conflict (id) do nothing`;
    for (const [i, q] of qs.entries()) {
      await ctx.sql`
        insert into public.question_paper_items (id, institution_id, paper_id, section_id, position, source_question_id, type, body, options, answer, marks, difficulty, curriculum_unit_id, curriculum_topic_id)
        values (${id(`paper:vi-math-ut1:item:${q.id}`)}, ${inst}, ${paperId}, ${sectionId}, ${i}, ${q.id}, ${q.type}, ${q.body}, ${q.options === null ? null : ctx.sql.json(q.options as never)}, ${q.answer}, 1, ${q.difficulty}, ${q.curriculum_unit_id}, ${q.curriculum_topic_id})
        on conflict (id) do nothing`;
    }
    await asUser(ctx.sql, teacher, (tx) => tx`select public.transition_question_paper(${paperId}::uuid, 'in_review', 'Ready for the exam office')`);
    await asUser(ctx.sql, controller, async (tx) => {
      await tx`select public.transition_question_paper(${paperId}::uuid, 'approved', 'Checked against the syllabus')`;
      await tx`select public.transition_question_paper(${paperId}::uuid, 'published', 'Published for the class test')`;
    });
  }

  const testId = id("test:vi-math-practice");
  const [hasTest] = await ctx.sql`select 1 from public.online_tests where id = ${testId}`;
  const [paper] = await ctx.sql<{ current_version: number; status: string }[]>`select current_version, status from public.question_papers where id = ${paperId}`;
  if (!hasTest && paper?.status === "published") {
    const hour = 3_600_000;
    await ctx.sql`
      insert into public.online_tests (id, institution_id, question_paper_id, paper_version_no, grade_id, subject_id, title, section_ids, opens_at, closes_at, duration_minutes, max_attempts, shuffle, show_results, show_answers, practice, created_by)
      values (${testId}, ${inst}, ${paperId}, ${paper.current_version}, ${ref.gvi}, ${ref.math}, 'VI Mathematics — Unit Test 1 revision (practice)', ${[ref.via]},
        ${new Date(Date.now() - hour).toISOString()}, ${new Date(Date.now() + 30 * 24 * hour).toISOString()}, 30, 3, true, 'after_close', 'after_close', true, ${teacher})
      on conflict (id) do nothing`;
    await asUser(ctx.sql, teacher, (tx) => tx`select public.transition_online_test(${testId}::uuid, 'scheduled')`);
  }

  // Student questions: VI-A pupils ask through a parent login (the pupils have none); one answered.
  const asker = users["guardian.one"] ?? controller;
  const kids = await ctx.sql<{ student_id: string }[]>`
    select student_id from public.enrolments where class_section_id = ${ref.via} and status = 'active' order by roll_no limit 3`;
  const QA: [string, string | null][] = [
    ["Why do we carry the 1 when adding big numbers?", null],
    ["How do I know whether to use HCF or LCM in a word problem?", null],
    ["Is zero a natural number?", "Natural numbers start from 1. Zero is a whole number, so 0 is not a natural number."],
  ];
  for (const [i, [question, answer]] of QA.entries()) {
    const kid = kids[i];
    if (!kid) continue;
    await ctx.sql`
      insert into public.study_questions (id, institution_id, student_id, class_section_id, subject_id, asked_by, context_kind, question, answer, answered_by, answered_at, created_at)
      values (${id(`question:vi-math:${i}`)}, ${inst}, ${kid.student_id}, ${ref.via}, ${ref.math}, ${asker}, 'general', ${question},
        ${answer}, ${answer ? teacher : null}, ${answer ? new Date(Date.now() - 3_600_000).toISOString() : null}, ${new Date(Date.now() - (i + 1) * 7_200_000).toISOString()})
      on conflict (id) do nothing`;
  }
}

export async function run(ctx: SeedContext): Promise<void> {
  const users = await demoUsers(ctx.sql, ctx.institutionId);
  await houses(ctx);
  await studentLeave(ctx, users);
  await files(ctx, users);
  await textbooks(ctx, users);
  await viMaths(ctx, users);
  console.log("  demo-coverage: done");
}

export type { Sql };
