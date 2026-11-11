// Study studio pure rules: spaced repetition, plan allocation, per-format
// content schemas, quiz auto-marking and weak-topic detection.
import { describe, expect, it } from "vitest";
import { addDays, dueCardIds, drillQueue, reviewCard, type CardState } from "@/modules/study/srs";
import { allocatePlan, capacityFromTimetable, type PlanTopic } from "@/modules/study/planner";
import { FORMAT_RULES, STUDY_FORMATS, contentSchema, generationSchema, toStoredContent, type StudyFormat } from "@/modules/study/formats";
import { answersFitQuestions, autoMark } from "@/modules/study/quiz";
import { accuracyBy, cardLapses, minutesByDay, questionAccuracy, weakTopics, weeklyAccuracy, type ScoredRow } from "@/modules/study/analytics";

const TODAY = "2026-11-11"; // a Wednesday

describe("spaced repetition (Leitner, 5 boxes)", () => {
  it("a new card answered 'knew' moves to box 1 and is due tomorrow", () => {
    expect(reviewCard(undefined, "knew", TODAY)).toEqual({ box: 1, due: "2026-11-12", reps: 1, lapses: 0, last: TODAY });
  });

  it("'knew' climbs a box with a longer interval each time, capped at box 5", () => {
    let s: CardState | undefined;
    const dues: string[] = [];
    for (let i = 0; i < 7; i++) {
      s = reviewCard(s, "knew", TODAY);
      dues.push(s.due);
    }
    expect(s!.box).toBe(5);
    expect(dues.slice(0, 5)).toEqual(["2026-11-12", "2026-11-14", "2026-11-18", "2026-11-25", "2026-12-11"]);
  });

  it("'missed' drops to box 1, counts a lapse and comes back tomorrow; 'almost' keeps the box but returns tomorrow", () => {
    const strong: CardState = { box: 4, due: TODAY, reps: 5, lapses: 0, last: "2026-11-01" };
    expect(reviewCard(strong, "missed", TODAY)).toEqual({ box: 1, due: "2026-11-12", reps: 6, lapses: 1, last: TODAY });
    expect(reviewCard(strong, "almost", TODAY)).toEqual({ box: 4, due: "2026-11-12", reps: 6, lapses: 0, last: TODAY });
  });

  it("due cards are reviewed cards due on or before today; never-reviewed cards are new, not due", () => {
    const cards = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    const states: Record<string, CardState> = {
      a: { box: 1, due: "2026-11-10", reps: 1, lapses: 0, last: "2026-11-09" },
      b: { box: 2, due: TODAY, reps: 2, lapses: 0, last: "2026-11-08" },
      c: { box: 3, due: "2026-11-15", reps: 3, lapses: 0, last: TODAY },
    };
    expect(dueCardIds(cards, states, TODAY)).toEqual(["a", "b"]);
    // Drill: due first (earliest first), then at most `newLimit` new cards.
    expect(drillQueue(cards, states, TODAY, 1)).toEqual(["a", "b", "d"]);
    expect(drillQueue(cards, states, TODAY, 0)).toEqual(["a", "b"]);
  });

  it("addDays crosses month ends in calendar days", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 30)).toBe("2027-01-30");
  });
});

