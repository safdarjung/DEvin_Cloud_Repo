import { describe, it, expect } from "vitest";
import {
  QuestionTypeSchema,
  DifficultySchema,
  QuestionCreateSchema,
  QuestionUpdateSchema,
  QuestionArchiveSchema,
  QuestionListSchema,
} from "../../src/modules/question-bank/schemas.ts";

const validUuid = "550e8400-e29b-41d4-a716-446655440000";
const validGradeId = "550e8400-e29b-41d4-a716-446655440001";
const validSubjectId = "550e8400-e29b-41d4-a716-446655440002";

describe("QuestionTypeSchema", () => {
  it("accepts valid types", () => {
    expect(QuestionTypeSchema.parse("mcq")).toBe("mcq");
    expect(QuestionTypeSchema.parse("true_false")).toBe("true_false");
    expect(QuestionTypeSchema.parse("short_answer")).toBe("short_answer");
    expect(QuestionTypeSchema.parse("long_answer")).toBe("long_answer");
  });

  it("rejects invalid types", () => {
    expect(() => QuestionTypeSchema.parse("invalid")).toThrow();
  });
});

describe("DifficultySchema", () => {
  it("accepts valid difficulties", () => {
    expect(DifficultySchema.parse("easy")).toBe("easy");
    expect(DifficultySchema.parse("medium")).toBe("medium");
    expect(DifficultySchema.parse("hard")).toBe("hard");
  });

  it("rejects invalid difficulties", () => {
    expect(() => DifficultySchema.parse("impossible")).toThrow();
  });
});

