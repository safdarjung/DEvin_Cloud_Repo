import { describe, expect, it } from "vitest";
import { multiplierForFrequency, previewInvoice, type ProrationComponent, type ProrationConcession } from "@/modules/finance/proration";

// 08 §2 Finance math: proration of monthly/quarterly components into terms,
// concession percent vs amount, rounding to paise. Parity against the real
// `app.generate_invoice` output is proven in tests/db/invoice-generation.test.ts.

describe("multiplierForFrequency (06 §W9 case statement)", () => {
  it("one_time applies only on the student's first-ever invoice", () => {
    expect(multiplierForFrequency("one_time", true, false)).toBe(1);
    expect(multiplierForFrequency("one_time", false, true)).toBe(0);
  });

  it("annual applies in Term 1 or at the first-ever invoice, never both terms", () => {
    expect(multiplierForFrequency("annual", true, false)).toBe(1); // first invoice, any term
    expect(multiplierForFrequency("annual", false, true)).toBe(1); // Term 1, not first invoice
    expect(multiplierForFrequency("annual", false, false)).toBe(0); // Term 2+, not first invoice
  });

  it("term always applies once; quarterly x2; monthly x6", () => {
    expect(multiplierForFrequency("term", false, false)).toBe(1);
    expect(multiplierForFrequency("quarterly", false, false)).toBe(2);
    expect(multiplierForFrequency("monthly", false, false)).toBe(6);
  });
});

describe("previewInvoice — concession math and rounding to paise", () => {
  it("applies a percent concession only to the matching head, rounded to 2dp", () => {
    const components: ProrationComponent[] = [
      { head: "tuition", amount: 10000, frequency: "term" },
      { head: "transport", amount: 1500, frequency: "term" },
    ];
    const concessions: ProrationConcession[] = [{ head: "tuition", percent: 20, amount: null }];

    const result = previewInvoice(components, concessions, false, false);

    expect(result.lines).toEqual([
      { head: "tuition", amount: 10000, concessionAmount: 2000 },
      { head: "transport", amount: 1500, concessionAmount: 0 },
    ]);
    expect(result.subtotal).toBe(11500);
    expect(result.concessionTotal).toBe(2000);
    expect(result.total).toBe(9500);
  });

  it("caps an amount concession at the line amount (least(amount, line))", () => {
    const components: ProrationComponent[] = [{ head: "exam", amount: 500, frequency: "term" }];
    const concessions: ProrationConcession[] = [{ head: "exam", percent: null, amount: 800 }];

    const result = previewInvoice(components, concessions, false, false);

    expect(result.lines[0]).toEqual({ head: "exam", amount: 500, concessionAmount: 500 });
    expect(result.total).toBe(0);
  });

  it("prorates a monthly component x6 for a term and rounds a fractional percent without float drift", () => {
    const components: ProrationComponent[] = [{ head: "transport", amount: 833.33, frequency: "monthly" }];
    const concessions: ProrationConcession[] = [{ head: "transport", percent: 33.33, amount: null }];

    const result = previewInvoice(components, concessions, false, false);

    // 833.33 * 6 = 4999.98; 4999.98 * 33.33 / 100 = 1666.493334 -> rounds to 1666.49
    expect(result.lines[0].amount).toBe(4999.98);
    expect(result.lines[0].concessionAmount).toBe(1666.49);
  });

  it("ignores a concession whose head matches no component (not summed into the total)", () => {
    const components: ProrationComponent[] = [{ head: "tuition", amount: 1000, frequency: "term" }];
    const concessions: ProrationConcession[] = [{ head: "transport", percent: 50, amount: null }];

    const result = previewInvoice(components, concessions, false, false);

    expect(result.concessionTotal).toBe(0);
    expect(result.total).toBe(1000);
  });

  it("skips a component whose multiplier is 0 for this invoice (annual, Term 2, not first invoice)", () => {
    const components: ProrationComponent[] = [{ head: "annual_charges", amount: 2000, frequency: "annual" }];

    const result = previewInvoice(components, [], false, false);

    expect(result.lines).toEqual([]);
    expect(result.total).toBe(0);
  });
});
