import { describe, expect, it } from "vitest";
import { PracticeGenerationSchema, PracticeQuizRequestSchema, SubmitAttemptSchema } from "@/modules/practice/schemas";
import { SendMessageSchema, StartThreadSchema } from "@/modules/messaging/schemas";
import { candidateQueries, GUARDIAN_QUERY_ALLOWLIST } from "@/modules/ai/assistant/tools";
import { ASSISTANT_QUERIES } from "@/modules/ai/assistant/catalog";

const U = "3f1c0f8e-6f0e-4d63-9d07-2f6c1b1b9a11";
const question = { stem: "Q?", options: ["a", "b", "c", "d"], answerIndex: 2 };

describe("SubmitAttemptSchema", () => {
  const base = { studentId: U, curriculumUnitId: U, difficulty: "easy", questions: [question], answers: [2] };

  it("accepts a valid attempt", () => {
    expect(SubmitAttemptSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a client-sent score (strict)", () => {
    expect(SubmitAttemptSchema.safeParse({ ...base, score: 1 }).success).toBe(false);
  });

  it("rejects mismatched answer length, bad index and >15 questions", () => {
    expect(SubmitAttemptSchema.safeParse({ ...base, answers: [] }).success).toBe(false);
    expect(SubmitAttemptSchema.safeParse({ ...base, answers: [4] }).success).toBe(false);
    expect(
      SubmitAttemptSchema.safeParse({ ...base, questions: Array(16).fill(question), answers: Array(16).fill(0) }).success,
    ).toBe(false);
  });

  it("allows skipped (null) answers", () => {
    expect(SubmitAttemptSchema.safeParse({ ...base, answers: [null] }).success).toBe(true);
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

describe("assistant tool candidates", () => {
  it("leader mode offers only aggregate catalog entries", () => {
    const names = candidateQueries("leader");
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(ASSISTANT_QUERIES[n].aggregate).toBe(true);
  });

  it("guardian mode offers only the allowlist, and every entry is a catalog entry", () => {
    const names = candidateQueries("guardian");
    for (const n of names) expect(GUARDIAN_QUERY_ALLOWLIST).toContain(n);
    for (const n of GUARDIAN_QUERY_ALLOWLIST) expect(ASSISTANT_QUERIES).toHaveProperty(n);
  });
});
