import { describe, expect, it } from "vitest";
import { formatINR, roundPercent } from "@/modules/core/dashboard.queries";

describe("roundPercent", () => {
  it("rounds to 2 decimal places", () => {
    expect(roundPercent(66.66666666)).toBe(66.67);
    expect(roundPercent(100)).toBe(100);
  });

  it("does not drift on repeated division (float-drift case)", () => {
    expect(roundPercent((2 / 3) * 100)).toBe(66.67);
  });

  it("handles zero", () => {
    expect(roundPercent(0)).toBe(0);
  });
});

describe("formatINR", () => {
  it("formats whole-rupee paise with the INR symbol and grouping", () => {
    expect(formatINR(123456)).toBe("₹1,234.56");
  });

  it("formats zero", () => {
    expect(formatINR(0)).toBe("₹0.00");
  });

  it("formats large collections with Indian digit grouping", () => {
    expect(formatINR(1000000000)).toBe("₹1,00,00,000.00");
  });

  it("formats negative paise (e.g. a correction) with a leading minus", () => {
    expect(formatINR(-50000)).toBe("-₹500.00");
  });
});
