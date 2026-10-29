import { describe, expect, it } from "vitest";
import { moneyToPaise, paiseToMoney } from "@/modules/finance/queries";

// T-032 Fix round 1 (code review, MEDIUM — money float): proves summing
// money amounts through integer paise, in any order, never drifts the way
// summing `Number(...)` floats directly can.
describe("moneyToPaise / paiseToMoney", () => {
  it("parses a plain decimal string exactly", () => {
    expect(moneyToPaise("999.99")).toBe(99999);
    expect(moneyToPaise("0.10")).toBe(10);
    expect(moneyToPaise("0.20")).toBe(20);
  });

  it("round-trips back to the same rupee value", () => {
    expect(paiseToMoney(moneyToPaise("999.99"))).toBe(999.99);
    expect(paiseToMoney(moneyToPaise("0.10"))).toBe(0.1);
    expect(paiseToMoney(moneyToPaise("1000.00"))).toBe(1000);
  });

  it("sums 999.99 + 0.10 + 0.20 to the same result regardless of order", () => {
    const amounts = ["999.99", "0.10", "0.20"];
    const forward = amounts.reduce((sum, a) => sum + moneyToPaise(a), 0);
    const reversed = [...amounts].reverse().reduce((sum, a) => sum + moneyToPaise(a), 0);
    const shuffled = [amounts[1], amounts[2], amounts[0]].reduce((sum, a) => sum + moneyToPaise(a), 0);

    expect(forward).toBe(100029);
    expect(reversed).toBe(forward);
    expect(shuffled).toBe(forward);
    expect(paiseToMoney(forward)).toBe(1000.29);
  });

  it("matches the classic 0.1 + 0.2 float-drift case exactly in paise", () => {
    // Number("0.10") + Number("0.20") !== 0.30 in plain JS float math;
    // the paise sum must not inherit that drift.
    expect(moneyToPaise("0.10") + moneyToPaise("0.20")).toBe(30);
    expect(paiseToMoney(moneyToPaise("0.10") + moneyToPaise("0.20"))).toBe(0.3);
  });

  it("subtracts exactly for an outstanding-balance calculation", () => {
    const outstanding = paiseToMoney(moneyToPaise("10000.00") - moneyToPaise("3333.33"));
    expect(outstanding).toBe(6666.67);
  });

  it("handles negative amounts", () => {
    expect(moneyToPaise("-45.50")).toBe(-4550);
    expect(paiseToMoney(-4550)).toBe(-45.5);
  });

  it("accepts a number input (defensive — generated DB types say `number`, runtime is a string)", () => {
    expect(moneyToPaise(1000)).toBe(100000);
  });
});
