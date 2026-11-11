import { describe, expect, it } from "vitest";
import { redact } from "@/lib/ai/redact";

describe("redact", () => {
  it("redacts Indian phone numbers", () => {
    const { text, count } = redact("Call the parent at 9876543210 today.");
    expect(text).toBe("Call the parent at [REDACTED_PHONE] today.");
    expect(count).toBe(1);
  });

  it("redacts email addresses", () => {
    const { text, count } = redact("Contact guardian@example.com for details.");
    expect(text).toBe("Contact [REDACTED_EMAIL] for details.");
    expect(count).toBe(1);
  });

  it("redacts 12-digit numbers (Aadhaar-like)", () => {
    const { text, count } = redact("ID on file: 123456789012.");
    expect(text).toBe("ID on file: [REDACTED_ID].");
    expect(count).toBe(1);
  });

  it("redacts names from the deny list, case-insensitively, whole-word only", () => {
    const { text, count } = redact("priya Sharma submitted the assignment late.", ["Priya Sharma"]);
    expect(text).toBe("[REDACTED_NAME] submitted the assignment late.");
    expect(count).toBe(1);
  });

  it("does not touch text with none of the patterns", () => {
    const { text, count } = redact("The unit covers photosynthesis for grade VI.");
    expect(text).toBe("The unit covers photosynthesis for grade VI.");
    expect(count).toBe(0);
  });

  it.each([
    ["spaced Aadhaar", "1234 5678 9012"],
    ["dashed Aadhaar", "1234-5678-9012"],
    ["5-5 spaced phone", "98765 43210"],
    ["4-3-3 dashed phone", "9876-543-210"],
    ["0-prefixed phone", "09876543210"],
    ["+91 spaced phone", "+91 98765 43210"],
    ["+91 contiguous phone", "+919876543210"],
  ])("redacts %s formatting with no digits left behind", (_label, value) => {
    const { text, count } = redact(`Call ${value} now.`);
    expect(count).toBe(1);
    expect(text).not.toMatch(/\d/);
  });

  it("leaves ordinary small numbers alone", () => {
    const { count } = redact("Class 10 has 42 students in 2026; unit 3 has 4 lessons.");
    expect(count).toBe(0);
  });

  it("leaves money amounts that are JSON numbers in tool results alone (paise totals looked like phones)", () => {
    const json = '{"duePaise":7360000000,"collectedPaise":[6123456789,9876543210]}';
    expect(redact(json)).toEqual({ text: json, count: 0 });
  });

  it("still redacts a phone or Aadhaar written as a JSON string", () => {
    const { text, count } = redact('{"phone":"9876543210","aadhaar":"123456789012"}');
    expect(count).toBe(2);
    expect(text).not.toMatch(/\d{4}/);
  });

  it("counts multiple redactions across types", () => {
    const { count } = redact("Reach 9876543210 or guardian@example.com; ref 123456789012.", ["Priya"]);
    expect(count).toBe(3);
  });
});
