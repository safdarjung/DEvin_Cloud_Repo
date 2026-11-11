import { describe, expect, test } from "vitest";
import { orbUrl, pageTitleFor, suggestionsFor } from "../../src/components/ask-ai/suggestions";

describe("suggestionsFor", () => {
  test("returns finance questions for a finance sub-route", () => {
    expect(suggestionsFor("/demo/finance/invoices")[0]).toBe("Who has fees overdue?");
  });
  test("returns attendance questions for the attendance page", () => {
    expect(suggestionsFor("/demo/attendance")[0]).toBe("Who was absent today?");
  });
  test("falls back to generic questions, capped at four", () => {
    const s = suggestionsFor("/demo/unknown-thing");
    expect(s.length).toBeGreaterThan(0);
    expect(s.length).toBeLessThanOrEqual(4);
  });
});

describe("pageTitleFor", () => {
  const items = [{ href: "/demo/exams", label: "Exams" }, { href: "/demo/exams/rechecks", label: "Rechecks" }];
  test("longest matching nav href wins", () => {
    expect(pageTitleFor("/demo/exams/rechecks/1", items)).toBe("Rechecks");
  });
  test("uses a neutral label when nothing matches", () => {
    expect(pageTitleFor("/demo/zzz", items)).toBe("this page");
  });
});

describe("orbUrl", () => {
  test("encodes from and question", () => {
    expect(orbUrl("demo", "/demo/finance", "a b&c")).toBe("/demo/orb?from=%2Fdemo%2Ffinance&q=a%20b%26c");
  });
  test("omits q when the question is blank", () => {
    expect(orbUrl("demo", "/demo/finance", "  ")).toBe("/demo/orb?from=%2Fdemo%2Ffinance");
  });
});
