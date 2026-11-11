import { describe, expect, test } from "vitest";
import { FormCreateSchema, FormRespondSchema, validateFormAnswers, type FormField } from "../../src/modules/forms/schemas";

const sec = crypto.randomUUID();
const base = { title: "Trip", classSectionIds: [sec] };
const text = { type: "text", label: "Name" } as const;

describe("FormCreateSchema", () => {
  test("accepts text, choice and consent fields", () => {
    const r = FormCreateSchema.safeParse({
      ...base,
      fields: [text, { type: "choice", label: "Meal", options: ["Veg", "Non-veg"] }, { type: "consent", label: "I agree", required: true }],
    });
    expect(r.success).toBe(true);
  });
  test("rejects 31 fields", () => {
    expect(FormCreateSchema.safeParse({ ...base, fields: Array.from({ length: 31 }, () => text) }).success).toBe(false);
  });
  test("rejects an empty field list", () => {
    expect(FormCreateSchema.safeParse({ ...base, fields: [] }).success).toBe(false);
  });
  test("rejects a label over 200 characters", () => {
    expect(FormCreateSchema.safeParse({ ...base, fields: [{ type: "text", label: "x".repeat(201) }] }).success).toBe(false);
  });
  test("rejects an unknown field type and stray keys", () => {
    expect(FormCreateSchema.safeParse({ ...base, fields: [{ type: "file", label: "x" }] }).success).toBe(false);
    expect(FormCreateSchema.safeParse({ ...base, fields: [{ type: "text", label: "x", options: ["a", "b"] }] }).success).toBe(false);
  });
  test("rejects choice with one option or duplicate options", () => {
    expect(FormCreateSchema.safeParse({ ...base, fields: [{ type: "choice", label: "x", options: ["a"] }] }).success).toBe(false);
    expect(FormCreateSchema.safeParse({ ...base, fields: [{ type: "choice", label: "x", options: ["a", "a"] }] }).success).toBe(false);
  });
});

describe("validateFormAnswers", () => {
  const fields: FormField[] = [
    { type: "consent", label: "Agree", required: true },
    { type: "choice", label: "Meal", options: ["Veg", "Non-veg"], required: true },
    { type: "text", label: "Notes" },
  ];
  test("passes a complete answer set", () => {
    expect(validateFormAnswers(fields, [true, 1, null])).toEqual({});
  });
  test("required consent must be true", () => {
    expect(validateFormAnswers(fields, [false, 0, null])[0]).toMatch(/consent/i);
  });
  test("required choice cannot be skipped and index must exist", () => {
    expect(validateFormAnswers(fields, [true, null, null])[1]).toBeDefined();
    expect(validateFormAnswers(fields, [true, 5, null])[1]).toBeDefined();
  });
  test("text over 500 characters is refused", () => {
    expect(validateFormAnswers(fields, [true, 0, "x".repeat(501)])[2]).toBeDefined();
  });
});

describe("FormRespondSchema", () => {
  test("allows a null studentId (teacher) and rejects non-uuid form ids", () => {
    expect(FormRespondSchema.safeParse({ formId: crypto.randomUUID(), studentId: null, answers: ["x"] }).success).toBe(true);
    expect(FormRespondSchema.safeParse({ formId: "nope", studentId: null, answers: ["x"] }).success).toBe(false);
  });
});
