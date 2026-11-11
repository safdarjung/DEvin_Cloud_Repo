import { describe, expect, it } from "vitest";
import {
  componentTotals,
  PayrollRunGenerateSchema,
  PayrollRunIdSchema,
  PayslipGetSchema,
  SalaryStructureSaveSchema,
} from "@/modules/payroll/schemas";

// Features-18 #3 — payroll schemas mirror app.guard_salary_structures_write (0124).
const STAFF = "00000000-0000-4000-8000-000000000001";
const basic = { name: "Basic", kind: "earning", amountPaise: 3_000_000 } as const;
const advance = { name: "Advance recovery", kind: "deduction", amountPaise: 200_000 } as const;

describe("payroll schemas", () => {
  it("componentTotals sums earnings and deductions in integer paise", () => {
    expect(componentTotals([basic, { name: "HRA", kind: "earning", amountPaise: 1_200_000 }, advance])).toEqual({
      grossPaise: 4_200_000,
      deductionsPaise: 200_000,
      netPaise: 4_000_000,
    });
  });

  it("accepts a structure with earnings and a smaller deduction", () => {
    expect(SalaryStructureSaveSchema.safeParse({ staffId: STAFF, components: [basic, advance] }).success).toBe(true);
  });

  it("rejects a client-sent gross_paise (gross is computed server-side)", () => {
    expect(SalaryStructureSaveSchema.safeParse({ staffId: STAFF, components: [basic], grossPaise: 1 }).success).toBe(false);
  });

  it("rejects no earnings, deductions above earnings, empty and >20 components", () => {
    expect(SalaryStructureSaveSchema.safeParse({ staffId: STAFF, components: [advance] }).success).toBe(false);
    expect(
      SalaryStructureSaveSchema.safeParse({ staffId: STAFF, components: [basic, { ...advance, amountPaise: 3_000_001 }] }).success,
    ).toBe(false);
    expect(SalaryStructureSaveSchema.safeParse({ staffId: STAFF, components: [] }).success).toBe(false);
    expect(SalaryStructureSaveSchema.safeParse({ staffId: STAFF, components: Array(21).fill(basic) }).success).toBe(false);
  });

  it("rejects fractional, negative and oversized paise, and unknown component keys", () => {
    for (const amountPaise of [100.5, -1, 10_000_000_001]) {
      expect(SalaryStructureSaveSchema.safeParse({ staffId: STAFF, components: [{ ...basic, amountPaise }] }).success).toBe(false);
    }
    expect(SalaryStructureSaveSchema.safeParse({ staffId: STAFF, components: [{ ...basic, label: "x" }] }).success).toBe(false);
    expect(SalaryStructureSaveSchema.safeParse({ staffId: STAFF, components: [{ ...basic, name: " " }] }).success).toBe(false);
    expect(SalaryStructureSaveSchema.safeParse({ staffId: STAFF, components: [{ ...basic, name: "x".repeat(61) }] }).success).toBe(false);
  });

  it("run month is YYYY-MM; ids are uuids", () => {
    expect(PayrollRunGenerateSchema.safeParse({ month: "2026-10" }).success).toBe(true);
    for (const month of ["2026-13", "2026-1", "2026-10-01", ""]) expect(PayrollRunGenerateSchema.safeParse({ month }).success).toBe(false);
    expect(PayrollRunIdSchema.safeParse({ runId: STAFF }).success).toBe(true);
    expect(PayrollRunIdSchema.safeParse({ runId: "nope" }).success).toBe(false);
    expect(PayslipGetSchema.safeParse({ payslipId: STAFF, extra: 1 }).success).toBe(false);
  });
});
