import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";
import { demoUsers, insertOnce, isoAt, isoDay } from "../lib/util.ts";
import { allocatePlan } from "../../../src/modules/study/planner.ts";
import { autoMark, type QuizAnswer } from "../../../src/modules/study/quiz.ts";
import type { QuizQuestion } from "../../../src/modules/study/formats.ts";

// Study studio demo data (0138). student.one (X-A): six own items in several formats, a
// flashcard deck and a teacher deck with review history, studio quiz attempts, one active
// plan and two weeks of study sessions. teacher.x-a: three items shared with X-A, with a few
// classmates' attempts and reviews so the engagement view has counts. Deterministic uuidV5
// ids, insert-if-missing (safe to rerun), no rng draws. Content is hand-written, not AI output,
// but flagged ai_generated like real studio items so the UI labels match.
// 0140 study help: a Hindi version of the forces summary, a three-level worksheet for
// teacher.x-a, a saved mock exam with one attempt, two "ask my teacher" questions (one
// answered) and teacher.x-a's file-reading consent (student.one still sees the tick).

const S = "study-studio";
const id = (key: string) => uuidV5(S, key);

interface Unit {
  id: string;
  subject_id: string;
  subject_code: string;
  title: string;
}

const cards = (pairs: [string, string][]) => ({ cards: pairs.map(([front, back], i) => ({ id: `c${i + 1}`, front, back })) });
const mcq = (stem: string, options: string[], answerIndex: number, explanation: string) => ({ type: "mcq", stem, options, answerIndex, explanation });
const tf = (stem: string, answer: boolean, explanation: string) => ({ type: "true_false", stem, answer, explanation });

const QUADRATIC_DECK = cards([
  ["Standard form of a quadratic equation", "ax² + bx + c = 0, with a ≠ 0"],
  ["Discriminant", "D = b² − 4ac"],
  ["D > 0 means", "Two distinct real roots"],
  ["D = 0 means", "Two equal real roots"],
  ["D < 0 means", "No real roots"],
  ["Quadratic formula", "x = (−b ± √D) / 2a"],
  ["Sum of roots", "−b / a"],
  ["Product of roots", "c / a"],
]);

const FORCES_DECK = cards([
  ["Force", "A push or pull that can change an object's motion or shape"],
  ["SI unit of force", "Newton (N)"],
  ["Work done", "Force × displacement in the direction of the force"],
  ["SI unit of energy", "Joule (J)"],
  ["Kinetic energy", "½ mv², energy due to motion"],
  ["Potential energy near Earth", "mgh, energy due to position"],
  ["Law of conservation of energy", "Energy is neither created nor destroyed, only changed in form"],
  ["Power", "Rate of doing work: work ÷ time; unit watt (W)"],
]);

const FORCES_QUIZ = {
  difficulty: "medium",
  questions: [
    mcq("What is the SI unit of work?", ["Newton", "Joule", "Watt", "Pascal"], 1, "Work is measured in joules: 1 J = 1 N × 1 m."),
    mcq("A 2 kg ball moves at 3 m/s. Its kinetic energy is", ["3 J", "6 J", "9 J", "18 J"], 2, "KE = ½ × 2 × 3² = 9 J."),
    tf("Power is the rate of doing work.", true, "Power = work ÷ time."),
    tf("Work is done when you push a wall that does not move.", false, "No displacement means no work in the physics sense."),
    {
      type: "short",
      stem: "Explain why a ball thrown upward slows down as it rises.",
      modelAnswer: "Gravity pulls it down, so its kinetic energy changes into potential energy as it rises and its speed falls.",
      rubric: ["gravity acts downward", "kinetic energy changes to potential energy"],
      explanation: "Total mechanical energy stays the same if air resistance is ignored.",
    },
  ],
};

