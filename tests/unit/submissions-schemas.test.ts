import { describe, it, expect } from "vitest";
import {
  SubmitAssignmentSchema,
  GradeSubmissionSchema,
  SubmissionsForAssignmentSchema,
  MySubmissionsSchema,
  type SubmitAssignmentInput,
  type GradeSubmissionInput,
  type SubmissionsForAssignmentInput,
  type MySubmissionsInput,
} from "@/modules/academics/submissions.schemas";

describe("Submission schemas", () => {
  describe("SubmitAssignmentSchema", () => {
    it("parses valid input with assignmentId and text", () => {
      const input = {
        assignmentId: "550e8400-e29b-41d4-a716-446655440000",
        text: "My homework submission",
      };
      const result = SubmitAssignmentSchema.parse(input);
      expect(result).toEqual(input);
    });

    it("parses valid input with assignmentId and answers", () => {
      const input = {
        assignmentId: "550e8400-e29b-41d4-a716-446655440000",
        answers: ["answer1", "answer2", "answer3"],
      };
      const result = SubmitAssignmentSchema.parse(input);
      expect(result).toEqual(input);
    });

    it("parses valid input with assignmentId only", () => {
      const input = {
        assignmentId: "550e8400-e29b-41d4-a716-446655440000",
      };
      const result = SubmitAssignmentSchema.parse(input);
      expect(result).toEqual(input);
    });

    it("trims text whitespace", () => {
      const input = {
        assignmentId: "550e8400-e29b-41d4-a716-446655440000",
        text: "  hello world  ",
      };
      const result = SubmitAssignmentSchema.parse(input);
      expect(result.text).toBe("hello world");
    });

    it("rejects text > 5000 characters", () => {
      const input = {
        assignmentId: "550e8400-e29b-41d4-a716-446655440000",
        text: "a".repeat(5001),
      };
      expect(() => SubmitAssignmentSchema.parse(input)).toThrow();
    });

    it("rejects > 30 answers", () => {
      const input = {
        assignmentId: "550e8400-e29b-41d4-a716-446655440000",
        answers: Array.from({ length: 31 }, (_, i) => `answer${i}`),
      };
      expect(() => SubmitAssignmentSchema.parse(input)).toThrow();
    });

    it("rejects answer > 500 characters", () => {
      const input = {
        assignmentId: "550e8400-e29b-41d4-a716-446655440000",
        answers: ["a".repeat(501)],
      };
      expect(() => SubmitAssignmentSchema.parse(input)).toThrow();
    });

    it("rejects invalid UUID", () => {
      const input = {
        assignmentId: "not-a-uuid",
        text: "submission",
      };
      expect(() => SubmitAssignmentSchema.parse(input)).toThrow();
    });

    it("rejects unknown keys with .strict()", () => {
      const input = {
        assignmentId: "550e8400-e29b-41d4-a716-446655440000",
        text: "submission",
        extraKey: "should fail",
      };
      expect(() => SubmitAssignmentSchema.parse(input)).toThrow();
    });
  });

  describe("GradeSubmissionSchema", () => {
    it("parses valid input", () => {
      const input = {
        submissionId: "550e8400-e29b-41d4-a716-446655440000",
        score: 8.5,
        maxScore: 10,
      };
      const result = GradeSubmissionSchema.parse(input);
      expect(result).toEqual(input);
    });

    it("parses valid input with feedback", () => {
      const input = {
        submissionId: "550e8400-e29b-41d4-a716-446655440000",
        score: 9,
        maxScore: 10,
        feedback: "Great work!",
      };
      const result = GradeSubmissionSchema.parse(input);
      expect(result).toEqual(input);
    });

    it("trims feedback whitespace", () => {
      const input = {
        submissionId: "550e8400-e29b-41d4-a716-446655440000",
        score: 10,
        maxScore: 10,
        feedback: "  Good job  ",
      };
      const result = GradeSubmissionSchema.parse(input);
      expect(result.feedback).toBe("Good job");
    });

    it("allows score 0", () => {
      const input = {
        submissionId: "550e8400-e29b-41d4-a716-446655440000",
        score: 0,
        maxScore: 10,
      };
      const result = GradeSubmissionSchema.parse(input);
      expect(result.score).toBe(0);
    });

    it("rejects score > maxScore with path 'score'", () => {
      const input = {
        submissionId: "550e8400-e29b-41d4-a716-446655440000",
        score: 11,
        maxScore: 10,
      };
      const result = GradeSubmissionSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        const scorePath = result.error.issues.find((issue) =>
          issue.path.includes("score")
        );
        expect(scorePath).toBeDefined();
      }
    });

    it("rejects maxScore 0", () => {
      const input = {
        submissionId: "550e8400-e29b-41d4-a716-446655440000",
        score: 0,
        maxScore: 0,
      };
      expect(() => GradeSubmissionSchema.parse(input)).toThrow();
    });

    it("rejects maxScore > 1000", () => {
      const input = {
        submissionId: "550e8400-e29b-41d4-a716-446655440000",
        score: 500,
        maxScore: 1001,
      };
      expect(() => GradeSubmissionSchema.parse(input)).toThrow();
    });

    it("rejects negative score", () => {
      const input = {
        submissionId: "550e8400-e29b-41d4-a716-446655440000",
        score: -1,
        maxScore: 10,
      };
      expect(() => GradeSubmissionSchema.parse(input)).toThrow();
    });

    it("rejects feedback > 2000 characters", () => {
      const input = {
        submissionId: "550e8400-e29b-41d4-a716-446655440000",
        score: 5,
        maxScore: 10,
        feedback: "a".repeat(2001),
      };
      expect(() => GradeSubmissionSchema.parse(input)).toThrow();
    });

    it("rejects invalid submission UUID", () => {
      const input = {
        submissionId: "invalid",
        score: 5,
        maxScore: 10,
      };
      expect(() => GradeSubmissionSchema.parse(input)).toThrow();
    });

    it("rejects unknown keys with .strict()", () => {
      const input = {
        submissionId: "550e8400-e29b-41d4-a716-446655440000",
        score: 8,
        maxScore: 10,
        extraKey: "should fail",
      };
      expect(() => GradeSubmissionSchema.parse(input)).toThrow();
    });
  });

  describe("SubmissionsForAssignmentSchema", () => {
    it("parses valid input with assignmentId", () => {
      const input = {
        assignmentId: "550e8400-e29b-41d4-a716-446655440000",
      };
      const result = SubmissionsForAssignmentSchema.parse(input);
      expect(result).toEqual(input);
    });

    it("rejects invalid UUID", () => {
      const input = {
        assignmentId: "not-a-uuid",
      };
      expect(() => SubmissionsForAssignmentSchema.parse(input)).toThrow();
    });

    it("rejects unknown keys with .strict()", () => {
      const input = {
        assignmentId: "550e8400-e29b-41d4-a716-446655440000",
        extraKey: "should fail",
      };
      expect(() => SubmissionsForAssignmentSchema.parse(input)).toThrow();
    });
  });

  describe("MySubmissionsSchema", () => {
    it("parses empty input", () => {
      const input = {};
      const result = MySubmissionsSchema.parse(input);
      expect(result).toEqual(input);
    });

    it("parses input with studentId", () => {
      const input = {
        studentId: "550e8400-e29b-41d4-a716-446655440000",
      };
      const result = MySubmissionsSchema.parse(input);
      expect(result).toEqual(input);
    });

    it("rejects invalid UUID", () => {
      const input = {
        studentId: "not-a-uuid",
      };
      expect(() => MySubmissionsSchema.parse(input)).toThrow();
    });

    it("rejects unknown keys with .strict()", () => {
      const input = {
        studentId: "550e8400-e29b-41d4-a716-446655440000",
        extraKey: "should fail",
      };
      expect(() => MySubmissionsSchema.parse(input)).toThrow();
    });
  });

  describe("Type inference", () => {
    it("infers SubmitAssignmentInput type correctly", () => {
      const input: SubmitAssignmentInput = {
        assignmentId: "550e8400-e29b-41d4-a716-446655440000",
        text: "submission",
      };
      expect(input).toBeDefined();
    });

    it("infers GradeSubmissionInput type correctly", () => {
      const input: GradeSubmissionInput = {
        submissionId: "550e8400-e29b-41d4-a716-446655440000",
        score: 8,
        maxScore: 10,
      };
      expect(input).toBeDefined();
    });

    it("infers SubmissionsForAssignmentInput type correctly", () => {
      const input: SubmissionsForAssignmentInput = {
        assignmentId: "550e8400-e29b-41d4-a716-446655440000",
      };
      expect(input).toBeDefined();
    });

    it("infers MySubmissionsInput type correctly", () => {
      const input: MySubmissionsInput = {
        studentId: "550e8400-e29b-41d4-a716-446655440000",
      };
      expect(input).toBeDefined();
    });
  });
});
