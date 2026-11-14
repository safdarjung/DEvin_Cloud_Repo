import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";
import { asUser, demoUsers, insertOnce } from "../lib/util.ts";

// Demo data for migrations 0146-0151 on X-A Mathematics and VI-A Science: curriculum topics,
// every question type, an AI review queue, a collection, two papers + a template, a finished
// online test (results published), a live practice test, and bank practice sessions for student.one.
// Everything that has a function goes through it (transition_question_paper, start_test_attempt,
// save_test_response, submit_test_attempt, transition_online_test, save_test_marks,
// finalise_test_attempt, start_bank_practice, submit_practice_session), as the owning user.
// Only the 9 classmates without a login have their attempts inserted directly (a login is needed
// to call start_test_attempt) and are then scored by the same app.finish_test_attempt.
// No rng draws. Each part skips once its marker row exists, because the transitions are one-way.

const KEY = "learning-exams";
const id = (inst: string, k: string) => uuidV5(KEY, `${inst}:${k}`);

// `${grade}:${subject}:${unit sequence}` -> topic titles (CBSE-style chapters).
const TOPICS: Record<string, string[]> = {
  "X:MATH:1": ["Euclid's division lemma", "Fundamental theorem of arithmetic", "HCF and LCM"],
  "X:MATH:2": ["Linear equations in two variables", "Arithmetic progressions", "Polynomials and their zeroes"],
  "X:MATH:3": ["Solving by factorisation", "Quadratic formula", "Nature of roots"],
  "X:MATH:4": ["Similar triangles", "Pythagoras theorem", "Surface areas and volumes"],
  "VI:SCI:1": ["Fibre to fabric", "Sorting materials into groups", "Separation of substances"],
  "VI:SCI:2": ["Food: where does it come from", "Components of food", "Body movements"],
  "VI:SCI:3": ["Motion and measurement of distances", "Light, shadows and reflections", "Electricity and circuits"],
  "VI:SCI:4": ["Water", "Air around us", "Garbage in, garbage out"],
};

// Keyword -> topic for the generated X Mathematics questions; anything unmatched stays untagged.
const X_MATH_RULES: [number, RegExp, string][] = [
  [2, /Solve for x/, "Linear equations in two variables"],
  [2, /\bAP\b|common difference/, "Arithmetic progressions"],
  [3, /roots|quadratic/i, "Solving by factorisation"],
  [4, /hypotenuse|right triangle/, "Pythagoras theorem"],
  [4, /area|perimeter|volume/i, "Surface areas and volumes"],
];

interface NewQ {
  k: string;
  unit: number;
  topic: string;
  type: string;
  difficulty: "easy" | "medium" | "hard";
  body: string;
  options?: unknown;
  answer?: string;
  key?: unknown;
  marks: number;
  explanation?: string;
}

