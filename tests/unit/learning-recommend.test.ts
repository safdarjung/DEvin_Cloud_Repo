import { describe, expect, it } from "vitest";
import { revisionList, sectionGaps, weakAreas, type LearningNames, type MasteryRow, type TopicRow } from "@/modules/learning/recommend";

const names: LearningNames = {
  units: new Map([
    ["u1", { title: "Fractions", subjectId: "s1" }],
    ["u2", { title: "Decimals", subjectId: "s1" }],
  ]),
  topics: new Map([
    ["t1", { title: "Adding fractions", unitId: "u1", parentId: null }],
    ["t1a", { title: "Like denominators", unitId: "u1", parentId: "t1" }],
    ["t2", { title: "Comparing fractions", unitId: "u1", parentId: null }],
  ]),
};

const row = (over: Partial<TopicRow>): TopicRow => ({
  studentId: "st1",
  subjectId: "s1",
  unitId: "u1",
  topicId: null,
  items: 5,
  awarded: 5,
  maxMarks: 5,
  tests: 1,
  practice: 0,
  lastOn: "2026-11-10",
  ...over,
});

describe("weakAreas", () => {
  it("flags a topic below 60% with at least 3 questions and recommends bank practice, summary and search", () => {
    const out = weakAreas([row({ topicId: "t1", items: 4, awarded: 1, maxMarks: 4 })], [], [{ unitId: "u1", topicId: "t1", available: 6 }], names);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      unitId: "u1",
      topicId: "t1",
      topicTitle: "Adding fractions",
      percent: 25,
      evidence: { questions: 4, tests: 1, practice: 0, masteryPercent: null },
      next: { practice: "bank", bankQuestions: 6, summaryUnitId: "u1", searchQuery: "Adding fractions" },
    });
  });

  it("ignores a weak topic with fewer than 3 questions (not enough evidence)", () => {
    expect(weakAreas([row({ topicId: "t1", items: 2, awarded: 0, maxMarks: 2 })], [], [], names)).toEqual([]);
  });

  it("counts bank questions of subtopics towards their topic", () => {
    const out = weakAreas(
      [row({ topicId: "t1", items: 3, awarded: 0, maxMarks: 3 })],
      [],
      [
        { unitId: "u1", topicId: "t1", available: 2 },
        { unitId: "u1", topicId: "t1a", available: 3 },
        { unitId: "u1", topicId: "t2", available: 9 },
      ],
      names,
    );
    expect(out[0]!.next.bankQuestions).toBe(5);
  });

  it("falls back to AI practice when the bank has no questions for the area", () => {
    const out = weakAreas([row({ topicId: "t1", items: 3, awarded: 0, maxMarks: 3 })], [], [], names);
    expect(out[0]!.next).toMatchObject({ practice: "ai", bankQuestions: 0 });
  });

  it("flags a unit from a confident low mastery snapshot even without question data", () => {
    const mastery: MasteryRow[] = [{ studentId: "st1", subjectId: "s1", unitId: "u2", score: 0.4, confidence: 0.75, markCount: 1, submissionCount: 0, testCount: 1 }];
    const out = weakAreas([], mastery, [{ unitId: "u2", topicId: null, available: 4 }], names);
    expect(out).toEqual([
      expect.objectContaining({ unitId: "u2", topicId: null, unitTitle: "Decimals", percent: 40, evidence: expect.objectContaining({ masteryPercent: 40 }) }),
    ]);
    expect(out[0]!.next).toMatchObject({ practice: "bank", bankQuestions: 4, searchQuery: "Decimals" });
  });

  it("ignores a low snapshot with low confidence", () => {
    const mastery: MasteryRow[] = [{ studentId: "st1", subjectId: "s1", unitId: "u2", score: 0.2, confidence: 0.25, markCount: 0, submissionCount: 1, testCount: 0 }];
    expect(weakAreas([], mastery, [], names)).toEqual([]);
  });

  it("does not repeat a unit whose weak topic is already listed; weakest first", () => {
    const out = weakAreas(
      [
        row({ topicId: "t1", items: 4, awarded: 2, maxMarks: 4 }),
        row({ topicId: "t2", items: 4, awarded: 1, maxMarks: 4 }),
        row({ unitId: "u2", topicId: null, items: 3, awarded: 3, maxMarks: 3 }),
      ],
      [{ studentId: "st1", subjectId: "s1", unitId: "u1", score: 0.3, confidence: 1, markCount: 2, submissionCount: 0, testCount: 0 }],
      [],
      names,
    );
    expect(out.map((w) => w.topicId)).toEqual(["t2", "t1"]);
  });

  it("a strong unit is never recommended", () => {
    expect(weakAreas([row({ items: 10, awarded: 9, maxMarks: 10 })], [], [], names)).toEqual([]);
  });
});

describe("sectionGaps", () => {
  it("averages students per unit and topic and counts students below the threshold", () => {
    const rows = [
      row({ studentId: "a", topicId: "t1", items: 4, awarded: 1, maxMarks: 4 }),
      row({ studentId: "b", topicId: "t1", items: 4, awarded: 4, maxMarks: 4 }),
      row({ studentId: "b", topicId: null, items: 2, awarded: 2, maxMarks: 2 }),
    ];
    const gaps = sectionGaps(rows, [], names);
    expect(gaps.topics).toEqual([expect.objectContaining({ unitId: "u1", topicId: "t1", students: 2, averagePercent: 62.5, weakStudents: 1 })]);
    // a: 1/4 = 25%, b: 6/6 = 100% → 62.5
    expect(gaps.units).toEqual([expect.objectContaining({ unitId: "u1", students: 2, averagePercent: 62.5, weakStudents: 1, masteryAverage: null })]);
  });

  it("counts confident mastery as unit evidence, like the revision list does", () => {
    const mastery: MasteryRow[] = [
      { studentId: "a", subjectId: "s1", unitId: "u2", score: 0.5, confidence: 1, markCount: 1, submissionCount: 0, testCount: 0 },
      { studentId: "b", subjectId: "s1", unitId: "u2", score: 0.7, confidence: 1, markCount: 1, submissionCount: 0, testCount: 0 },
      { studentId: "c", subjectId: "s1", unitId: "u2", score: 0.1, confidence: 0.2, markCount: 1, submissionCount: 0, testCount: 0 },
    ];
    const gaps = sectionGaps([], mastery, names);
    expect(gaps.units).toEqual([expect.objectContaining({ unitId: "u2", masteryAverage: 43.3, students: 2, averagePercent: 60, weakStudents: 1 })]);
    const revision = revisionList([], mastery, names, new Map());
    expect(revision.filter((s) => s.areas.some((a) => a.unitId === "u2")).length).toBe(gaps.units[0]!.weakStudents);
  });
});

describe("revisionList", () => {
  it("lists only students with a weak area, most weak areas first", () => {
    const rows = [
      row({ studentId: "a", topicId: "t1", items: 4, awarded: 0, maxMarks: 4 }),
      row({ studentId: "a", topicId: "t2", items: 4, awarded: 1, maxMarks: 4 }),
      row({ studentId: "b", topicId: "t1", items: 4, awarded: 1, maxMarks: 4 }),
      row({ studentId: "c", topicId: "t1", items: 4, awarded: 4, maxMarks: 4 }),
    ];
    const out = revisionList(rows, [], names, new Map([["a", "Asha"], ["b", "Bilal"], ["c", "Chitra"]]));
    expect(out.map((s) => [s.studentName, s.areas.length])).toEqual([["Asha", 2], ["Bilal", 1]]);
  });
});
