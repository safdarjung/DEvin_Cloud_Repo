import { describe, expect, it } from "vitest";
import { HealthProfileSaveSchema, HealthVisitAddSchema, VaccinationAddSchema } from "@/modules/health/schemas";

const id = "11111111-1111-4111-8111-111111111111";

describe("health schemas", () => {
  it("accepts a profile with only a student id", () => {
    expect(HealthProfileSaveSchema.safeParse({ studentId: id }).success).toBe(true);
  });
  it("rejects an unknown blood group", () => {
    expect(HealthProfileSaveSchema.safeParse({ studentId: id, bloodGroup: "C+" }).success).toBe(false);
  });
  it("rejects allergies over 500 characters", () => {
    expect(HealthProfileSaveSchema.safeParse({ studentId: id, allergies: "x".repeat(501) }).success).toBe(false);
  });
  it("rejects unknown keys", () => {
    expect(HealthProfileSaveSchema.safeParse({ studentId: id, institutionId: id }).success).toBe(false);
  });
  it("defaults a visit outcome to returned_to_class and requires a complaint", () => {
    const ok = HealthVisitAddSchema.parse({ studentId: id, complaint: " Headache " });
    expect(ok.outcome).toBe("returned_to_class");
    expect(ok.complaint).toBe("Headache");
    expect(HealthVisitAddSchema.safeParse({ studentId: id, complaint: "  " }).success).toBe(false);
  });
  it("rejects an invalid visit outcome", () => {
    expect(HealthVisitAddSchema.safeParse({ studentId: id, complaint: "x", outcome: "died" }).success).toBe(false);
  });
  it("requires a vaccine name and a valid date", () => {
    expect(VaccinationAddSchema.safeParse({ studentId: id, vaccine: "MMR", administeredOn: "2026-01-05" }).success).toBe(true);
    expect(VaccinationAddSchema.safeParse({ studentId: id, vaccine: "MMR", administeredOn: "05/01/2026" }).success).toBe(false);
    expect(VaccinationAddSchema.safeParse({ studentId: id, vaccine: "", administeredOn: "2026-01-05" }).success).toBe(false);
  });
});