const APPROVED: NewQ[] = [
  { k: "u1-hcf", unit: 1, topic: "HCF and LCM", type: "mcq", difficulty: "easy", body: "What is the HCF of 12 and 18?", options: ["3", "6", "9", "36"], answer: "6", marks: 1 },
  { k: "u1-lcm", unit: 1, topic: "HCF and LCM", type: "mcq", difficulty: "medium", body: "The LCM of 12 and 18 is:", options: ["6", "36", "72", "216"], answer: "36", marks: 1 },
  { k: "u1-fta", unit: 1, topic: "Fundamental theorem of arithmetic", type: "mcq", difficulty: "medium", body: "Express 84 as a product of primes.", options: ["2 x 2 x 3 x 7", "2 x 3 x 14", "4 x 21", "2 x 6 x 7"], answer: "2 x 2 x 3 x 7", marks: 1 },
  { k: "u1-euclid", unit: 1, topic: "Euclid's division lemma", type: "mcq", difficulty: "easy", body: "By Euclid's division lemma, 17 = 5 x 3 + r. What is r?", options: ["0", "1", "2", "3"], answer: "2", marks: 1 },
  { k: "u1-euclid-num", unit: 1, topic: "Euclid's division lemma", type: "numerical", difficulty: "medium", body: "Find the HCF of 96 and 404 using Euclid's division algorithm.", answer: "4", key: { value: 4, tolerance: 0 }, marks: 2, explanation: "404 = 96 x 4 + 20, 96 = 20 x 4 + 16, 20 = 16 x 1 + 4, 16 = 4 x 4 + 0, so the HCF is 4." },
  { k: "u1-fta-blank", unit: 1, topic: "Fundamental theorem of arithmetic", type: "fill_blank", difficulty: "easy", body: "Every composite number can be written as a product of ___ in a unique way, apart from the order.", answer: "primes", key: ["primes|prime numbers"], marks: 1 },
  { k: "u1-irrational", unit: 1, topic: "Fundamental theorem of arithmetic", type: "multi_select", difficulty: "medium", body: "Which of these are irrational numbers?", options: ["sqrt(2)", "22/7", "sqrt(3)", "0.25"], answer: "sqrt(2); sqrt(3)", key: ["sqrt(2)", "sqrt(3)"], marks: 2 },
  { k: "u1-short", unit: 1, topic: "HCF and LCM", type: "short_answer", difficulty: "medium", body: "Find the HCF and LCM of 26 and 91 using prime factorisation.", answer: "26 = 2 x 13 and 91 = 7 x 13, so HCF = 13 and LCM = 2 x 7 x 13 = 182.", marks: 3 },
  { k: "u2-ap-multi", unit: 2, topic: "Arithmetic progressions", type: "multi_select", difficulty: "medium", body: "Which of these lists are arithmetic progressions?", options: ["2, 5, 8, 11", "1, 4, 9, 16", "7, 7, 7, 7", "3, 6, 12, 24"], answer: "2, 5, 8, 11; 7, 7, 7, 7", key: ["2, 5, 8, 11", "7, 7, 7, 7"], marks: 2 },
  { k: "u2-zeroes-match", unit: 2, topic: "Polynomials and their zeroes", type: "match", difficulty: "medium", body: "Match each polynomial with the number of its zeroes.", options: { left: ["x - 3", "x2 - 4", "x3 - x"], right: ["3 zeroes", "1 zero", "2 zeroes"] }, answer: "x - 3: 1 zero; x2 - 4: 2 zeroes; x3 - x: 3 zeroes", key: [1, 2, 0], marks: 3 },
  { k: "u2-ap-sum", unit: 2, topic: "Arithmetic progressions", type: "numerical", difficulty: "hard", body: "Find the sum of the first 10 terms of the AP 2, 5, 8, ...", answer: "155", key: { value: 155, tolerance: 0 }, marks: 2, explanation: "S10 = 10/2 x (2 x 2 + 9 x 3) = 5 x 31 = 155." },
  { k: "u2-short", unit: 2, topic: "Arithmetic progressions", type: "short_answer", difficulty: "easy", body: "Find the 20th term of the AP 3, 7, 11, ...", answer: "a = 3 and d = 4, so a20 = 3 + 19 x 4 = 79.", marks: 3 },
  { k: "u3-assertion", unit: 3, topic: "Nature of roots", type: "assertion_reason", difficulty: "hard", body: "Read the assertion and the reason, then choose A (both true, and the reason explains the assertion), B (both true, but the reason does not explain it), C (assertion true, reason false) or D (assertion false, reason true).", options: { assertion: "The equation x2 + 4x + 5 = 0 has no real roots.", reason: "Its discriminant is negative." }, answer: "A", marks: 1 },
  { k: "u3-disc-blank", unit: 3, topic: "Nature of roots", type: "fill_blank", difficulty: "easy", body: "The discriminant of ax2 + bx + c = 0 is ___.", answer: "b2 - 4ac", key: ["b2 - 4ac|b^2 - 4ac"], marks: 1 },
  { k: "u3-roots", unit: 3, topic: "Solving by factorisation", type: "mcq", difficulty: "medium", body: "The roots of x2 - 5x + 6 = 0 are:", options: ["2 and 3", "-2 and -3", "1 and 6", "-1 and -6"], answer: "2 and 3", marks: 1 },
  { k: "u4-csa", unit: 4, topic: "Surface areas and volumes", type: "numerical", difficulty: "medium", body: "Find the curved surface area (in cm2) of a cylinder of radius 7 cm and height 10 cm. Use pi = 22/7.", answer: "440", key: { value: 440, tolerance: 0 }, marks: 2, explanation: "CSA = 2 x pi x r x h = 2 x 22/7 x 7 x 10 = 440 cm2." },
  { k: "u4-triples", unit: 4, topic: "Pythagoras theorem", type: "multi_select", difficulty: "medium", body: "Which sets of sides form a right triangle?", options: ["3, 4, 5", "5, 12, 13", "6, 7, 8", "8, 15, 17"], answer: "3, 4, 5; 5, 12, 13; 8, 15, 17", key: ["3, 4, 5", "5, 12, 13", "8, 15, 17"], marks: 2 },
  { k: "u4-short", unit: 4, topic: "Pythagoras theorem", type: "short_answer", difficulty: "medium", body: "The sides of a triangle are 9 cm, 12 cm and 15 cm. Is it a right triangle? Give a reason.", answer: "Yes. 9 squared + 12 squared = 81 + 144 = 225 = 15 squared, so the Pythagoras theorem holds.", marks: 3 },
];

