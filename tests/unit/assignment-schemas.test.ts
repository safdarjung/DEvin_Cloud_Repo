import { describe, expect, it } from "vitest";
import {
  CreateAssignmentSchema,
  PublishAssignmentSchema,
  QuizContentSchema,
  redactQuizAnswers,
  UpdateAssignmentSchema,
} from "@/modules/academics/assignments.schemas";

function validQuestion(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    stem: "2 + 2 = ?",
    options: ["3", "4", "5", "6"],
    answer: "4",
    ...overrides,
  };
}

describe("QuizContentSchema", () => {
  it("accepts a well-formed quiz", () => {
    const result = QuizContentSchema.safeParse({ questions: [validQuestion()] });
    expect(result.success).toBe(true);
  });

  it("rejects duplicate options", () => {
    const result = QuizContentSchema.safeParse({
      questions: [validQuestion({ options: ["4", "4", "5", "6"] })],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an answer that is not one of the options", () => {
    const result = QuizContentSchema.safeParse({
      questions: [validQuestion({ answer: "7" })],
    });
    expect(result.success).toBe(false);
  });

  it("rejects fewer or more than 4 options", () => {
    const result = QuizContentSchema.safeParse({
      questions: [validQuestion({ options: ["3", "4", "5"] })],
    });
    expect(result.success).toBe(false);
  });

  it("rejects more than 30 questions", () => {
    const result = QuizContentSchema.safeParse({
      questions: Array.from({ length: 31 }, () => validQuestion()),
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown keys (.strict())", () => {
    const result = QuizContentSchema.safeParse({
      questions: [validQuestion()],
      extra: "nope",
    });
    expect(result.success).toBe(false);
  });
});

describe("CreateAssignmentSchema", () => {
  const base = {
    classSectionId: "11111111-1111-4111-8111-111111111111",
    subjectId: "22222222-2222-4222-8222-222222222222",
    title: "Chapter 4 worksheet",
  };

  it("accepts the minimal required fields", () => {
    expect(CreateAssignmentSchema.safeParse(base).success).toBe(true);
  });

  it("accepts an attached quiz", () => {
    const result = CreateAssignmentSchema.safeParse({
      ...base,
      content: { questions: [validQuestion()] },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid attached quiz", () => {
    const result = CreateAssignmentSchema.safeParse({
      ...base,
      content: { questions: [validQuestion({ answer: "not-an-option" })] },
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown keys (.strict())", () => {
    const result = CreateAssignmentSchema.safeParse({ ...base, extra: "nope" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-uuid classSectionId", () => {
    const result = CreateAssignmentSchema.safeParse({ ...base, classSectionId: "not-a-uuid" });
    expect(result.success).toBe(false);
  });
});

describe("UpdateAssignmentSchema", () => {
  it("allows a partial update with just assignmentId", () => {
    const result = UpdateAssignmentSchema.safeParse({
      assignmentId: "33333333-3333-4333-8333-333333333333",
    });
    expect(result.success).toBe(true);
  });

  it("does not accept classSectionId/subjectId (immutable after creation)", () => {
    const result = UpdateAssignmentSchema.safeParse({
      assignmentId: "33333333-3333-4333-8333-333333333333",
      classSectionId: "11111111-1111-4111-8111-111111111111",
    });
    expect(result.success).toBe(false);
  });
});

describe("PublishAssignmentSchema", () => {
  it("requires assignmentId", () => {
    expect(PublishAssignmentSchema.safeParse({}).success).toBe(false);
  });

  it("accepts a valid uuid", () => {
    expect(
      PublishAssignmentSchema.safeParse({ assignmentId: "44444444-4444-4444-8444-444444444444" }).success,
    ).toBe(true);
  });
});

describe("redactQuizAnswers", () => {
  it("strips answer and explanation from every question, keeping stem and options", () => {
    const content = {
      questions: [
        validQuestion({ explanation: "Because 2 + 2 = 4." }),
        validQuestion({ stem: "1 + 1 = ?", options: ["1", "2", "3", "4"], answer: "2" }),
      ],
    };

    const redacted = redactQuizAnswers(content);

    expect(redacted.questions).toHaveLength(2);
    for (const [index, question] of redacted.questions.entries()) {
      expect(question.stem).toBe(content.questions[index].stem);
      expect(question.options).toEqual(content.questions[index].options);
      expect(question.answer).toBe("");
      expect(question.explanation).toBeUndefined();
      // "" never matches a real option, so no option can read back as correct.
      expect(question.options.includes(question.answer)).toBe(false);
    }
  });

  it("does not mutate the input", () => {
    const content = { questions: [validQuestion({ explanation: "why" })] };
    const original = JSON.parse(JSON.stringify(content));

    redactQuizAnswers(content);

    expect(content).toEqual(original);
  });
});
