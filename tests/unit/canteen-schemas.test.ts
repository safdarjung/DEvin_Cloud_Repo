import { describe, expect, it } from "vitest";
import {
  CanteenDaySalesSchema,
  CanteenItemCreateSchema,
  CanteenItemUpdateSchema,
  CanteenPurchaseSchema,
  CanteenStatementSchema,
  CanteenTopupSchema,
} from "@/modules/canteen/schemas";

const id = "6f1c2a4e-1b2c-4d3e-8f4a-5b6c7d8e9f01";

describe("canteen schemas (features-18 #10)", () => {
  it("top-up accepts integer paise within ₹1..₹10,000 and rejects anything else", () => {
    expect(CanteenTopupSchema.safeParse({ studentId: id, amountPaise: 100 }).success).toBe(true);
    expect(CanteenTopupSchema.safeParse({ studentId: id, amountPaise: 1_000_000, note: "Cash at desk" }).success).toBe(true);
    for (const amountPaise of [99, 1_000_001, 0, -500, 150.5, Number.NaN]) {
      expect(CanteenTopupSchema.safeParse({ studentId: id, amountPaise }).success).toBe(false);
    }
  });

  it("top-up note is optional, trimmed and at most 120 characters", () => {
    const parsed = CanteenTopupSchema.parse({ studentId: id, amountPaise: 500, note: "  Monthly  " });
    expect(parsed.note).toBe("Monthly");
    expect(CanteenTopupSchema.safeParse({ studentId: id, amountPaise: 500, note: "x".repeat(121) }).success).toBe(false);
  });

  it("purchase quantity is an integer 1..20", () => {
    expect(CanteenPurchaseSchema.safeParse({ studentId: id, itemId: id, quantity: 1 }).success).toBe(true);
    expect(CanteenPurchaseSchema.safeParse({ studentId: id, itemId: id, quantity: 20 }).success).toBe(true);
    for (const quantity of [0, 21, 1.5, -1]) {
      expect(CanteenPurchaseSchema.safeParse({ studentId: id, itemId: id, quantity }).success).toBe(false);
    }
  });

  it("purchase refuses a caller-supplied price (price always comes from the item)", () => {
    expect(CanteenPurchaseSchema.safeParse({ studentId: id, itemId: id, quantity: 1, unitPricePaise: 1 }).success).toBe(false);
    expect(CanteenPurchaseSchema.safeParse({ studentId: id, itemId: id, quantity: 1, amountPaise: 1 }).success).toBe(false);
  });

  it("item price is integer paise 1..100000 and name 1..80 characters", () => {
    expect(CanteenItemCreateSchema.safeParse({ name: "Samosa", pricePaise: 1500 }).success).toBe(true);
    for (const pricePaise of [0, 100_001, 12.5]) {
      expect(CanteenItemCreateSchema.safeParse({ name: "Samosa", pricePaise }).success).toBe(false);
    }
    expect(CanteenItemCreateSchema.safeParse({ name: "   ", pricePaise: 1500 }).success).toBe(false);
    expect(CanteenItemCreateSchema.safeParse({ name: "x".repeat(81), pricePaise: 1500 }).success).toBe(false);
  });

  it("item update needs at least one field and never accepts institution or id changes beyond the target", () => {
    expect(CanteenItemUpdateSchema.safeParse({ id, isActive: false }).success).toBe(true);
    expect(CanteenItemUpdateSchema.safeParse({ id, pricePaise: 2000 }).success).toBe(true);
    expect(CanteenItemUpdateSchema.safeParse({ id }).success).toBe(false);
    expect(CanteenItemUpdateSchema.safeParse({ id, institutionId: id, isActive: true }).success).toBe(false);
  });

  it("query inputs: statement needs a student id, day sales takes an optional ISO date", () => {
    expect(CanteenStatementSchema.safeParse({ studentId: id }).success).toBe(true);
    expect(CanteenStatementSchema.safeParse({}).success).toBe(false);
    expect(CanteenDaySalesSchema.safeParse({}).success).toBe(true);
    expect(CanteenDaySalesSchema.safeParse({ date: "2026-11-10" }).success).toBe(true);
    expect(CanteenDaySalesSchema.safeParse({ date: "10/11/2026" }).success).toBe(false);
  });
});
