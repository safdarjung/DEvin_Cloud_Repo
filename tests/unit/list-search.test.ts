import { describe, expect, test } from "vitest";
import { escapeIlike, ilikeTerm, pageRange, parsePage, quoteOrValue } from "../../src/lib/list-search";

describe("list-search", () => {
  test("escapeIlike escapes wildcards so they match literally", () => {
    expect(escapeIlike("100%_a")).toBe("100\\%\\_a");
  });
  test("quoteOrValue keeps commas and parens from splitting an or() filter", () => {
    expect(quoteOrValue('Smith, "J" (x)')).toBe('"Smith, \\"J\\" (x)"');
  });
  test("ilikeTerm wraps trimmed term in wildcards", () => {
    expect(ilikeTerm("  ab ")).toBe('"%ab%"');
  });
  test("parsePage falls back to 1 for junk, zero and negatives", () => {
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage("abc")).toBe(1);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-3")).toBe(1);
    expect(parsePage("3")).toBe(3);
  });
  test("pageRange returns inclusive bounds", () => {
    expect(pageRange(1, 50)).toEqual([0, 49]);
    expect(pageRange(3, 50)).toEqual([100, 149]);
  });
});
