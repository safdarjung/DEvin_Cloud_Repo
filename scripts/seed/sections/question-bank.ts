import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";
import { demoUsers, insertOnce, pick, sectionRng } from "../lib/util.ts";

// ~350 questions. Mathematics (Grades I-X) is generated from parameterised templates, so every
// answer is computed, not typed; the other subjects are a hand-written factual set. `unit`
// is the 1-4 position of the topic in the curriculum template (curriculum.ts reuses the same four
// unit titles per subject in every grade).

type QType = "mcq" | "true_false" | "short_answer" | "long_answer";
type Difficulty = "easy" | "medium" | "hard";
interface Q {
  subject: string;
  grade: string;
  unit: number;
  type: QType;
  difficulty: Difficulty;
  body: string;
  options?: string[];
  answer: string;
  marks: number;
}

const GRADES_ALL = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"] as const;
const int = (rng: () => number, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

function shuffle<T>(rng: () => number, items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** MCQ with the right answer plus three distinct wrong ones. */
function mcq(rng: () => number, subject: string, grade: string, unit: number, difficulty: Difficulty, body: string, right: string, wrong: string[]): Q {
  const options = shuffle(rng, [right, ...[...new Set(wrong)].filter((w) => w !== right).slice(0, 3)]);
  return { subject, grade, unit, type: "mcq", difficulty, body, options, answer: right, marks: 1 };
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

type Gen = (rng: () => number, grade: string) => Q;

const MATH_BY_BAND: Record<string, Gen[]> = {
  junior: [
    (rng, g) => { const a = int(rng, 3, 9), b = int(rng, 2, 9); return mcq(rng, "MATH", g, 1, "easy", `What is ${a} + ${b}?`, String(a + b), [String(a + b + 1), String(a + b - 1), String(a + b + 2)]); },
    (rng, g) => { const a = int(rng, 11, 19), b = int(rng, 2, 9); return mcq(rng, "MATH", g, 1, "easy", `What is ${a} - ${b}?`, String(a - b), [String(a - b + 1), String(a - b - 1), String(a - b + 10)]); },
    (rng, g) => { const a = int(rng, 2, 5), b = int(rng, 2, 6); return mcq(rng, "MATH", g, 1, "easy", `Riya has ${a} boxes with ${b} pencils in each box. How many pencils does she have?`, String(a * b), [String(a + b), String(a * b + 2), String(a * b - 1)]); },
    (rng, g) => { const n = int(rng, 3, 8); return { subject: "MATH", grade: g, unit: 4, type: "true_false", difficulty: "easy", body: `A shape with ${n} sides is called a ${n === 3 ? "triangle" : n === 4 ? "quadrilateral" : n === 5 ? "pentagon" : n === 6 ? "hexagon" : n === 7 ? "heptagon" : "octagon"}.`, answer: "True", marks: 1 }; },
  ],
  middle: [
    (rng, g) => { const a = int(rng, 6, 15), b = int(rng, 6, 15); return mcq(rng, "MATH", g, 1, "easy", `What is ${a} x ${b}?`, String(a * b), [String(a * b + a), String(a * b - b), String(a * b + 10)]); },
    (rng, g) => { const b = int(rng, 3, 12), q = int(rng, 4, 15); return mcq(rng, "MATH", g, 1, "easy", `What is ${b * q} divided by ${b}?`, String(q), [String(q + 1), String(q - 1), String(q + 2)]); },
    (rng, g) => { const l = int(rng, 6, 20), b = int(rng, 3, l - 1); return mcq(rng, "MATH", g, 4, "medium", `Find the perimeter of a rectangle of length ${l} cm and breadth ${b} cm.`, `${2 * (l + b)} cm`, [`${l * b} cm`, `${l + b} cm`, `${2 * (l + b) + 4} cm`]); },
    (rng, g) => { const a = int(rng, 2, 9) * 2, b = int(rng, 3, 9) * 3; const l = (a * b) / gcd(a, b); return mcq(rng, "MATH", g, 1, "medium", `What is the LCM of ${a} and ${b}?`, String(l), [String(a * b * 2), String(l + gcd(a, b)), String(Math.max(a, b))]); },
    (rng, g) => { const d = int(rng, 3, 9), n = int(rng, 1, d - 1); return { subject: "MATH", grade: g, unit: 1, type: "short_answer", difficulty: "medium", body: `Write ${n}/${d} + ${d - n}/${d} as a single number.`, answer: "1", marks: 2 } as Q; },
  ],
  upper: [
    (rng, g) => { const p = pick(rng, [5, 10, 15, 20, 25, 40]), y = int(rng, 2, 20) * 20; return mcq(rng, "MATH", g, 1, "easy", `What is ${p}% of ${y}?`, String((p * y) / 100), [String((p * y) / 100 + p), String((p * y) / 100 - 2), String(y / p)]); },
    (rng, g) => { const x = int(rng, 2, 12), a = int(rng, 2, 7), b = int(rng, 1, 15); return mcq(rng, "MATH", g, 2, "medium", `Solve for x: ${a}x + ${b} = ${a * x + b}`, `x = ${x}`, [`x = ${x + 1}`, `x = ${x - 1}`, `x = ${x + a}`]); },
    (rng, g) => { const bs = int(rng, 4, 20), h = int(rng, 3, 14) * 2; return mcq(rng, "MATH", g, 4, "medium", `Find the area of a triangle with base ${bs} cm and height ${h} cm.`, `${(bs * h) / 2} cm2`, [`${bs * h} cm2`, `${bs + h} cm2`, `${(bs * h) / 2 + bs} cm2`]); },
    (rng, g) => { const a = int(rng, 2, 9), b = int(rng, 2, 9) * a; const k = gcd(a, b); return mcq(rng, "MATH", g, 1, "medium", `Simplify the ratio ${a * 3} : ${b * 3}.`, `${a / k} : ${b / k}`, [`${a} : ${b + 1}`, `${a * 3} : ${b}`, `${b / k} : ${a / k}`]); },
    (rng, g) => { const p = int(rng, 5, 30) * 100, r = pick(rng, [4, 5, 8, 10]), t = int(rng, 2, 5); return mcq(rng, "MATH", g, 1, "hard", `Find the simple interest on Rs ${p} at ${r}% per annum for ${t} years.`, `Rs ${(p * r * t) / 100}`, [`Rs ${(p * r) / 100}`, `Rs ${(p * r * t) / 100 + p}`, `Rs ${(p * t) / 100}`]); },
  ],
  senior: [
    (rng, g) => { const a = int(rng, 1, 6), b = int(rng, a + 1, 9); return mcq(rng, "MATH", g, 3, "medium", `Find the roots of x2 - ${a + b}x + ${a * b} = 0.`, `${a} and ${b}`, [`${-a} and ${-b}`, `${a} and ${-b}`, `${a + 1} and ${b + 1}`]); },
    (rng, g) => { const a = int(rng, 2, 9), d = int(rng, 2, 7), n = int(rng, 8, 20); return mcq(rng, "MATH", g, 2, "medium", `The first term of an AP is ${a} and the common difference is ${d}. What is its ${n}th term?`, String(a + (n - 1) * d), [String(a + n * d), String(a + (n - 2) * d), String(a * n + d)]); },
    (rng, g) => { const [p, q, r] = pick(rng, [[3, 4, 5], [5, 12, 13], [8, 15, 17], [7, 24, 25], [9, 40, 41]]); return mcq(rng, "MATH", g, 4, "medium", `The two shorter sides of a right triangle are ${p} cm and ${q} cm. What is the hypotenuse?`, `${r} cm`, [`${r + 1} cm`, `${p + q} cm`, `${r - 1} cm`]); },
    (rng, g) => { const red = int(rng, 2, 9), blue = int(rng, 2, 9), t = red + blue; const k = gcd(red, t); return mcq(rng, "MATH", g, 4, "hard", `A bag has ${red} red and ${blue} blue balls. One ball is drawn at random. What is the probability that it is red?`, `${red / k}/${t / k}`, [`${blue / gcd(blue, t)}/${t / gcd(blue, t)}`, `${red}/${blue}`, `1/${t}`]); },
    (rng, g) => { const a = int(rng, 1, 5), b = int(rng, 1, 5); return { subject: "MATH", grade: g, unit: 3, type: "short_answer", difficulty: "hard", body: `If the sum of the roots of a quadratic is ${a + b} and their product is ${a * b}, write the quadratic equation in x.`, answer: `x2 - ${a + b}x + ${a * b} = 0`, marks: 3 } as Q; },
  ],
};

function bandOf(grade: string): keyof typeof MATH_BY_BAND {
  const i = GRADES_ALL.indexOf(grade as (typeof GRADES_ALL)[number]);
  return i < 3 ? "junior" : i < 5 ? "middle" : i < 8 ? "upper" : "senior";
}

// subject, grades, unit, type, difficulty, body, options (mcq), answer
type Fact = [string, string[], number, QType, Difficulty, string, string[] | null, string];
const FACTS: Fact[] = [
  ["SCI", ["VI", "VII"], 1, "mcq", "easy", "Which of these is a pure substance?", ["Air", "Distilled water", "Milk", "Soil"], "Distilled water"],
  ["SCI", ["VI", "VII", "VIII"], 1, "true_false", "easy", "Iron rusts when it is exposed to both air and moisture.", null, "True"],
  ["SCI", ["VII", "VIII"], 1, "mcq", "medium", "What is the chemical symbol of sodium?", ["S", "So", "Na", "Sd"], "Na"],
  ["SCI", ["VIII", "IX"], 1, "mcq", "medium", "Which gas turns lime water milky?", ["Oxygen", "Nitrogen", "Carbon dioxide", "Hydrogen"], "Carbon dioxide"],
  ["SCI", ["IX", "X"], 1, "mcq", "hard", "What is the pH of a neutral solution at 25 degrees Celsius?", ["0", "7", "10", "14"], "7"],
  ["SCI", ["VI", "VII"], 2, "mcq", "easy", "Which part of a plant makes food by photosynthesis?", ["Root", "Stem", "Leaf", "Flower"], "Leaf"],
  ["SCI", ["VI", "VII", "VIII"], 2, "true_false", "easy", "Human blood is pumped around the body by the heart.", null, "True"],
  ["SCI", ["VIII", "IX"], 2, "mcq", "medium", "Which organelle is called the powerhouse of the cell?", ["Nucleus", "Mitochondria", "Ribosome", "Vacuole"], "Mitochondria"],
  ["SCI", ["IX", "X"], 2, "short_answer", "medium", "Name the process by which plants lose water vapour through stomata.", null, "Transpiration"],
  ["SCI", ["X"], 2, "mcq", "hard", "Which hormone regulates blood sugar level in the human body?", ["Thyroxine", "Insulin", "Adrenaline", "Oestrogen"], "Insulin"],
  ["SCI", ["VI", "VII"], 3, "mcq", "easy", "What is the SI unit of force?", ["Joule", "Newton", "Watt", "Pascal"], "Newton"],
  ["SCI", ["VII", "VIII"], 3, "true_false", "medium", "Sound cannot travel through a vacuum.", null, "True"],
  ["SCI", ["VIII", "IX"], 3, "mcq", "medium", "A body at rest stays at rest unless acted on by an unbalanced force. This is Newton's:", ["First law", "Second law", "Third law", "Law of gravitation"], "First law"],
  ["SCI", ["IX", "X"], 3, "mcq", "hard", "A car of mass 1000 kg accelerates at 2 m/s2. What force acts on it?", ["500 N", "1000 N", "2000 N", "4000 N"], "2000 N"],
  ["SCI", ["X"], 3, "short_answer", "medium", "State Ohm's law.", null, "The current through a conductor is directly proportional to the potential difference across it, at constant temperature."],
  ["SCI", ["VI", "VII", "VIII"], 4, "mcq", "easy", "Which of these is a renewable source of energy?", ["Coal", "Petrol", "Solar energy", "Natural gas"], "Solar energy"],
  ["SCI", ["VIII", "IX", "X"], 4, "true_false", "easy", "Planting more trees helps reduce the amount of carbon dioxide in the air.", null, "True"],
  ["SCI", ["IX", "X"], 4, "long_answer", "medium", "Explain two ways in which a school can reduce plastic waste.", null, "Use reusable bottles and lunch boxes, ban single-use plastic at events, and segregate waste for recycling."],
  ["SST", ["VI", "VII"], 1, "mcq", "easy", "Who was the first Prime Minister of independent India?", ["Sardar Patel", "Jawaharlal Nehru", "Mahatma Gandhi", "Dr Rajendra Prasad"], "Jawaharlal Nehru"],
  ["SST", ["VII", "VIII"], 1, "mcq", "medium", "The Indian National Congress was founded in:", ["1857", "1885", "1905", "1919"], "1885"],
  ["SST", ["VIII", "IX"], 1, "mcq", "medium", "The Revolt of 1857 began at:", ["Meerut", "Delhi", "Kanpur", "Jhansi"], "Meerut"],
  ["SST", ["IX", "X"], 1, "short_answer", "hard", "Name the movement started by Gandhiji in 1930 with the Dandi March.", null, "The Civil Disobedience Movement"],
  ["SST", ["VI", "VII"], 2, "mcq", "easy", "Which is the longest river in India?", ["Yamuna", "Godavari", "Ganga", "Narmada"], "Ganga"],
  ["SST", ["VI", "VII", "VIII"], 2, "true_false", "easy", "The Himalayas are young fold mountains.", null, "True"],
  ["SST", ["VIII", "IX"], 2, "mcq", "medium", "Black soil is most suitable for growing:", ["Rice", "Cotton", "Tea", "Coffee"], "Cotton"],
  ["SST", ["IX", "X"], 2, "mcq", "hard", "Which latitude passes through the middle of India?", ["Equator", "Tropic of Cancer", "Tropic of Capricorn", "Arctic Circle"], "Tropic of Cancer"],
  ["SST", ["VI", "VII"], 3, "mcq", "easy", "Who heads the government of a state in India?", ["President", "Governor", "Chief Minister", "Speaker"], "Chief Minister"],
  ["SST", ["VIII", "IX"], 3, "mcq", "medium", "How many Fundamental Rights does the Constitution of India guarantee?", ["Five", "Six", "Seven", "Eight"], "Six"],
  ["SST", ["IX", "X"], 3, "true_false", "medium", "The Lok Sabha is the lower house of the Indian Parliament.", null, "True"],
  ["SST", ["X"], 4, "short_answer", "medium", "What does GDP stand for?", null, "Gross Domestic Product"],
  ["SST", ["VIII", "IX", "X"], 4, "mcq", "medium", "Which sector includes farming and fishing?", ["Primary", "Secondary", "Tertiary", "Quaternary"], "Primary"],
  ["ENG", ["VI", "VII"], 2, "mcq", "easy", "Choose the correct sentence.", ["She go to school.", "She goes to school.", "She going to school.", "She gone to school."], "She goes to school."],
  ["ENG", ["VI", "VII", "VIII"], 2, "mcq", "easy", "The plural of 'child' is:", ["childs", "childrens", "children", "childes"], "children"],
  ["ENG", ["VII", "VIII"], 2, "mcq", "medium", "Fill in the blank: He has been waiting ___ morning.", ["since", "for", "from", "by"], "since"],
  ["ENG", ["VIII", "IX"], 2, "mcq", "medium", "Which word is an adverb in: 'She sang beautifully'?", ["She", "sang", "beautifully", "None"], "beautifully"],
  ["ENG", ["IX", "X"], 2, "mcq", "hard", "Choose the correct passive form of: 'The teacher praised the students.'", ["The students praised the teacher.", "The students were praised by the teacher.", "The students are praised by the teacher.", "The teacher was praised by the students."], "The students were praised by the teacher."],
  ["ENG", ["VI", "VII"], 3, "short_answer", "easy", "Write a two-line sentence about your school.", null, "Any grammatically correct two-line description of the school."],
  ["ENG", ["VIII", "IX", "X"], 3, "long_answer", "medium", "Write a formal letter to your principal requesting leave for two days. (80-100 words)", null, "Format: sender address, date, receiver, subject, salutation, body with reason and dates, closing."],
  ["ENG", ["IX", "X"], 4, "short_answer", "medium", "What is a metaphor? Give one example.", null, "A figure of speech that describes something as if it were something else, for example 'Time is a thief'."],
  ["HIN", ["VI", "VII", "VIII"], 1, "mcq", "easy", "'सूर्य' शब्द का पर्यायवाची है:", ["चाँद", "दिनकर", "सागर", "पवन"], "दिनकर"],
  ["HIN", ["VII", "VIII", "IX"], 1, "mcq", "medium", "'विद्यालय' में कौन-सी संधि है?", ["दीर्घ संधि", "गुण संधि", "यण संधि", "व्यंजन संधि"], "दीर्घ संधि"],
  ["HIN", ["VI", "VII"], 1, "true_false", "easy", "'नदी' शब्द स्त्रीलिंग है।", null, "True"],
  ["HIN", ["IX", "X"], 4, "long_answer", "medium", "'पर्यावरण संरक्षण' पर 100 शब्दों में अनुच्छेद लिखिए।", null, "पर्यावरण का महत्व, प्रदूषण के कारण, वृक्षारोपण और जल संरक्षण के उपाय।"],
  ["COMP", ["VI", "VII"], 1, "mcq", "easy", "Which of these is an input device?", ["Monitor", "Printer", "Keyboard", "Speaker"], "Keyboard"],
  ["COMP", ["VI", "VII", "VIII"], 1, "true_false", "easy", "RAM is a volatile memory.", null, "True"],
  ["COMP", ["VII", "VIII"], 2, "mcq", "easy", "Which shortcut copies selected text?", ["Ctrl + V", "Ctrl + C", "Ctrl + X", "Ctrl + Z"], "Ctrl + C"],
  ["COMP", ["VIII", "IX"], 3, "mcq", "medium", "Which of these is not a loop construct?", ["for", "while", "do-while", "if"], "if"],
  ["COMP", ["IX", "X"], 4, "mcq", "medium", "Which of these is the safest password?", ["12345678", "password", "Tr33$Rain#42", "myname2010"], "Tr33$Rain#42"],
  ["COMP", ["VI", "VII", "VIII", "IX"], 4, "true_false", "easy", "You should share your password with friends you trust.", null, "False"],
];

const PER_GRADE_MATH = 28;

function buildQuestions(): Q[] {
  const rng = sectionRng("question-bank");
  const out: Q[] = [];
  for (const grade of GRADES_ALL) {
    const gens = MATH_BY_BAND[bandOf(grade)]!;
    const seen = new Set<string>();
    for (let attempts = 0; seen.size < PER_GRADE_MATH && attempts < 400; attempts++) {
      const q = pick(rng, gens)(rng, grade);
      if (seen.has(q.body)) continue;
      seen.add(q.body);
      out.push(q);
    }
  }
  for (const [subject, grades, unit, type, difficulty, body, options, answer] of FACTS) {
    for (const grade of grades) {
      out.push({ subject, grade, unit, type, difficulty, body, ...(options ? { options } : {}), answer, marks: type === "long_answer" ? 5 : type === "short_answer" ? 2 : 1 });
    }
  }
  return out;
}

export async function run(ctx: SeedContext): Promise<void> {
  const inst = ctx.institutionId;
  const users = await demoUsers(ctx.sql, inst);

  const subjects = await ctx.sql<{ id: string; code: string }[]>`select id, code from public.subjects where institution_id = ${inst}`;
  const grades = await ctx.sql<{ id: string; code: string }[]>`select id, code from public.grades where institution_id = ${inst}`;
  const units = await ctx.sql<{ id: string; subject_id: string; grade_id: string; sequence: number }[]>`
    select id, subject_id, grade_id, sequence from public.curriculum_units where institution_id = ${inst}`;
  const subjectId = new Map(subjects.map((s) => [s.code, s.id]));
  const gradeId = new Map(grades.map((g) => [g.code, g.id]));
  const unitId = new Map(units.map((u) => [`${u.subject_id}:${u.grade_id}:${u.sequence}`, u.id]));
  // Teachers author: the three class teachers, round-robin by subject.
  const authors = ["teacher.vi-a", "teacher.viii-b", "teacher.x-a"].map((k) => users[k]!);

  const rows = buildQuestions().flatMap((q, i) => {
    const sid = subjectId.get(q.subject);
    const gid = gradeId.get(q.grade);
    if (!sid || !gid) return []; // subject not taught in this grade/tenant
    return [{
      id: uuidV5("question-bank", `${inst}:${q.subject}:${q.grade}:${q.body}`),
      institution_id: inst,
      subject_id: sid,
      grade_id: gid,
      curriculum_unit_id: unitId.get(`${sid}:${gid}:${q.unit}`) ?? null,
      type: q.type,
      difficulty: q.difficulty,
      body: q.body,
      options: q.options ?? null,
      answer: q.answer,
      marks: q.marks,
      created_by: authors[i % authors.length]!,
    }];
  });
  await insertOnce(ctx.admin, "question_bank", rows);
}