describe("QuestionCreateSchema", () => {
  const validBase = {
    subjectId: validSubjectId,
    gradeId: validGradeId,
    type: "short_answer" as const,
    difficulty: "medium" as const,
    body: "What is 2+2?",
    answer: "4",
    marks: 1,
  };

  it("accepts valid short_answer question", () => {
    const result = QuestionCreateSchema.parse(validBase);
    expect(result.type).toBe("short_answer");
    expect(result.body).toBe("What is 2+2?");
  });

  it("rejects mcq without options", () => {
    const mcqNoOptions = {
      ...validBase,
      type: "mcq",
      answer: "Option A",
    };
    expect(() => QuestionCreateSchema.parse(mcqNoOptions)).toThrow();
  });

  it("accepts mcq with valid options", () => {
    const mcqWithOptions = {
      ...validBase,
      type: "mcq",
      options: ["Option A", "Option B", "Option C"],
      answer: "Option A",
    };
    const result = QuestionCreateSchema.parse(mcqWithOptions);
    expect(result.type === "mcq" && result.options).toEqual(["Option A", "Option B", "Option C"]);
  });

  it("rejects mcq answer not in options", () => {
    const mcqBadAnswer = {
      ...validBase,
      type: "mcq",
      options: ["A", "B", "C"],
      answer: "D",
    };
    expect(() => QuestionCreateSchema.parse(mcqBadAnswer)).toThrow();
  });

  it("rejects duplicate options", () => {
    const mcqDupOptions = {
      ...validBase,
      type: "mcq",
      options: ["A", "B", "A"],
      answer: "A",
    };
    expect(() => QuestionCreateSchema.parse(mcqDupOptions)).toThrow();
  });

  it("rejects true_false answer 'maybe'", () => {
    const tfInvalid = {
      ...validBase,
      type: "true_false",
      answer: "maybe",
    };
    expect(() => QuestionCreateSchema.parse(tfInvalid)).toThrow();
  });

  it("accepts true_false answer 'true' or 'false'", () => {
    const tfTrue = {
      ...validBase,
      type: "true_false",
      answer: "true",
    };
    const tfFalse = {
      ...validBase,
      type: "true_false",
      answer: "false",
    };
    expect(QuestionCreateSchema.parse(tfTrue).answer).toBe("true");
    expect(QuestionCreateSchema.parse(tfFalse).answer).toBe("false");
  });

  it("rejects options on long_answer", () => {
    const longAnswerWithOptions = {
      ...validBase,
      type: "long_answer",
      options: ["A", "B"],
      answer: "A long answer",
    };
    expect(() => QuestionCreateSchema.parse(longAnswerWithOptions)).toThrow();
  });

  it("rejects body > 4000 chars", () => {
    const longBody = {
      ...validBase,
      body: "x".repeat(4001),
    };
    expect(() => QuestionCreateSchema.parse(longBody)).toThrow();
  });

  it("rejects marks <= 0", () => {
    expect(() =>
      QuestionCreateSchema.parse({ ...validBase, marks: 0 })
    ).toThrow();
    expect(() =>
      QuestionCreateSchema.parse({ ...validBase, marks: -1 })
    ).toThrow();
  });

  it("rejects marks > 100", () => {
    expect(() =>
      QuestionCreateSchema.parse({ ...validBase, marks: 100.01 })
    ).toThrow();
  });

  it("accepts marks as decimal with 0.01 precision", () => {
    const result = QuestionCreateSchema.parse({
      ...validBase,
      marks: 2.5,
    });
    expect(result.marks).toBe(2.5);
  });

  it("rejects marks with improper decimal precision", () => {
    expect(() =>
      QuestionCreateSchema.parse({ ...validBase, marks: 2.555 })
    ).toThrow();
  });

  it("trims body and answer whitespace", () => {
    const result = QuestionCreateSchema.parse({
      ...validBase,
      body: "  What is 2+2?  ",
      answer: "  4  ",
    });
    expect(result.body).toBe("What is 2+2?");
    expect(result.answer).toBe("4");
  });

  it("allows optional curriculumUnitId", () => {
    const result = QuestionCreateSchema.parse({
      ...validBase,
      curriculumUnitId: validUuid,
    });
    expect(result.curriculumUnitId).toBe(validUuid);
  });

  it("allows curriculumUnitId as null", () => {
    const result = QuestionCreateSchema.parse({
      ...validBase,
      curriculumUnitId: null,
    });
    expect(result.curriculumUnitId).toBeNull();
  });

  it("rejects unknown keys in strict mode", () => {
    expect(() =>
      QuestionCreateSchema.parse({
        ...validBase,
        unknownField: "value",
      })
    ).toThrow();
  });

  it("rejects options as non-array for non-mcq", () => {
    expect(() =>
      QuestionCreateSchema.parse({
        ...validBase,
        options: "not an array",
      })
    ).toThrow();
  });

  it("rejects mcq with less than 2 options", () => {
    const mcqOneOption = {
      ...validBase,
      type: "mcq",
      options: ["A"],
      answer: "A",
    };
    expect(() => QuestionCreateSchema.parse(mcqOneOption)).toThrow();
  });

  it("rejects mcq with more than 6 options", () => {
    const mcqManyOptions = {
      ...validBase,
      type: "mcq",
      options: ["A", "B", "C", "D", "E", "F", "G"],
      answer: "A",
    };
    expect(() => QuestionCreateSchema.parse(mcqManyOptions)).toThrow();
  });

  it("rejects option text > 500 chars", () => {
    const badOption = {
      ...validBase,
      type: "mcq",
      options: ["A", "x".repeat(501)],
      answer: "A",
    };
    expect(() => QuestionCreateSchema.parse(badOption)).toThrow();
  });

  it("rejects answer text > 4000 chars", () => {
    const badAnswer = {
      ...validBase,
      answer: "x".repeat(4001),
    };
    expect(() => QuestionCreateSchema.parse(badAnswer)).toThrow();
  });
});

describe("QuestionUpdateSchema", () => {
  const validBase = {
    id: validUuid,
    subjectId: validSubjectId,
    gradeId: validGradeId,
    type: "short_answer" as const,
    difficulty: "medium" as const,
    body: "What is 2+2?",
    answer: "4",
    marks: 1,
  };

  it("requires id field", () => {
    const noId = {
      subjectId: validSubjectId,
      gradeId: validGradeId,
      type: "short_answer",
      difficulty: "medium",
      body: "What is 2+2?",
      answer: "4",
      marks: 1,
    };
    expect(() => QuestionUpdateSchema.parse(noId)).toThrow();
  });

  it("accepts valid update", () => {
    const result = QuestionUpdateSchema.parse(validBase);
    expect(result.id).toBe(validUuid);
  });

  it("enforces question rules on update (mcq answer validation)", () => {
    const mcqBadAnswer = {
      ...validBase,
      type: "mcq",
      options: ["A", "B"],
      answer: "C",
    };
    expect(() => QuestionUpdateSchema.parse(mcqBadAnswer)).toThrow();
  });

  it("rejects unknown keys in strict mode", () => {
    expect(() =>
      QuestionUpdateSchema.parse({
        ...validBase,
        unknownField: "value",
      })
    ).toThrow();
  });
});

