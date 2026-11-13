import { describe, expect, it } from "vitest";
import { escapeFormula, unescapeFormula } from "@/lib/http/csv-text";

describe("csv formula escaping", () => {
  it("escapes cells a spreadsheet would run as a formula", () => {
    expect(escapeFormula("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(escapeFormula("-5")).toBe("'-5");
    expect(escapeFormula("plain")).toBe("plain");
  });

  it("unescape reverses escape, so export -> import round-trips", () => {
    for (const v of ["=SUM(A1)", "+1", "-5|2", "@x", "plain", "it's", "'quoted"]) {
      expect(unescapeFormula(escapeFormula(v))).toBe(v);
    }
  });
});