const QUADRATIC_QUIZ = {
  difficulty: "easy",
  questions: [
    mcq("The discriminant of x² − 5x + 6 = 0 is", ["1", "−1", "11", "25"], 0, "D = 25 − 24 = 1."),
    mcq("The roots of x² − 5x + 6 = 0 are", ["1 and 6", "2 and 3", "−2 and −3", "5 and 6"], 1, "x² − 5x + 6 = (x − 2)(x − 3)."),
    tf("If D < 0 the equation has two equal real roots.", false, "D < 0 means no real roots; D = 0 means equal roots."),
    mcq("For 2x² + 3x − 5 = 0, the sum of the roots is", ["3/2", "−3/2", "5/2", "−5/2"], 1, "Sum of roots = −b/a = −3/2."),
    tf("x = 0 is a root of x² + 4x = 0.", true, "x(x + 4) = 0 gives x = 0 or x = −4."),
  ],
};

export async function run(ctx: SeedContext): Promise<void> {
  const inst = ctx.institutionId;
  const users = await demoUsers(ctx.sql, inst);
  const studentUser = users["student.one"];
  const teacherUser = users["teacher.x-a"];
  if (!studentUser || !teacherUser) {
    console.warn("  study-studio: demo logins student.one / teacher.x-a not found; skipped.");
    return;
  }
  const [me] = await ctx.sql<{ student_id: string; section_id: string }[]>`
    select m.student_id, e.class_section_id as section_id
    from public.memberships m
    join public.enrolments e on e.student_id = m.student_id and e.institution_id = m.institution_id and e.status = 'active'
    where m.institution_id = ${inst} and m.user_id = ${studentUser}
    limit 1`;
  if (!me) {
    console.warn("  study-studio: student.one has no active enrolment; skipped.");
    return;
  }
  const units = await ctx.sql<Unit[]>`
    select cu.id, cu.subject_id, s.code as subject_code, cu.title
    from public.subject_assignments sa
    join public.subjects s on s.id = sa.subject_id
    join public.class_sections cs on cs.id = sa.class_section_id
    join public.curriculum_units cu on cu.subject_id = s.id and cu.grade_id = cs.grade_id and cu.institution_id = cs.institution_id
    where cs.id = ${me.section_id} and s.code in ('MATH', 'SCI')
    order by s.code, cu.sequence`;
  const unit = (code: string, n: number) => units.filter((u) => u.subject_code === code)[n];
  const math = [unit("MATH", 1), unit("MATH", 2)];
  const sci = [unit("SCI", 0), unit("SCI", 2), unit("SCI", 3)];
  if ([...math, ...sci].some((u) => !u)) {
    console.warn("  study-studio: X-A has no Mathematics/Science units; skipped.");
    return;
  }
  const [algebra, quadratic] = math as [Unit, Unit];
  const [matter, forces, environment] = sci as [Unit, Unit, Unit];

  const material = (key: string, owner: "student" | "teacher", format: string, title: string, u: Unit, content: unknown, day: number) => ({
    id: id(`material:${key}`),
    institution_id: inst,
    user_id: owner === "student" ? studentUser : teacherUser,
    owner_role: owner,
    format,
    title,
    subject_id: u.subject_id,
    curriculum_unit_id: u.id,
    source_kind: "unit",
    content,
    ai_generated: true,
    created_at: isoAt(-day, 10),
  });

  const materials = [
    material("summary", "student", "quick_summary", `Quick summary: ${forces.title}`, forces, {
      summary:
        "A force is a push or pull. When a force moves an object, work is done and energy is transferred. Energy changes form, for example from kinetic to potential, but the total stays the same.",
      keyPoints: ["Work = force × displacement", "Kinetic energy = ½ mv²", "Potential energy = mgh", "Power = work ÷ time"],
    }, 12),
    material("notes", "student", "revision_notes", `Revision notes: ${quadratic.title}`, quadratic, {
      sections: [
        { heading: "Standard form", points: ["ax² + bx + c = 0 with a ≠ 0", "Bring every term to one side before solving"] },
        { heading: "Ways to solve", points: ["Factorisation: split the middle term", "Completing the square", "Quadratic formula x = (−b ± √D) / 2a"] },
        { heading: "Nature of roots", points: ["D = b² − 4ac", "D > 0: two distinct roots; D = 0: equal roots; D < 0: no real roots"] },
      ],
    }, 11),
    material("glossary", "student", "glossary", `Definitions: ${matter.title}`, matter, {
      terms: [
        { term: "Matter", definition: "Anything that has mass and takes up space." },
        { term: "Element", definition: "A pure substance made of only one kind of atom." },
        { term: "Compound", definition: "A substance of two or more elements chemically combined in a fixed ratio." },
        { term: "Mixture", definition: "Two or more substances mixed without chemical combination; can be separated physically." },
        { term: "Solution", definition: "A uniform mixture of a solute dissolved in a solvent." },
      ],
    }, 9),
    material("recall", "student", "active_recall", `Active recall: ${algebra.title}`, algebra, {
      prompts: [
        { prompt: "How do you expand (a + b)²?", answer: "a² + 2ab + b²." },
        { prompt: "Why can you add 3x and 5x but not 3x and 5y?", answer: "Only like terms (same variable and power) can be combined." },
        { prompt: "How do you check a solution of an equation?", answer: "Substitute it back; both sides must be equal." },
        { prompt: "What does it mean to factorise an expression?", answer: "Write it as a product of simpler expressions." },
        { prompt: "How is a linear equation different from a quadratic one?", answer: "A linear equation has highest power 1; a quadratic has highest power 2." },
      ],
    }, 6),
    material("deck", "student", "flashcards", `Flashcard deck: ${quadratic.title}`, quadratic, QUADRATIC_DECK, 10),
    material("quiz", "student", "quiz", `Quiz: ${forces.title}`, forces, FORCES_QUIZ, 8),
    material("t-concepts", "teacher", "key_concepts", `Key concepts: ${environment.title}`, environment, {
      concepts: [
        { name: "Ecosystem", explanation: "Living things and their non-living surroundings working together.", example: "A pond with fish, plants, water and sunlight." },
        { name: "Food chain", explanation: "The order in which energy passes from one organism to the next by eating.", example: "Grass → grasshopper → frog → snake." },
        { name: "Biodegradable waste", explanation: "Waste that microbes can break down naturally.", example: "Vegetable peels; plastic bags are not biodegradable." },
      ],
    }, 13),
    material("t-deck", "teacher", "flashcards", `Flashcard deck: ${forces.title}`, forces, FORCES_DECK, 13),
    material("t-quiz", "teacher", "quiz", `Quiz: ${quadratic.title}`, quadratic, QUADRATIC_QUIZ, 12),
  ];
  await insertOnce(ctx.admin, "study_materials", materials);
  await ctx.admin
    .from("study_material_sections")
    .upsert(
      ["t-concepts", "t-deck", "t-quiz"].map((k) => ({ material_id: id(`material:${k}`), institution_id: inst, class_section_id: me.section_id })),
      { onConflict: "material_id,class_section_id", ignoreDuplicates: true },
    )
    .then(({ error }) => {
      if (error) throw new Error(`study-studio: sections failed: ${error.message}`);
    });

  // Classmates (no logins) who also used the teacher's items, so engagement shows real counts.
  const classmates = await ctx.sql<{ student_id: string }[]>`
    select e.student_id from public.enrolments e
    where e.institution_id = ${inst} and e.class_section_id = ${me.section_id} and e.status = 'active' and e.student_id <> ${me.student_id}
    order by e.student_id limit 8`;

  const today = isoDay(0);
  const state = (entries: [string, number, number, number][]) =>
    Object.fromEntries(entries.map(([card, box, dueIn, lapses]) => [card, { box, due: isoDay(dueIn), reps: box + lapses, lapses, last: isoDay(dueIn - 1 - box) }]));
  const progress = [
    { material_id: id("material:deck"), student_id: me.student_id, reviews: 14, last_reviewed_at: isoAt(-1, 19), state: state([["c1", 2, 0, 0], ["c2", 2, 0, 1], ["c3", 1, -1, 1], ["c4", 3, 4, 0], ["c5", 3, 5, 0], ["c6", 1, 0, 2]]) },
    { material_id: id("material:t-deck"), student_id: me.student_id, reviews: 9, last_reviewed_at: isoAt(-2, 18), state: state([["c1", 2, 1, 0], ["c2", 1, 0, 1], ["c3", 3, 6, 0], ["c4", 2, 0, 0], ["c5", 1, 0, 1]]) },
    ...classmates.slice(0, 5).map((c, i) => ({
      material_id: id("material:t-deck"),
      student_id: c.student_id,
      reviews: 4 + i,
      last_reviewed_at: isoAt(-(i + 1), 17),
      state: state([["c1", 2, 2, 0], ["c5", 1, 0, i % 2], ["c7", 1, 1, 1]]),
    })),
  ].map((p) => ({ ...p, institution_id: inst }));
  const { error: pError } = await ctx.admin.from("study_deck_progress").upsert(progress, { onConflict: "material_id,student_id", ignoreDuplicates: true });
  if (pError) throw new Error(`study-studio: deck progress failed: ${pError.message}`);

  const attempt = (key: string, studentId: string, materialKey: string, quiz: typeof FORCES_QUIZ | typeof QUADRATIC_QUIZ, u: Unit, answers: QuizAnswer[], ai: [number, number], day: number) => {
    const marked = autoMark(quiz.questions as QuizQuestion[], answers);
    return {
    id: id(`attempt:${key}`),
    institution_id: inst,
    student_id: studentId,
    material_id: id(`material:${materialKey}`),
    subject_id: u.subject_id,
    curriculum_unit_id: u.id,
    title: materials.find((m) => m.id === id(`material:${materialKey}`))!.title,
    difficulty: quiz.difficulty,
    questions: quiz.questions,
    answers,
    ai_checks: ai[1] ? [{ score: ai[0], feedback: ai[0] === 2 ? "You named both ideas." : "Good start: say what happens to the energy as it rises." }] : [],
    auto_score: marked.autoScore,
    auto_max: marked.autoMax,
    ai_points: ai[0],
    ai_max: ai[1],
    duration_seconds: 420 + day * 10,
    created_at: isoAt(-day, 18),
    };
  };
  const attempts = [
    attempt("me-forces-1", me.student_id, "quiz", FORCES_QUIZ, forces, [1, 1, true, true, "Gravity slows it."], [1, 2], 8),
    attempt("me-forces-2", me.student_id, "quiz", FORCES_QUIZ, forces, [1, 2, true, false, "Gravity acts down and kinetic energy turns into potential energy."], [2, 2], 3),
    attempt("me-quadratic-1", me.student_id, "t-quiz", QUADRATIC_QUIZ, quadratic, [0, 1, true, 0, true], [0, 0], 5),
    ...classmates.slice(0, 6).map((c, i) =>
      attempt(`mate-${i}`, c.student_id, "t-quiz", QUADRATIC_QUIZ, quadratic, [0, i % 2 ? 1 : 2, i % 3 === 0, 1, true], [0, 0], 1 + (i % 6)),
    ),
  ];
  await insertOnce(ctx.admin, "study_quiz_attempts", attempts);

  // Two weeks of study time: most days, 15-40 minutes.
  const activities = ["flashcards", "quiz", "reading", "plan"] as const;
  const sessions = Array.from({ length: 14 }, (_, d) => d)
    .filter((d) => d % 4 !== 2)
    .map((d) => ({
      id: id(`session:${d}`),
      institution_id: inst,
      student_id: me.student_id,
      activity: activities[d % activities.length],
      minutes: 15 + ((d * 7) % 26),
      subject_id: d % 2 ? quadratic.subject_id : forces.subject_id,
      material_id: d % 2 ? id("material:deck") : null,
      started_at: isoAt(-d, 13, 30),
    }));
  await insertOnce(ctx.admin, "study_sessions", sessions);

  // One active plan, unless the student already has one (e.g. built in the UI).
  const { count, error: cError } = await ctx.admin
    .from("study_plans")
    .select("id", { count: "exact", head: true })
    .eq("student_id", me.student_id)
    .eq("status", "active");
  if (cError) throw new Error(`study-studio: plan check failed: ${cError.message}`);
  if (!count) {
    const target = isoDay(14);
    const items = allocatePlan({
      today,
      targetDate: target,
      minutesPerDay: 45,
      topics: [
        { key: quadratic.id, label: quadratic.title, subjectId: quadratic.subject_id, unitId: quadratic.id, weak: true },
        { key: forces.id, label: forces.title, subjectId: forces.subject_id, unitId: forces.id, weak: false },
        { key: algebra.id, label: algebra.title, subjectId: algebra.subject_id, unitId: algebra.id, weak: false },
      ],
    }).map((item) => ({ ...item, done: item.day < today }));
    await insertOnce(ctx.admin, "study_plans", [
      { id: id("plan:active"), institution_id: inst, student_id: me.student_id, title: "Revision plan: Mathematics and Science", start_date: today, target_date: target, minutes_per_day: 45, items },
    ]);
  }

  await seedStudyHelp(ctx, { inst, studentUser, teacherUser, studentId: me.student_id, sectionId: me.section_id, quadratic, forces, matter });
}