const AI_DRAFTS: NewQ[] = [
  { k: "ai-ap15", unit: 2, topic: "Arithmetic progressions", type: "mcq", difficulty: "medium", body: "What is the 15th term of the AP 4, 9, 14, ...?", options: ["70", "74", "79", "84"], answer: "74", marks: 1, explanation: "a15 = 4 + 14 x 5 = 74." },
  { k: "ai-nature", unit: 3, topic: "Nature of roots", type: "short_answer", difficulty: "medium", body: "Find the nature of the roots of 2x2 - 4x + 3 = 0.", answer: "D = 16 - 24 = -8, which is less than 0, so there are no real roots.", marks: 2 },
  { k: "ai-similar", unit: 4, topic: "Similar triangles", type: "mcq", difficulty: "hard", body: "Two similar triangles have sides in the ratio 2 : 3. What is the ratio of their areas?", options: ["2 : 3", "4 : 9", "9 : 4", "3 : 2"], answer: "4 : 9", marks: 1 },
];

const CASE = {
  k: "u4-case", unit: 4, topic: "Pythagoras theorem", difficulty: "medium" as const, marks: 3,
  body: "A 10 m ladder leans against a vertical wall. The foot of the ladder is 6 m away from the wall.",
  subs: [
    { k: "u4-case-a", type: "mcq", body: "How high up the wall does the ladder reach?", options: ["6 m", "8 m", "10 m", "12 m"], answer: "8 m", marks: 1 },
    { k: "u4-case-b", type: "short_answer", body: "Name the theorem you used to find this height.", answer: "The Pythagoras theorem", marks: 2 },
  ],
};

const LONG = [
  { k: "long-train", unit: 3, topic: "Quadratic formula", body: "A train travels 360 km at a uniform speed. Had the speed been 5 km/h more, it would have taken 1 hour less. Find the original speed of the train.", answer: "360/x - 360/(x + 5) = 1 gives x2 + 5x - 1800 = 0, so (x - 40)(x + 45) = 0 and the speed is 40 km/h.", scheme: "Equation 3 marks, quadratic 2 marks, solving 3 marks, rejecting -45 and the final answer 1 mark." },
  { k: "long-bpt", unit: 4, topic: "Similar triangles", body: "State and prove the Basic Proportionality Theorem.", answer: "If a line is drawn parallel to one side of a triangle to meet the other two sides in distinct points, it divides those sides in the same ratio. Proof by comparing the areas of triangles ADE, BDE and CDE.", scheme: "Statement 2 marks, figure 1 mark, construction 1 mark, proof 5 marks." },
  { k: "long-ap", unit: 2, topic: "Arithmetic progressions", body: "The sum of the first n terms of an AP is 3n2 + 5n. Find the AP and its 20th term.", answer: "S1 = 8 so a = 8; S2 = 22 so a2 = 14 and d = 6; a20 = 8 + 19 x 6 = 122.", scheme: "First term 2 marks, common difference 3 marks, the AP 1 mark, 20th term 3 marks." },
];

const BLUEPRINT = {
  sections: [
    { title: "Section A", rows: [{ type: "mcq", count: 10, marks: 1 }] },
    { title: "Section B", rows: [{ type: "short_answer", count: 4, marks: 3 }] },
    { title: "Section C", chooseCount: 2, rows: [{ type: "long_answer", count: 3, marks: 9 }] },
  ],
};

// Per student ability (index 0 is student.one) so the class has a spread of results.
const ABILITY = [0.8, 0.9, 0.35, 0.55, 0.7, 0.45, 0.62, 0.95, 0.5, 0.75];
const solvesItem = (si: number, j: number) => ((si * 37 + j * 53 + 11) % 100) / 100 < ABILITY[si]!;
const half = (n: number) => Math.round(n * 2) / 2;

interface PaperItem {
  key: string;
  section: number;
  type: string;
  body: string;
  options: unknown;
  answer: string | null;
  marks: number;
  source: string | null;
  unit: string | null;
  topic: string | null;
  difficulty: string;
  explanation: string | null;
  scheme: string | null;
  answerKey: unknown;
}

interface Frozen {
  id: string;
  type: string;
  answer: string | null;
  options: unknown;
  marks: string;
}

const JSON_COLS = new Set(["blueprint", "options", "answer_key"]);
/** Insert-if-missing through the owner connection: the paper/test guards call app.current_user_id(), which the service-role API cannot execute. */
async function insertDirect(ctx: SeedContext, table: string, rows: Record<string, unknown>[]): Promise<void> {
  for (const row of rows) {
    const cols = Object.keys(row);
    const values = cols.map((c) => (JSON_COLS.has(c) && row[c] !== null ? ctx.sql.json(row[c] as never) : row[c]));
    await ctx.sql.unsafe(
      `insert into public.${table} (${cols.map((c) => `"${c}"`).join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) on conflict (id) do nothing`,
      values as never[],
    );
  }
}

