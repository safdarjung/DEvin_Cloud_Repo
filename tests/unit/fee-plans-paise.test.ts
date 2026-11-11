import { describe, expect, test } from "vitest";
import { paiseToRupeesText, rupeesTextToPaise, splitPaise } from "@/modules/fee-plans/paise";

describe("fee-plan paise helpers", () => {
  test("parses plain rupee text to paise without float error", () => {
    expect(rupeesTextToPaise("1500")).toBe(150000);
    expect(rupeesTextToPaise("0.1")).toBe(10);
    expect(rupeesTextToPaise("19.99")).toBe(1999);
  });
  test("rejects non-amounts", () => {
    for (const bad of ["", "-5", "1.234", "1e3", "abc", "1,000"]) expect(rupeesTextToPaise(bad)).toBeNull();
  });
  test("formats paise as rupee text", () => {
    expect(paiseToRupeesText(150005)).toBe("1500.05");
    expect(paiseToRupeesText(7)).toBe("0.07");
  });
  test("splits so parts sum exactly to the total", () => {
    const parts = splitPaise(100001, 3);
    expect(parts).toEqual([33334, 33334, 33333]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100001);
  });
});