async function seedStudyHelp(
  ctx: SeedContext,
  p: { inst: string; studentUser: string; teacherUser: string; studentId: string; sectionId: string; quadratic: Unit; forces: Unit; matter: Unit },
): Promise<void> {
  // One batch upsert: every row names every column (PostgREST sends null, not the default, for a missing key).
  const base = { institution_id: p.inst, ai_generated: true, language: "en", variant_of: null, focus_unit_ids: [] as string[], curriculum_unit_id: null as string | null };
  const mock = {
    difficulty: "medium",
    durationMinutes: 30,
    examLabel: null,
    paperId: null,
    units: [
      { id: p.forces.id, title: p.forces.title },
      { id: p.matter.id, title: p.matter.title },
    ],
    questions: [
      mcq("The SI unit of power is", ["Joule", "Newton", "Watt", "Pascal"], 2, "Power is measured in watts."),
      mcq("Which of these is a compound?", ["Oxygen", "Water", "Iron", "Air"], 1, "Water is hydrogen and oxygen chemically combined."),
      tf("Potential energy depends on height.", true, "PE = mgh."),
      tf("A mixture has a fixed composition.", false, "Mixtures can be in any ratio."),
      { type: "short", stem: "Why is air called a mixture?", modelAnswer: "Its gases are not chemically combined and their proportions can vary.", rubric: ["not chemically combined", "proportions vary"], explanation: "Air can be separated physically." },
    ],
    questionUnits: [0, 1, 0, 1, 1],
  };
  await insertOnce(ctx.admin, "study_materials", [
    {
      ...base,
      id: id("material:summary-hi"),
      user_id: p.studentUser,
      owner_role: "student",
      format: "quick_summary",
      title: `त्वरित सारांश: ${p.forces.title}`,
      subject_id: p.forces.subject_id,
      curriculum_unit_id: p.forces.id,
      source_kind: "unit",
      language: "hi",
      variant_of: id("material:summary"),
      content: {
        summary: "बल एक धक्का या खिंचाव है। जब बल किसी वस्तु को हिलाता है, तो कार्य होता है और ऊर्जा स्थानांतरित होती है। ऊर्जा रूप बदलती है, जैसे गतिज से स्थितिज, पर कुल ऊर्जा समान रहती है।",
        keyPoints: ["कार्य = बल × विस्थापन", "गतिज ऊर्जा = ½ mv²", "स्थितिज ऊर्जा = mgh", "शक्ति = कार्य ÷ समय"],
      },
      created_at: isoAt(-11, 10),
    },
    {
      ...base,
      id: id("material:t-worksheet"),
      user_id: p.teacherUser,
      owner_role: "teacher",
      format: "worksheet",
      title: `Worksheet: ${p.quadratic.title}`,
      subject_id: p.quadratic.subject_id,
      curriculum_unit_id: p.quadratic.id,
      source_kind: "unit",
      content: {
        levels: [
          { level: "support", instructions: "Use the hint in each question.", questions: [{ prompt: "Write x² − 9 = 0 in the form ax² + bx + c = 0. What are a, b and c? (Hint: b is the coefficient of x.)", answer: "a = 1, b = 0, c = −9." }, { prompt: "Find the discriminant of x² + 2x + 1 = 0.", answer: "D = 4 − 4 = 0." }] },
          { level: "core", instructions: "Show your working.", questions: [{ prompt: "Solve x² − 7x + 12 = 0 by factorisation.", answer: "(x − 3)(x − 4) = 0, so x = 3 or 4." }, { prompt: "State the nature of the roots of 2x² + 3x + 5 = 0.", answer: "D = 9 − 40 < 0, so no real roots." }] },
          { level: "stretch", instructions: "Explain each step.", questions: [{ prompt: "For what value of k does x² + kx + 9 = 0 have equal roots?", answer: "k² − 36 = 0, so k = ±6." }, { prompt: "The product of two consecutive positive integers is 132. Form a quadratic and find them.", answer: "n(n + 1) = 132, n² + n − 132 = 0, n = 11; the integers are 11 and 12." }] },
        ],
      },
      created_at: isoAt(-4, 9),
    },
    {
      ...base,
      id: id("material:mock"),
      user_id: p.studentUser,
      owner_role: "student",
      format: "mock_exam",
      title: "Mock exam: Science practice",
      subject_id: p.forces.subject_id,
      source_kind: "mock_exam",
      focus_unit_ids: [p.forces.id, p.matter.id],
      content: mock,
      created_at: isoAt(-2, 17),
    },
  ]);

  const answers: QuizAnswer[] = [2, 0, true, true, "The gases are just mixed."];
  const marked = autoMark(mock.questions as QuizQuestion[], answers);
  await insertOnce(ctx.admin, "study_quiz_attempts", [
    {
      id: id("attempt:mock-1"),
      institution_id: p.inst,
      student_id: p.studentId,
      material_id: id("material:mock"),
      subject_id: p.forces.subject_id,
      title: "Mock exam: Science practice",
      difficulty: "medium",
      questions: mock.questions,
      answers,
      ai_checks: [{ score: 1, feedback: "Right idea: also say the proportions can change." }],
      auto_score: marked.autoScore,
      auto_max: marked.autoMax,
      ai_points: 1,
      ai_max: 2,
      duration_seconds: 1500,
      created_at: isoAt(-2, 18),
    },
  ]);

  await insertOnce(ctx.admin, "study_questions", [
    {
      id: id("question:answered"),
      institution_id: p.inst,
      student_id: p.studentId,
      class_section_id: p.sectionId,
      subject_id: p.quadratic.subject_id,
      asked_by: p.studentUser,
      context_kind: "flashcard",
      material_id: id("material:deck"),
      context_excerpt: "D = 0 means — Two equal real roots",
      question: "Why are the roots equal when the discriminant is zero?",
      answer: "Because ±√0 is 0, the formula gives x = −b/2a twice. We will do one example in class tomorrow.",
      answered_by: p.teacherUser,
      answered_at: isoAt(-1, 16),
      created_at: isoAt(-2, 20),
    },
    {
      id: id("question:open"),
      institution_id: p.inst,
      student_id: p.studentId,
      class_section_id: p.sectionId,
      subject_id: p.forces.subject_id,
      asked_by: p.studentUser,
      context_kind: "quiz_question",
      material_id: id("material:quiz"),
      context_excerpt: "Work is done when you push a wall that does not move.",
      question: "My muscles get tired pushing the wall. Isn't that work?",
      created_at: isoAt(0, 8),
    },
  ]);

  const { error } = await ctx.admin
    .from("study_ai_consents")
    .upsert({ institution_id: p.inst, user_id: p.teacherUser, kind: "file_reading" }, { onConflict: "institution_id,user_id,kind", ignoreDuplicates: true });
  if (error) throw new Error(`study-studio: consent failed: ${error.message}`);
}
