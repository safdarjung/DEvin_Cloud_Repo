import { describe, expect, it } from "vitest";
import { PracticeGenerationSchema, PracticeQuizRequestSchema, StartBankPracticeSchema, SubmitSessionSchema } from "@/modules/practice/schemas";
import { SendMessageSchema, StartThreadSchema } from "@/modules/messaging/schemas";

const U = "3f1c0f8e-6f0e-4d63-9d07-2f6c1b1b9a11";

describe("SubmitSessionSchema", () => {
  const base = { sessionId: U, answers: ["4", null, ["a", "c"], 9.8] };

  it("accepts answers in every item shape, with skips", () => {
    expect(SubmitSessionSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a client-sent score or key (strict)", () => {
    expect(SubmitSessionSchema.safeParse({ ...base, score: 1 }).success).toBe(false);
    expect(SubmitSessionSchema.safeParse({ ...base, questions: [{ answerIndex: 0 }] }).success).toBe(false);
  });

  it("rejects no answers, more than 15 and objects", () => {
    expect(SubmitSessionSchema.safeParse({ ...base, answers: [] }).success).toBe(false);
    expect(SubmitSessionSchema.safeParse({ ...base, answers: Array(16).fill("a") }).success).toBe(false);
    expect(SubmitSessionSchema.safeParse({ ...base, answers: [{ correct: true }] }).success).toBe(false);
  });
});

describe("StartBankPracticeSchema", () => {
  it("defaults to 10 questions of mixed difficulty and caps at 15", () => {
    expect(StartBankPracticeSchema.parse({ curriculumUnitId: U })).toEqual({ curriculumUnitId: U, count: 10 });
    expect(StartBankPracticeSchema.safeParse({ curriculumUnitId: U, count: 16 }).success).toBe(false);
    expect(StartBankPracticeSchema.safeParse({ curriculumUnitId: U, difficulty: "insane" }).success).toBe(false);
  });
});

describe("PracticeQuizRequestSchema", () => {
  it("caps count at 15 and rejects unknown difficulty", () => {
    const ok = { institutionSlug: "s", unitId: U, difficulty: "hard", count: 15 };
    expect(PracticeQuizRequestSchema.safeParse(ok).success).toBe(true);
    expect(PracticeQuizRequestSchema.safeParse({ ...ok, count: 16 }).success).toBe(false);
    expect(PracticeQuizRequestSchema.safeParse({ ...ok, difficulty: "insane" }).success).toBe(false);
  });
});

describe("PracticeGenerationSchema", () => {
  it("requires an explanation per question", () => {
    const withoutExplanation = { questions: [{ stem: "Q?", options: ["a", "b", "c", "d"], answer: "a" }] };
    expect(PracticeGenerationSchema.safeParse(withoutExplanation).success).toBe(false);
    const withExplanation = { questions: [{ ...withoutExplanation.questions[0], explanation: "Because." }] };
    expect(PracticeGenerationSchema.safeParse(withExplanation).success).toBe(true);
  });
});

describe("messaging schemas", () => {
  it("StartThreadSchema trims and bounds subject/body", () => {
    const ok = { studentId: U, counterpartId: U, subject: " Hi ", body: " Hello " };
    const parsed = StartThreadSchema.parse(ok);
    expect(parsed.subject).toBe("Hi");
    expect(StartThreadSchema.safeParse({ ...ok, body: "x".repeat(4001) }).success).toBe(false);
    expect(StartThreadSchema.safeParse({ ...ok, subject: "   " }).success).toBe(false);
    expect(StartThreadSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });

  it("SendMessageSchema rejects an empty body", () => {
    expect(SendMessageSchema.safeParse({ threadId: U, body: "  " }).success).toBe(false);
  });
});
