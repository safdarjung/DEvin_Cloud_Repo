import { describe, expect, it } from "vitest";
import { IncidentRecordSchema, UtilisationQuerySchema, BookingCreateSchema } from "../../src/modules/school-labs/schemas";

const U = "00000000-0000-4000-8000-000000000001";
const base = { labId: U, kind: "breakage", severity: "low", description: "Beaker broke" };

describe("IncidentRecordSchema cost", () => {
  it("parses rupees to integer paise", () => {
    expect(IncidentRecordSchema.parse({ ...base, cost: "250.5" }).costPaise).toBe(25050);
    expect(IncidentRecordSchema.parse({ ...base, cost: "0" }).costPaise).toBe(0);
  });
  it("treats empty or missing cost as none", () => {
    expect(IncidentRecordSchema.parse({ ...base, cost: "" }).costPaise).toBeUndefined();
    expect(IncidentRecordSchema.parse(base).costPaise).toBeUndefined();
  });
  it.each(["-5", "1,000", "1e3", "12.345", "abc", "007"])("rejects %s", (cost) => {
    expect(IncidentRecordSchema.safeParse({ ...base, cost }).success).toBe(false);
  });
});

describe("UtilisationQuerySchema", () => {
  it("rejects reversed and over-366-day ranges", () => {
    expect(UtilisationQuerySchema.safeParse({ from: "2026-11-10", to: "2026-11-01" }).success).toBe(false);
    expect(UtilisationQuerySchema.safeParse({ from: "2025-01-01", to: "2026-11-01" }).success).toBe(false);
    expect(UtilisationQuerySchema.safeParse({ from: "2026-10-01", to: "2026-11-01" }).success).toBe(true);
  });
});

describe("BookingCreateSchema", () => {
  it("rejects unknown keys", () => {
    expect(BookingCreateSchema.safeParse({ labId: U, classSectionId: U, subjectId: U, date: "2026-11-12", periodId: U, extra: 1 }).success).toBe(false);
  });
});
