// DBT-160 — study language picker: schema accepts exactly the languages the study chat supports.
import { describe, expect, test } from "vitest";
import { UpdateStudyLanguageSchema } from "@/modules/ai/student-study.schemas";
import { STUDENT_LANGUAGES } from "@/modules/ai/prompts/student-skills";

describe("UpdateStudyLanguageSchema", () => {
  test.each(STUDENT_LANGUAGES.map((l) => [l.code]))("accepts supported language %s", (code) => {
    expect(UpdateStudyLanguageSchema.safeParse({ language: code }).success).toBe(true);
  });

  test("covers the twelve languages the study chat supports", () => {
    expect(STUDENT_LANGUAGES.map((l) => l.code).sort()).toEqual(
      ["bn", "en", "gu", "hi", "kn", "ml", "mixed", "mr", "or", "pa", "ta", "te"].sort(),
    );
  });

  test.each([[""], ["fr"], ["EN"], [undefined], [5]])("rejects unsupported language %s", (language) => {
    expect(UpdateStudyLanguageSchema.safeParse({ language }).success).toBe(false);
  });

  test("rejects extra fields", () => {
    expect(UpdateStudyLanguageSchema.safeParse({ language: "hi", myStyle: "x" }).success).toBe(false);
  });
});