describe("QuestionCreateSchema vs QuestionUpdateSchema parity", () => {
  // M11 security review fix round 1: create/update used to inline two
  // independent copies of the question rules. Diffing both schemas over
  // the same invalid variants guards against a future edit landing on one
  // copy and not the other.
  const createBase = {
    subjectId: validSubjectId,
    gradeId: validGradeId,
    type: "short_answer" as const,
    difficulty: "medium" as const,
    body: "What is 2+2?",
    answer: "4",
    marks: 1,
  };
  const updateBase = { ...createBase, id: validUuid };

  const invalidVariants = [
    { type: "mcq", answer: "A" }, // mcq without options
    { type: "mcq", options: ["A", "B", "C"], answer: "D" }, // answer not in options
    { type: "mcq", options: ["A", "B", "A"], answer: "A" }, // duplicate options
    { type: "mcq", options: ["A"], answer: "A" }, // too few options
    { type: "true_false", answer: "maybe" }, // invalid true/false answer
    { type: "long_answer", options: ["A", "B"] }, // options on non-mcq
  ];

  it.each(invalidVariants)("rejects the same invalid variant on both schemas: %j", (variant) => {
    const createResult = QuestionCreateSchema.safeParse({ ...createBase, ...variant });
    const updateResult = QuestionUpdateSchema.safeParse({ ...updateBase, ...variant });
    expect(createResult.success).toBe(false);
    expect(updateResult.success).toBe(false);
  });
});

describe("QuestionArchiveSchema", () => {
  it("accepts valid archive input", () => {
    const result = QuestionArchiveSchema.parse({
      id: validUuid,
      isActive: false,
    });
    expect(result.id).toBe(validUuid);
    expect(result.isActive).toBe(false);
  });

  it("requires id", () => {
    expect(() => QuestionArchiveSchema.parse({ isActive: false })).toThrow();
  });

  it("requires isActive boolean", () => {
    expect(() =>
      QuestionArchiveSchema.parse({ id: validUuid, isActive: "false" })
    ).toThrow();
  });

  it("rejects unknown keys in strict mode", () => {
    expect(() =>
      QuestionArchiveSchema.parse({
        id: validUuid,
        isActive: false,
        unknownField: "value",
      })
    ).toThrow();
  });
});

describe("QuestionListSchema", () => {
  it("accepts default values", () => {
    const result = QuestionListSchema.parse({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(50);
    expect(result.includeArchived).toBe(false);
  });

  it("accepts all filter fields", () => {
    const result = QuestionListSchema.parse({
      subjectId: validSubjectId,
      gradeId: validGradeId,
      curriculumUnitId: validUuid,
      type: "mcq",
      difficulty: "easy",
      includeArchived: true,
      page: 2,
      pageSize: 100,
    });
    expect(result.subjectId).toBe(validSubjectId);
    expect(result.page).toBe(2);
  });

  it("rejects page < 1", () => {
    expect(() => QuestionListSchema.parse({ page: 0 })).toThrow();
  });

  it("rejects pageSize < 1 or > 100", () => {
    expect(() => QuestionListSchema.parse({ pageSize: 0 })).toThrow();
    expect(() => QuestionListSchema.parse({ pageSize: 101 })).toThrow();
  });

  it("rejects unknown keys in strict mode", () => {
    expect(() =>
      QuestionListSchema.parse({
        unknownField: "value",
      })
    ).toThrow();
  });

  it("allows optional fields as undefined", () => {
    const result = QuestionListSchema.parse({
      subjectId: undefined,
      gradeId: undefined,
    });
    expect(result.subjectId).toBeUndefined();
  });
});
