// src/lib/format.ts formatINR — the one server-side formatter for money a
// model sees: integer paise in, rupee display text out, Indian grouping,
// paise shown only when non-zero.
import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatINR } from "@/lib/format";

describe("formatINR (integer paise -> rupee text)", () => {
  it("formats zero as ₹0", () => {
    expect(formatINR(0)).toBe("₹0");
  });

  it("drops .00 for whole rupees and keeps a paise remainder", () => {
    expect(formatINR(1_250_000)).toBe("₹12,500");
    expect(formatINR(150)).toBe("₹1.50");
    expect(formatINR(5)).toBe("₹0.05");
    expect(formatINR(2_963_535_005)).toBe("₹2,96,35,350.05");
  });

  it("groups lakhs and crores the Indian way", () => {
    expect(formatINR(10_000_000)).toBe("₹1,00,000");
    expect(formatINR(1_000_000_000)).toBe("₹1,00,00,000");
    // The demo term's dashboard figures (term_collection_totals).
    expect(formatINR(2_963_535_000)).toBe("₹2,96,35,350");
    expect(formatINR(5_893_874_000)).toBe("₹5,89,38,740");
  });

  it("keeps the sign on negatives", () => {
    expect(formatINR(-123_450)).toBe("-₹1,234.50");
    expect(formatINR(-1_000_000_000)).toBe("-₹1,00,00,000");
  });
});

it("formats dates and timestamps in one en-IN style", () => {
  expect(formatDate("2026-10-11")).toBe("11 Oct 2026");
  expect(formatDateTime("2026-11-20T12:30:00Z")).toBe("20 Nov 2026, 6:00 pm");
});