describe("study plan allocation", () => {
  const topics: PlanTopic[] = [
    { key: "u1", label: "Light", subjectId: "s1", unitId: "u1", weak: true },
    { key: "u2", label: "Sound", subjectId: "s1", unitId: "u2", weak: false },
    { key: "u3", label: "Motion", subjectId: "s1", unitId: "u3", weak: false },
  ];

  it("never schedules before today or on/after the exam date, and stays within each day's minutes", () => {
    const items = allocatePlan({ today: TODAY, targetDate: "2026-11-21", minutesPerDay: 60, topics });
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) {
      expect(i.day >= TODAY).toBe(true);
      expect(i.day < "2026-11-21").toBe(true);
    }
    const perDay = new Map<string, number>();
    for (const i of items) perDay.set(i.day, (perDay.get(i.day) ?? 0) + i.minutes);
    for (const m of perDay.values()) expect(m).toBeLessThanOrEqual(60);
    expect([...perDay.keys()].sort()[0]).toBe(TODAY);
  });

  it("weak topics get more total time than strong ones", () => {
    const items = allocatePlan({ today: TODAY, targetDate: "2026-11-25", minutesPerDay: 45, topics });
    const total = (key: string) => items.filter((i) => i.key === key).reduce((n, i) => n + i.minutes, 0);
    expect(total("u1")).toBeGreaterThan(total("u2"));
    expect(total("u1")).toBeGreaterThan(total("u3"));
    expect(total("u2")).toBeGreaterThan(0);
  });

  it("each topic starts with 'learn' and its last session is 'practice' when it has more than one", () => {
    const items = allocatePlan({ today: TODAY, targetDate: "2026-11-25", minutesPerDay: 45, topics });
    for (const t of topics) {
      const mine = items.filter((i) => i.key === t.key);
      expect(mine[0]!.kind).toBe("learn");
      if (mine.length > 1) expect(mine.at(-1)!.kind).toBe("practice");
      for (const i of mine) expect(i.done).toBe(false);
    }
  });

  it("an exam today or in the past gives an empty plan", () => {
    expect(allocatePlan({ today: TODAY, targetDate: TODAY, minutesPerDay: 60, topics })).toEqual([]);
    expect(allocatePlan({ today: TODAY, targetDate: "2026-11-01", minutesPerDay: 60, topics })).toEqual([]);
    expect(allocatePlan({ today: TODAY, targetDate: "2026-11-20", minutesPerDay: 60, topics: [] })).toEqual([]);
  });

  it("respects per-weekday free minutes from the timetable (a day with none gets nothing)", () => {
    // 2026-11-15 is a Sunday (weekday 0).
    const free = { 0: 0, 1: 30, 2: 30, 3: 30, 4: 30, 5: 30, 6: 30 };
    const items = allocatePlan({ today: TODAY, targetDate: "2026-11-18", minutesPerDay: 90, topics, freeMinutesByWeekday: free });
    expect(items.some((i) => i.day === "2026-11-15")).toBe(false);
    const thursday = items.filter((i) => i.day === "2026-11-12").reduce((n, i) => n + i.minutes, 0);
    expect(thursday).toBeLessThanOrEqual(30);
  });

  it("capacityFromTimetable gives full-timetable days the chosen minutes and days without school up to double", () => {
    const cap = capacityFromTimetable({ 1: 8, 2: 8, 3: 8, 4: 8, 5: 8, 6: 4 }, 60);
    expect(cap[1]).toBe(60);
    expect(cap[6]).toBe(90);
    expect(cap[0]).toBe(120);
    // No timetable at all: every day gets the chosen minutes.
    expect(capacityFromTimetable({}, 60)).toEqual({ 0: 60, 1: 60, 2: 60, 3: 60, 4: 60, 5: 60, 6: 60 });
  });
});

const SAMPLES: Record<Exclude<StudyFormat, "quiz" | "flashcards">, unknown> = {
  quick_summary: { summary: "Light travels in straight lines.", keyPoints: ["Reflection", "Refraction", "Dispersion"] },
  revision_notes: { sections: [{ heading: "Reflection", points: ["Angle i = angle r"] }, { heading: "Refraction", points: ["Light bends"] }] },
  cheat_sheet: { items: Array.from({ length: 6 }, (_, i) => ({ label: `Fact ${i}`, detail: "Detail." })) },
  key_concepts: { concepts: Array.from({ length: 3 }, (_, i) => ({ name: `Concept ${i}`, explanation: "Why.", example: "Mirror." })) },
  glossary: { terms: Array.from({ length: 5 }, (_, i) => ({ term: `Term ${i}`, definition: "Meaning." })) },
  high_yield: { points: Array.from({ length: 5 }, (_, i) => ({ point: `Point ${i}`, why: "Often asked." })) },
  exam_notes: {
    likelyQuestions: Array.from({ length: 3 }, (_, i) => ({ question: `Q${i}?`, answerOutline: ["Step one"] })),
    commonMistakes: ["Mixing up i and r"],
  },
  one_page: { overview: "Light.", sections: [{ heading: "A", bullets: ["x"] }, { heading: "B", bullets: ["y"] }], remember: "Straight lines." },
  active_recall: { prompts: Array.from({ length: 5 }, (_, i) => ({ prompt: `Why ${i}?`, answer: "Because." })) },
};

