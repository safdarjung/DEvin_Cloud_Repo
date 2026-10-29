import { describe, expect, it } from "vitest";
import { CreateExamPapersSchema, CreateExamSchema, EnterMarksSchema, ExamIdSchema } from "@/modules/exams/schemas";

const uuid1 = "11111111-1111-4111-8111-111111111111";
const uuid2 = "22222222-2222-4222-8222-222222222222";
const uuid3 = "33333333-3333-4333-8333-333333333333";

describe("ExamIdSchema", () => {
  it("accepts a bare examId", () => {
    expect(ExamIdSchema.safeParse({ examId: uuid1 }).success).toBe(true);
  });

  it("rejects unknown keys (.strict())", () => {
    expect(ExamIdSchema.safeParse({ examId: uuid1, extra: "x" }).success).toBe(false);
  });
});

describe("CreateExamSchema", () => {
  it("accepts a valid exam with a default gradingScaleKey", () => {
    const parsed = CreateExamSchema.safeParse({ termId: uuid1, name: "Unit Test 2", type: "unit_test" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.gradingScaleKey).toBe("default");
  });

  it("rejects an unknown exam type", () => {
    expect(CreateExamSchema.safeParse({ termId: uuid1, name: "X", type: "quiz" }).success).toBe(false);
  });

  it("rejects an empty name", () => {
    expect(CreateExamSchema.safeParse({ termId: uuid1, name: "", type: "unit_test" }).success).toBe(false);
  });
});

describe("CreateExamPapersSchema", () => {
  it("accepts papers with passMarks <= maxMarks", () => {
    const parsed = CreateExamPapersSchema.safeParse({
      examId: uuid1,
      papers: [{ classSectionId: uuid2, subjectId: uuid3, maxMarks: 80, passMarks: 26.4 }],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects passMarks greater than maxMarks", () => {
    const parsed = CreateExamPapersSchema.safeParse({
      examId: uuid1,
      papers: [{ classSectionId: uuid2, subjectId: uuid3, maxMarks: 80, passMarks: 90 }],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an empty papers array", () => {
    expect(CreateExamPapersSchema.safeParse({ examId: uuid1, papers: [] }).success).toBe(false);
  });
});

describe("EnterMarksSchema", () => {
  it("accepts a row with marksObtained and isAbsent=false", () => {
    const parsed = EnterMarksSchema.safeParse({
      examPaperId: uuid1,
      marks: [{ studentId: uuid2, marksObtained: 72, isAbsent: false }],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts an absent row with no marksObtained", () => {
    const parsed = EnterMarksSchema.safeParse({
      examPaperId: uuid1,
      marks: [{ studentId: uuid2, isAbsent: true }],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a row with both isAbsent and marksObtained", () => {
    const parsed = EnterMarksSchema.safeParse({
      examPaperId: uuid1,
      marks: [{ studentId: uuid2, marksObtained: 72, isAbsent: true }],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a row with neither isAbsent nor marksObtained", () => {
    const parsed = EnterMarksSchema.safeParse({
      examPaperId: uuid1,
      marks: [{ studentId: uuid2, isAbsent: false }],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects duplicate studentId rows", () => {
    const parsed = EnterMarksSchema.safeParse({
      examPaperId: uuid1,
      marks: [
        { studentId: uuid2, marksObtained: 10, isAbsent: false },
        { studentId: uuid2, isAbsent: true },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects more than 60 rows", () => {
    const marks = Array.from({ length: 61 }, (_, i) => ({
      studentId: `22222222-2222-4222-8222-${String(i).padStart(12, "0")}`,
      marksObtained: 10,
      isAbsent: false,
    }));
    expect(EnterMarksSchema.safeParse({ examPaperId: uuid1, marks }).success).toBe(false);
  });
});