export async function run(ctx: SeedContext): Promise<void> {
  const inst = ctx.institutionId;
  const users = await demoUsers(ctx.sql, inst);
  const teacher = users["teacher.x-a"]!;
  const controller = users["examcontroller"]!;
  const student = users["student.one"]!;
  const studentId = ctx.linkIdByLogin["student.one"]!;

  const [ref] = await ctx.sql<{ gx: string; gvi: string; math: string; sci: string; xa: string; via: string }[]>`
    select (select id from public.grades where institution_id = ${inst} and code = 'X') gx,
      (select id from public.grades where institution_id = ${inst} and code = 'VI') gvi,
      (select id from public.subjects where institution_id = ${inst} and code = 'MATH') math,
      (select id from public.subjects where institution_id = ${inst} and code = 'SCI') sci,
      (select cs.id from public.class_sections cs join public.grades g on g.id = cs.grade_id
        where cs.institution_id = ${inst} and g.code = 'X' and cs.name = 'A' and cs.academic_year_id = ${ctx.academicYearId}) xa,
      (select cs.id from public.class_sections cs join public.grades g on g.id = cs.grade_id
        where cs.institution_id = ${inst} and g.code = 'VI' and cs.name = 'A' and cs.academic_year_id = ${ctx.academicYearId}) via`;
  if (!ref?.xa || !ref.via) return; // demo tenant without X-A / VI-A: nothing to attach to

  // ---- curriculum_topics + topic links on the generated questions ----
  const units = await ctx.sql<{ id: string; key: string }[]>`
    select cu.id, g.code || ':' || s.code || ':' || cu.sequence as key from public.curriculum_units cu
    join public.grades g on g.id = cu.grade_id join public.subjects s on s.id = cu.subject_id
    where cu.institution_id = ${inst}`;
  const unitByKey = new Map(units.map((u) => [u.key, u.id]));
  const topicRows = Object.entries(TOPICS).flatMap(([key, titles]) => {
    const unit = unitByKey.get(key);
    return unit ? titles.map((title, i) => ({ id: id(inst, `topic:${key}:${title}`), institution_id: inst, curriculum_unit_id: unit, title, sequence: i + 1 })) : [];
  });
  await insertOnce(ctx.admin, "curriculum_topics", topicRows);
  const topicId = (unitKey: string, title: string) => id(inst, `topic:${unitKey}:${title}`);

  const untagged = await ctx.sql<{ id: string; body: string; seq: number; grade: string; subj: string }[]>`
    select q.id, q.body, cu.sequence as seq, g.code as grade, s.code as subj from public.question_bank q
    join public.curriculum_units cu on cu.id = q.curriculum_unit_id
    join public.grades g on g.id = q.grade_id join public.subjects s on s.id = q.subject_id
    where q.institution_id = ${inst} and q.curriculum_topic_id is null and q.status = 'approved' and q.stem_question_id is null
      and ((g.code = 'X' and s.code = 'MATH') or (g.code = 'VI' and s.code = 'SCI'))
    order by cu.sequence, q.body`;
  const seen = new Map<number, number>();
  for (const q of untagged) {
    let title: string | undefined;
    if (q.subj === "MATH") {
      title = X_MATH_RULES.find(([seq, re]) => seq === q.seq && re.test(q.body))?.[2];
    } else {
      const n = seen.get(q.seq) ?? 0;
      seen.set(q.seq, n + 1);
      title = TOPICS[`VI:SCI:${q.seq}`]?.[n % 3];
    }
    if (title) await ctx.sql`update public.question_bank set curriculum_topic_id = ${topicId(`${q.grade}:${q.subj}:${q.seq}`, title)} where id = ${q.id}`;
  }

  // ---- question bank: every new type, AI review queue ----
  const bankRow = (q: NewQ, extra: Record<string, unknown> = {}) => ({
    id: id(inst, `q:${q.k}`),
    institution_id: inst,
    subject_id: ref.math,
    grade_id: ref.gx,
    curriculum_unit_id: unitByKey.get(`X:MATH:${q.unit}`)!,
    curriculum_topic_id: topicId(`X:MATH:${q.unit}`, q.topic),
    type: q.type,
    difficulty: q.difficulty,
    body: q.body,
    options: q.options ?? null,
    answer: q.answer ?? "See the sub-questions.",
    answer_key: q.key ?? null,
    marks: q.marks,
    explanation: q.explanation ?? null,
    created_by: teacher,
    status: "approved",
    origin: "manual",
    ai_model: null,
    stem_question_id: null,
    ...extra,
  });
  await insertOnce(ctx.admin, "question_bank", [
    ...APPROVED.map((q) => bankRow(q)),
    ...AI_DRAFTS.map((q) => bankRow(q, { status: "in_review", origin: "ai", ai_model: "gemini-2.5-flash" })),
    bankRow({ ...CASE, type: "case_based" }),
  ]);
  await insertOnce(ctx.admin, "question_bank", CASE.subs.map((s) =>
    bankRow({ ...CASE, ...s }, { stem_question_id: id(inst, `q:${CASE.k}`) })));

  // ---- collection ----
  const collectionId = id(inst, "collection:board-revision");
  await insertOnce(ctx.admin, "question_collections", [{
    id: collectionId, institution_id: inst, owner_id: controller, name: "Board revision set",
    description: "Class X Mathematics questions to revise before the board exam, across all four chapters.", visibility: "school",
  }]);
  await ctx.sql`
    insert into public.question_collection_items (collection_id, question_id, institution_id, position, added_by)
    select ${collectionId}::uuid, q, ${inst}::uuid, n::int - 1, ${controller}::uuid
    from unnest(${APPROVED.slice(0, 14).map((q) => id(inst, `q:${q.k}`))}::uuid[]) with ordinality as t(q, n)
    on conflict do nothing`;

  // ---- template + papers ----
  const templateId = id(inst, "template:unit-test");
  await insertDirect(ctx, "question_paper_templates", [{
    id: templateId, institution_id: inst, name: "Unit test, 40 marks (MCQ, short, long)", grade_id: ref.gx, subject_id: ref.math,
    exam_type: "Unit Test", duration_minutes: 60,
    instructions: "All questions are compulsory in Sections A and B. In Section C attempt any two of the three questions.",
    blueprint: BLUEPRINT, created_by: controller,
  }]);

  const paperId = id(inst, "paper:x-math-ut2");
  const [existingPaper] = await ctx.sql`select 1 from public.question_papers where id = ${paperId}`;
  if (!existingPaper) {
    // Link to the Grade X Periodic Test 2 marks-entry paper only while nobody has entered marks on it.
    const [link] = await ctx.sql<{ exam_id: string; exam_paper_id: string }[]>`
      select e.id as exam_id, ep.id as exam_paper_id from public.exam_papers ep join public.exams e on e.id = ep.exam_id
      where e.institution_id = ${inst} and e.name = 'Periodic Test 2 (Grade X)' and ep.class_section_id = ${ref.xa}
        and ep.subject_id = ${ref.math} and ep.max_marks = 40 and ep.pass_marks = 13
        and not exists (select 1 from public.marks m where m.exam_paper_id = ep.id)`;
    await insertDirect(ctx, "question_papers", [{
      id: paperId, institution_id: inst, academic_year_id: ctx.academicYearId, grade_id: ref.gx, section_id: ref.xa, subject_id: ref.math,
      exam_id: link?.exam_id ?? null, exam_paper_id: link?.exam_paper_id ?? null, template_id: templateId,
      title: "X Mathematics — Unit Test 2", exam_type: "Unit Test", duration_minutes: 60, total_marks: 40, pass_marks: 13,
      instructions: "All questions are compulsory in Sections A and B. In Section C attempt any two of the three questions.",
      blueprint: BLUEPRINT, created_by: teacher,
    }]);
    const sectionIds = ["A", "B", "C"].map((s) => id(inst, `paper:x-math-ut2:section:${s}`));
    await insertDirect(ctx, "question_paper_sections", [
      { id: sectionIds[0], institution_id: inst, paper_id: paperId, title: "Section A: Multiple choice (1 mark each)", position: 0, choose_count: null },
      { id: sectionIds[1], institution_id: inst, paper_id: paperId, title: "Section B: Short answer (3 marks each)", position: 1, choose_count: null },
      { id: sectionIds[2], institution_id: inst, paper_id: paperId, title: "Section C: Long answer (attempt any 2, 9 marks each)", position: 2, choose_count: 2 },
    ]);

    type BankPick = { id: string; type: string; body: string; options: unknown; answer: string | null; answer_key: unknown; difficulty: string; curriculum_unit_id: string; curriculum_topic_id: string | null; explanation: string | null };
    const bank = (seq: number, type: string, n: number) => ctx.sql<BankPick[]>`
      select q.id, q.type, q.body, q.options, q.answer, q.answer_key, q.difficulty, q.curriculum_unit_id, q.curriculum_topic_id, q.explanation
      from public.question_bank q join public.curriculum_units cu on cu.id = q.curriculum_unit_id
      where q.institution_id = ${inst} and q.grade_id = ${ref.gx} and q.subject_id = ${ref.math} and cu.sequence = ${seq}
        and q.type = ${type} and q.status = 'approved' and q.stem_question_id is null
      order by q.body limit ${n}`;
    const fromBank = (rows: BankPick[], section: number, marks: number): PaperItem[] => rows.map((q) => ({
      key: id(inst, `paper:x-math-ut2:item:${q.id}`), section, type: q.type, body: q.body, options: q.options, answer: q.answer,
      marks, source: q.id, unit: q.curriculum_unit_id, topic: q.curriculum_topic_id, difficulty: q.difficulty,
      explanation: q.explanation, scheme: null, answerKey: q.answer_key,
    }));
    const items: PaperItem[] = [
      ...fromBank([...(await bank(1, "mcq", 2)), ...(await bank(2, "mcq", 3)), ...(await bank(3, "mcq", 3)), ...(await bank(4, "mcq", 2))], 0, 1),
      ...fromBank([...(await bank(1, "short_answer", 1)), ...(await bank(2, "short_answer", 1)), ...(await bank(3, "short_answer", 1)), ...(await bank(4, "short_answer", 1))], 1, 3),
      ...LONG.map((l): PaperItem => ({
        key: id(inst, `paper:x-math-ut2:item:${l.k}`), section: 2, type: "long_answer", body: l.body, options: null, answer: l.answer, marks: 9,
        source: null, unit: unitByKey.get(`X:MATH:${l.unit}`)!, topic: topicId(`X:MATH:${l.unit}`, l.topic), difficulty: "hard",
        explanation: null, scheme: l.scheme, answerKey: null,
      })),
    ];
    await insertDirect(ctx, "question_paper_items", items.map((it, i) => ({
      id: it.key, institution_id: inst, paper_id: paperId, section_id: sectionIds[it.section]!, position: i, source_question_id: it.source,
      type: it.type, body: it.body, options: it.options, answer: it.answer, answer_key: it.answerKey, marks: it.marks,
      explanation: it.explanation, marking_scheme: it.scheme, difficulty: it.difficulty, curriculum_unit_id: it.unit, curriculum_topic_id: it.topic,
    })));

    await asUser(ctx.sql, teacher, (tx) => tx`select public.transition_question_paper(${paperId}::uuid, 'in_review', 'Ready for the exam office')`);
    await asUser(ctx.sql, controller, async (tx) => {
      await tx`select public.transition_question_paper(${paperId}::uuid, 'approved', 'Checked against the blueprint')`;
      await tx`select public.transition_question_paper(${paperId}::uuid, 'published', 'Published for the class test')`;
    });

    // A VI-A Science draft (the template above is the third paper entity).
    const draftId = id(inst, "paper:vi-sci-draft");
    const sci = await ctx.sql<BankPick[]>`
      select q.id, q.type, q.body, q.options, q.answer, q.difficulty, q.curriculum_unit_id, q.curriculum_topic_id from public.question_bank q
      where q.institution_id = ${inst} and q.grade_id = ${ref.gvi} and q.subject_id = ${ref.sci} and q.status = 'approved'
        and q.type in ('mcq', 'true_false') order by q.body limit 4`;
    await insertDirect(ctx, "question_papers", [{
      id: draftId, institution_id: inst, academic_year_id: ctx.academicYearId, grade_id: ref.gvi, section_id: ref.via, subject_id: ref.sci,
      title: "VI Science — Chapter Quiz (draft)", exam_type: "Quiz", duration_minutes: 20, total_marks: 10, pass_marks: 4,
      instructions: "Answer every question.", created_by: controller,
    }]);
    const draftSection = id(inst, "paper:vi-sci-draft:section:A");
    await insertDirect(ctx, "question_paper_sections", [{ id: draftSection, institution_id: inst, paper_id: draftId, title: "Section A", position: 0 }]);
    await insertDirect(ctx, "question_paper_items", sci.map((q, i) => ({
      id: id(inst, `paper:vi-sci-draft:item:${q.id}`), institution_id: inst, paper_id: draftId, section_id: draftSection, position: i, source_question_id: q.id,
      type: q.type, body: q.body, options: q.options, answer: q.answer, marks: 1, difficulty: q.difficulty,
      curriculum_unit_id: q.curriculum_unit_id, curriculum_topic_id: q.curriculum_topic_id,
    })));
  }

  // ---- online tests ----
  const [paper] = await ctx.sql<{ current_version: number }[]>`select current_version from public.question_papers where id = ${paperId}`;
  const version = paper!.current_version;
  const closedId = id(inst, "test:x-math-ut2");
  const practiceId = id(inst, "test:x-math-practice");
  const [existingTest] = await ctx.sql`select 1 from public.online_tests where id = ${closedId}`;
  let seededTests = false;
  if (!existingTest) {
    seededTests = true;
    const [{ snapshot }] = await ctx.sql<{ snapshot: { sections: { items: Frozen[] }[] } }[]>`
      select snapshot from public.question_paper_versions where paper_id = ${paperId} and version_no = ${version}`;
    const frozenItems = snapshot.sections.flatMap((s) => s.items);
    const hour = 3_600_000;
    // Window open at seed time so the real start/save/submit functions accept the attempts; closed below.
    await insertDirect(ctx, "online_tests", [{
      id: closedId, institution_id: inst, question_paper_id: paperId, paper_version_no: version, grade_id: ref.gx, subject_id: ref.math,
      title: "X Mathematics — Unit Test 2 (online)", section_ids: [ref.xa],
      opens_at: new Date(Date.now() - 3 * hour).toISOString(), closes_at: new Date(Date.now() + 3 * hour).toISOString(),
      duration_minutes: 60, max_attempts: 1, shuffle: false, show_results: "after_publish", show_answers: "after_publish", practice: false,
      created_by: teacher,
    }]);
    await asUser(ctx.sql, teacher, (tx) => tx`select public.transition_online_test(${closedId}::uuid, 'scheduled')`);

    // X-A classmates: student.one first, then the next nine by roll number.
    const mates = await ctx.sql<{ student_id: string }[]>`
      select e.student_id from public.enrolments e where e.class_section_id = ${ref.xa} and e.status = 'active' and e.student_id <> ${studentId}
      order by e.roll_no, e.student_id limit 9`;
    const roster = [studentId, ...mates.map((m) => m.student_id)];
    const written = new Set(frozenItems.filter((i) => i.type === "short_answer" || i.type === "long_answer").map((i) => i.id));
    // null = left unanswered. Students attempt any two of the three long questions.
    const plan = (si: number) => {
      let longRank = 0;
      return frozenItems.map((it, j) => {
        let answer: unknown = null;
        if (it.type === "mcq") {
          answer = solvesItem(si, j) ? it.answer : ((it.options as string[]).find((o) => o !== it.answer) ?? null);
        } else if (it.type !== "long_answer" || longRank++ < 2) {
          const text = it.answer ?? "";
          answer = ABILITY[si]! >= 0.6 ? text : text.slice(0, Math.ceil(text.length / 2));
        }
        return { it, answer };
      });
    };

    // student.one through the real student functions
    await asUser(ctx.sql, student, async (tx) => {
      const [{ r }] = await tx<{ r: { attemptId: string } }[]>`select public.start_test_attempt(${closedId}::uuid, ${tx.json({ source: "seed" })}::jsonb) as r`;
      for (const { it, answer } of plan(0)) {
        if (answer === null) continue;
        await tx`select public.save_test_response(${r.attemptId}::uuid, ${it.id}::uuid, ${tx.json(answer as never)}::jsonb, false)`;
      }
      await tx`select public.submit_test_attempt(${r.attemptId}::uuid)`;
    });

    // The others have no login: attempt rows go in directly, scoring is the same function.
    for (const [si, sid] of roster.entries()) {
      if (si === 0) continue;
      const attemptId = id(inst, `attempt:${closedId}:${sid}`);
      const startedAt = new Date(Date.now() - (170 - si * 9) * 60_000);
      await ctx.sql`
        insert into public.test_attempts (id, institution_id, test_id, student_id, attempt_no, started_at, deadline)
        values (${attemptId}, ${inst}, ${closedId}, ${sid}, 1, ${startedAt}, ${new Date(startedAt.getTime() + 60 * 60_000)})`;
      await ctx.sql`insert into public.test_events (institution_id, attempt_id, kind, at) values (${inst}, ${attemptId}, 'start', ${startedAt})`;
      for (const { it, answer } of plan(si)) {
        if (answer === null) continue;
        await ctx.sql`
          insert into public.test_responses (institution_id, attempt_id, item_key, answer, saved_at)
          values (${inst}, ${attemptId}, ${it.id}, ${ctx.sql.json(answer as never)}, ${new Date(startedAt.getTime() + 40 * 60_000)})`;
      }
      await ctx.sql`select app.finish_test_attempt(${attemptId}::uuid, false)`;
    }

    await asUser(ctx.sql, controller, (tx) => tx`select public.transition_online_test(${closedId}::uuid, 'closed')`);

    // The teacher marks every written answer, then finalises each attempt; leadership publishes.
    const siByStudent = new Map(roster.map((sid, si) => [sid, si]));
    const answers = await ctx.sql<{ id: string; item_key: string; student_id: string }[]>`
      select r.id, r.item_key, a.student_id from public.test_responses r join public.test_attempts a on a.id = r.attempt_id
      where a.test_id = ${closedId} order by a.student_id, r.item_key`;
    const maxMarks = new Map(frozenItems.map((i) => [i.id, Number(i.marks)]));
    const attempts = await ctx.sql<{ id: string }[]>`select id from public.test_attempts where test_id = ${closedId} order by student_id`;
    await asUser(ctx.sql, teacher, async (tx) => {
      for (const a of answers) {
        if (!written.has(a.item_key)) continue;
        const si = siByStudent.get(a.student_id)!;
        const max = maxMarks.get(a.item_key)!;
        const marks = Math.min(max, half(max * Math.min(1, ABILITY[si]! + ((si % 3) - 1) * 0.1)));
        await tx`select public.save_test_marks(${a.id}::uuid, ${marks}::numeric, ${marks >= max * 0.7 ? "Clear working, well done." : "Show every step; marks were lost for the incomplete working."})`;
      }
      for (const a of attempts) await tx`select public.finalise_test_attempt(${a.id}::uuid)`;
    });
    await asUser(ctx.sql, controller, (tx) => tx`select public.transition_online_test(${closedId}::uuid, 'published')`);

    // A practice test student.one can take now (window open for 30 days).
    await insertDirect(ctx, "online_tests", [{
      id: practiceId, institution_id: inst, question_paper_id: paperId, paper_version_no: version, grade_id: ref.gx, subject_id: ref.math,
      title: "X Mathematics — Unit Test 2 revision (practice)", section_ids: [ref.xa],
      opens_at: new Date(Date.now() - hour).toISOString(), closes_at: new Date(Date.now() + 30 * 24 * hour).toISOString(),
      duration_minutes: 45, max_attempts: 3, shuffle: true, show_results: "after_close", show_answers: "after_close", practice: true,
      created_by: teacher,
    }]);
    await asUser(ctx.sql, teacher, (tx) => tx`select public.transition_online_test(${practiceId}::uuid, 'scheduled')`);
  }

  // ---- bank practice sessions for student.one (weak spots: nature of roots, every 5th answer) ----
  const [existingPractice] = await ctx.sql`select 1 from public.practice_sessions where student_id = ${studentId} and source = 'bank'`;
  if (!existingPractice) {
    const PLAN: [number, string | null, number][] = [
      [1, "HCF and LCM", 5], [2, null, 6], [3, null, 6], [3, "Nature of roots", 3], [4, null, 6],
    ];
    const weak = topicId("X:MATH:3", "Nature of roots");
    for (const [seq, topic, count] of PLAN) {
      const unit = unitByKey.get(`X:MATH:${seq}`)!;
      const topicArg = topic ? topicId(`X:MATH:${seq}`, topic) : null;
      const sessionId = await asUser(ctx.sql, student, async (tx) => {
        const [{ r }] = await tx<{ r: { sessionId: string } }[]>`select public.start_bank_practice(${inst}::uuid, ${unit}::uuid, ${topicArg}::uuid, null, ${count}::int) as r`;
        return r.sessionId;
      });
      const [{ items }] = await ctx.sql<{ items: { type: string; options: string[] | null; answer: string | null; answer_key: unknown; topic: string | null }[] }[]>`
        select items from public.practice_sessions where id = ${sessionId}`;
      const answers = items.map((it, i) => {
        if (it.topic === weak || i % 5 === 4) {
          return it.type === "mcq" ? (it.options!.find((o) => o !== it.answer) ?? null) : null;
        }
        if (it.type === "multi_select" || it.type === "match") return it.answer_key;
        if (it.type === "fill_blank") return (it.answer_key as string[]).map((k) => k.split("|")[0]);
        if (it.type === "numerical") return String((it.answer_key as { value: number }).value);
        return it.answer;
      });
      await asUser(ctx.sql, student, (tx) => tx`select public.submit_practice_session(${sessionId}::uuid, ${tx.json(answers as never)}::jsonb)`);
    }
  }

  // The mastery section ran before these tests existed; compute_mastery (0151) folds test and practice results in.
  if (seededTests || !existingPractice) {
    // Direct SQL like mastery.ts: over PostgREST the full-tenant compute hit statement_timeout on hosted.
    await ctx.sql.begin(async (tx) => {
      await tx`set local statement_timeout = 0`;
      await tx`select public.compute_mastery(${inst}::uuid)`;
    });
  }
}