describe("format content schemas", () => {
  it("lists ten summary formats plus quiz, each with its own model rules", () => {
    expect(STUDY_FORMATS).toHaveLength(11);
    expect(new Set(Object.values(FORMAT_RULES)).size).toBe(11);
  });

  it.each(Object.entries(SAMPLES))("%s: a well-formed draft is accepted; an extra key or an over-long field is refused", (format, sample) => {
    const f = format as StudyFormat;
    expect(generationSchema(f).safeParse(sample).success).toBe(true);
    expect(contentSchema(f).safeParse(sample).success).toBe(true);
    expect(generationSchema(f).safeParse({ ...(sample as object), injected: "x" }).success).toBe(false);
    const tooLong = JSON.parse(JSON.stringify(sample).replace(/"(Light travels in straight lines\.|Angle i = angle r|Detail\.|Why\.|Meaning\.|Often asked\.|Step one|Light\.|Because\.)"/, `"${"x".repeat(5000)}"`));
    expect(generationSchema(f).safeParse(tooLong).success).toBe(false);
  });

  it("generation enforces each format's minimum size; a saved (edited) copy may be shorter", () => {
    const short = { terms: [{ term: "Lens", definition: "Curved glass." }] };
    expect(generationSchema("glossary").safeParse(short).success).toBe(false);
    expect(contentSchema("glossary").safeParse(short).success).toBe(true);
    expect(contentSchema("glossary").safeParse({ terms: [] }).success).toBe(false);
  });

  it("flashcards: generated cards get unique ids; stored decks need unique ids", () => {
    const gen = { cards: Array.from({ length: 6 }, (_, i) => ({ front: `F${i}`, back: `B${i}` })) };
    const stored = toStoredContent("flashcards", gen, {});
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    const ids = (stored.content as { cards: { id: string }[] }).cards.map((c) => c.id);
    expect(new Set(ids).size).toBe(6);
    const dup = { cards: [{ id: "a", front: "x", back: "y" }, { id: "a", front: "x2", back: "y2" }] };
    expect(contentSchema("flashcards").safeParse(dup).success).toBe(false);
  });

  it("quiz: drops malformed or unrequested question types and caps the count", () => {
    const base = { options: [], answerIndex: -1, answerTrue: false, modelAnswer: "", rubric: [], explanation: "" };
    const gen = {
      questions: [
        { ...base, type: "mcq", stem: "Good MCQ", options: ["a", "b", "c", "d"], answerIndex: 2 },
        { ...base, type: "mcq", stem: "Duplicate options", options: ["a", "a", "c", "d"], answerIndex: 0 },
        { ...base, type: "mcq", stem: "Bad index", options: ["a", "b", "c", "d"], answerIndex: -1 },
        { ...base, type: "true_false", stem: "TF", answerTrue: true },
        { ...base, type: "short", stem: "No rubric", modelAnswer: "x" },
        { ...base, type: "short", stem: "Explain refraction", modelAnswer: "Bending of light", rubric: ["mentions bending"] },
      ],
    };
    const all = toStoredContent("quiz", gen, { quizTypes: ["mcq", "true_false", "short"], quizCount: 10, difficulty: "easy" });
    expect(all.ok).toBe(true);
    if (!all.ok) return;
    const qs = (all.content as { questions: { type: string; stem: string }[] }).questions;
    expect(qs.map((q) => q.stem)).toEqual(["Good MCQ", "TF", "Explain refraction"]);
    const mcqOnly = toStoredContent("quiz", gen, { quizTypes: ["mcq"], quizCount: 10, difficulty: "easy" });
    expect(mcqOnly.ok && (mcqOnly.content as { questions: unknown[] }).questions).toHaveLength(1);
    const capped = toStoredContent("quiz", gen, { quizTypes: ["mcq", "true_false", "short"], quizCount: 2, difficulty: "easy" });
    expect(capped.ok && (capped.content as { questions: unknown[] }).questions).toHaveLength(2);
    expect(toStoredContent("quiz", { questions: [{ ...base, type: "mcq", stem: "x", options: ["a"], answerIndex: 0 }] }, { quizTypes: ["mcq"], quizCount: 5, difficulty: "easy" }).ok).toBe(false);
  });
});

describe("quiz auto-marking", () => {
  const questions = [
    { type: "mcq" as const, stem: "2+2", options: ["1", "2", "3", "4"], answerIndex: 3, explanation: "" },
    { type: "true_false" as const, stem: "Sky is blue", answer: true, explanation: "" },
    { type: "short" as const, stem: "Why?", modelAnswer: "Because", rubric: ["reason"], explanation: "" },
    { type: "mcq" as const, stem: "1+1", options: ["1", "2", "3", "4"], answerIndex: 1, explanation: "" },
  ];

  it("marks MCQ and true/false automatically; short answers are left for the AI check", () => {
    const r = autoMark(questions, [3, false, "my answer", null]);
    expect(r.verdicts).toEqual(["correct", "incorrect", "ai_check", "unanswered"]);
    expect(r.autoScore).toBe(1);
    expect(r.autoMax).toBe(3);
    expect(r.shortCount).toBe(1);
  });

  it("an answer of the wrong kind for its question does not fit", () => {
    expect(answersFitQuestions(questions, [3, true, "text", 1])).toBe(true);
    expect(answersFitQuestions(questions, [true, true, "text", 1])).toBe(false);
    expect(answersFitQuestions(questions, [3, true, 2, 1])).toBe(false);
    expect(answersFitQuestions(questions, [3, true, "text"])).toBe(false);
    expect(answersFitQuestions(questions, [7, true, null, null])).toBe(false);
  });
});

