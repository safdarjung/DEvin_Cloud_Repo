import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";
import { demoUsers, insertOnce, isoAt, sectionRng } from "../lib/util.ts";

// Needs the question-bank section (registered before this one): every practice question, saved
// note and chat below is built from a real bank question, so stems, options and answers are
// consistent. Practice attempts: the three demo class teachers' sections (VI-A, VIII-B, X-A)
// plus student.one. Study items and preferences: student.one, the only student login.

interface BankQ {
  id: string;
  subject_id: string;
  subject_code: string;
  subject_name: string;
  grade_code: string;
  unit_id: string;
  unit_title: string;
  type: string;
  difficulty: "easy" | "medium" | "hard";
  body: string;
  options: string[] | null;
  answer: string;
}

const between = (rng: () => number, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

function shuffled<T>(rng: () => number, items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export async function run(ctx: SeedContext): Promise<void> {
  const inst = ctx.institutionId;
  const rng = sectionRng("student-study");
  const users = await demoUsers(ctx.sql, inst);

  const bank = await ctx.sql<BankQ[]>`
    select q.id, q.subject_id, s.code as subject_code, s.name as subject_name, g.code as grade_code,
           q.curriculum_unit_id as unit_id, cu.title as unit_title, q.type, q.difficulty, q.body, q.options, q.answer
    from public.question_bank q
    join public.subjects s on s.id = q.subject_id
    join public.grades g on g.id = q.grade_id
    join public.curriculum_units cu on cu.id = q.curriculum_unit_id
    where q.institution_id = ${inst} order by q.id`;
  if (bank.length === 0) {
    console.warn("  student-study: question_bank is empty; run the question-bank section first. Skipped.");
    return;
  }

  // ---------------- practice_attempts ----------------
  const mcqs = bank.filter((q) => q.type === "mcq" && q.options?.length === 4 && q.options.includes(q.answer));
  const byGroup = new Map<string, BankQ[]>();
  for (const q of mcqs) {
    const key = `${q.grade_code}:${q.subject_id}:${q.unit_id}`;
    byGroup.set(key, [...(byGroup.get(key) ?? []), q]);
  }
  const groupsByGrade = new Map<string, string[]>();
  for (const key of [...byGroup.keys()].sort()) {
    if (byGroup.get(key)!.length < 3) continue;
    const grade = key.split(":")[0]!;
    groupsByGrade.set(grade, [...(groupsByGrade.get(grade) ?? []), key]);
  }

  const learners = await ctx.sql<{ student_id: string; grade_code: string; is_login: boolean }[]>`
    select e.student_id, g.code as grade_code, e.student_id = ${ctx.linkIdByLogin["student.one"]!}::uuid as is_login
    from public.enrolments e
    join public.class_sections cs on cs.id = e.class_section_id
    join public.grades g on g.id = cs.grade_id
    where e.institution_id = ${inst} and e.status = 'active'
      and (g.code || '-' || cs.name in ('VI-A', 'VIII-B', 'X-A'))
    order by e.student_id`;

  const attempts = [];
  for (const [li, learner] of learners.entries()) {
    const groups = groupsByGrade.get(learner.grade_code);
    if (!groups?.length) continue;
    const ability = 0.4 + rng() * 0.5;
    const count = learner.is_login ? 32 : between(rng, 3, 6);
    for (let a = 0; a < count; a++) {
      const group = byGroup.get(groups[(li + a) % groups.length]!)!;
      const picked = shuffled(rng, group).slice(0, Math.min(group.length, between(rng, 3, 8)));
      const questions = picked.map((q) => {
        const options = shuffled(rng, q.options!);
        return { stem: q.body, options, answerIndex: options.indexOf(q.answer) };
      });
      const answers = questions.map((q) => (rng() < 0.04 ? null : rng() < ability ? q.answerIndex : (q.answerIndex + between(rng, 1, 3)) % 4));
      const score = answers.filter((x, i) => x === questions[i]!.answerIndex).length;
      const first = picked[0]!;
      const day = -between(rng, 1, 30);
      attempts.push({
        id: uuidV5("student-study", `attempt:${learner.student_id}:${a}`),
        institution_id: inst,
        student_id: learner.student_id,
        curriculum_unit_id: first.unit_id,
        subject_id: first.subject_id,
        difficulty: first.difficulty,
        questions,
        answers,
        score,
        max_score: questions.length,
        created_at: isoAt(day, 6 + (a % 10), (li * 7 + a * 11) % 60),
      });
    }
  }
  await insertOnce(ctx.admin, "practice_attempts", attempts, 200);

  // ---------------- study_items and study_preferences (student.one) ----------------
  const userId = users["student.one"]!;
  const source = bank.filter((q) => ["VI", "VII", "VIII", "IX", "X"].includes(q.grade_code));
  const bySubjectUnit = new Map<string, BankQ[]>();
  for (const q of source) bySubjectUnit.set(`${q.subject_id}:${q.unit_id}`, [...(bySubjectUnit.get(`${q.subject_id}:${q.unit_id}`) ?? []), q]);

  const items = [];
  const groupKeys = [...bySubjectUnit.keys()].sort();
  let n = 0;
  for (const key of groupKeys) {
    const qs = bySubjectUnit.get(key)!;
    const head = qs[0]!;
    // flashcard sets of 3 and key-point notes of 3, until the folder is used up
    for (let i = 0; i + 3 <= qs.length && n < 80; i += 3, n++) {
      const set = qs.slice(i, i + 3);
      items.push({
        id: uuidV5("student-study", `item:cards:${key}:${i}`),
        kind: "note",
        title: `${head.subject_name}: ${head.unit_title} flashcards ${i / 3 + 1}`.slice(0, 120),
        folder: head.subject_name,
        pinned: n % 11 === 0,
        content: { blocks: [{ kind: "flashcards", cards: set.map((q) => ({ front: q.body.slice(0, 200), back: q.answer.slice(0, 300) })) }] },
      });
    }
    for (let i = 0; i + 3 <= qs.length && i < 6; i += 3) {
      const set = qs.slice(i, i + 3);
      items.push({
        id: uuidV5("student-study", `item:notes:${key}:${i}`),
        kind: "note",
        title: `${head.subject_name}: ${head.unit_title} key points ${i / 3 + 1}`.slice(0, 120),
        folder: "Revision",
        pinned: false,
        content: { blocks: [{ kind: "notes", sections: [{ heading: head.unit_title.slice(0, 120), bullets: set.map((q) => `${q.body.slice(0, 140)} -> ${q.answer.slice(0, 140)}`) }] }] },
      });
    }
  }
  for (const [i, q] of source.filter((_, i) => i % 6 === 0).slice(0, 40).entries()) {
    items.push({
      id: uuidV5("student-study", `item:chat:${q.id}`),
      kind: "chat",
      title: `${q.subject_name}: ${q.body}`.slice(0, 60),
      folder: i % 3 === 0 ? q.subject_name : null,
      pinned: false,
      content: {
        messages: [
          { id: `u${i}`, role: "user", parts: [{ type: "text", text: q.body }] },
          { id: `a${i}`, role: "assistant", parts: [{ type: "text", text: `${q.answer}. This comes from ${q.unit_title.toLowerCase()}; try one similar question yourself and check it against your notes.` }] },
        ],
      },
    });
  }
  const itemRows = items.map((it, i) => ({
    ...it,
    institution_id: inst,
    user_id: userId,
    created_at: isoAt(-between(rng, 1, 45), 12 + (i % 8), i % 60),
  }));
  await insertOnce(ctx.admin, "study_items", itemRows, 100);

  await ctx.admin.from("study_preferences").upsert(
    {
      institution_id: inst,
      user_id: userId,
      skills: ["eli5"],
      style: { notesDensity: "standard", notesFormat: "bullets", language: "en" },
    },
    { onConflict: "institution_id,user_id", ignoreDuplicates: true },
  );
}