describe("analytics and weak topics", () => {
  const row = (unitId: string, unitTitle: string, correct: number, total: number, at = "2026-11-10T10:00:00Z"): ScoredRow => ({
    at, subjectId: "s1", subjectName: "Science", unitId, unitTitle, correct, total,
  });

  it("accuracy by unit and subject sums questions, not attempts", () => {
    const rows = [row("u1", "Light", 2, 10), row("u1", "Light", 8, 10), row("u2", "Sound", 5, 5)];
    const units = accuracyBy(rows, "unit");
    expect(units.find((u) => u.id === "u1")).toMatchObject({ correct: 10, total: 20, percent: 50 });
    expect(accuracyBy(rows, "subject")).toEqual([{ id: "s1", label: "Science", subjectName: "Science", correct: 15, total: 25, percent: 60 }]);
  });

  it("a unit below 60% with at least 4 answered questions is weak; mastery gaps are added once, weakest first", () => {
    const rows = [row("u1", "Light", 1, 5), row("u2", "Sound", 3, 3), row("u3", "Motion", 1, 2)];
    const weak = weakTopics(accuracyBy(rows, "unit"), [
      { subject: "Science", topic: "Light", mastery_pct: 30 },
      { subject: "Science", topic: "Heat", mastery_pct: 45 },
    ]);
    expect(weak.map((w) => [w.label, w.source, w.percent])).toEqual([
      ["Light", "practice", 20],
      ["Heat", "mastery", 45],
    ]);
  });

  it("weekly accuracy buckets by IST week and leaves empty weeks null", () => {
    const now = new Date("2026-11-11T12:00:00Z");
    const weeks = weeklyAccuracy([row("u1", "Light", 3, 4, "2026-11-10T05:00:00Z"), row("u1", "Light", 1, 4, "2026-10-28T05:00:00Z")], 3, now);
    expect(weeks.map((w) => w.percent)).toEqual([25, null, 75]);
  });

  it("minutes by day totals study sessions per IST day over the window", () => {
    const now = new Date("2026-11-11T12:00:00Z");
    const days = minutesByDay([{ startedAt: "2026-11-10T20:00:00Z", minutes: 15 }, { startedAt: "2026-11-11T03:00:00Z", minutes: 10 }], 2, now);
    // 20:00Z on the 10th is 01:30 IST on the 11th.
    expect(days).toEqual([{ day: "2026-11-10", minutes: 0 }, { day: "2026-11-11", minutes: 25 }]);
  });
});

describe("teacher weak spots (counts and percentages only)", () => {
  const tf = (stem: string, answer: boolean) => ({ type: "true_false" as const, stem, answer, explanation: "" });
  const short = { type: "short" as const, stem: "Explain", modelAnswer: "x", rubric: ["x"], explanation: "" };

  it("question accuracy groups by question text across attempts, counts AI-checked shorts only when checked, weakest first", () => {
    const qs = [tf("A", true), tf("B", false), short];
    const rows = questionAccuracy([
      { questions: qs, answers: [true, true, "x"], aiChecks: [{ score: 2 }] },
      { questions: qs, answers: [true, false, "y"], aiChecks: [{ score: 0 }] },
      { questions: qs, answers: [false, null, "z"], aiChecks: [] },
    ]);
    expect(rows).toEqual([
      { stem: "B", percent: 50, answered: 2 },
      { stem: "Explain", percent: 50, answered: 2 },
      { stem: "A", percent: 67, answered: 3 },
    ]);
  });

  it("card lapses count students who missed a card at least once", () => {
    const cards = [{ id: "c1", front: "Lens" }, { id: "c2", front: "Mirror" }, { id: "c3", front: "Prism" }];
    expect(cardLapses(cards, [{ c1: { lapses: 2 }, c2: { lapses: 0 } }, { c1: { lapses: 1 }, c3: { lapses: 1 } }])).toEqual([
      { front: "Lens", students: 2 },
      { front: "Prism", students: 1 },
    ]);
  });
});
