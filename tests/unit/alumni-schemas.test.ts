import { describe, expect, it } from "vitest";
import { AlumniListSchema, AlumniUpdateSchema } from "../../src/modules/alumni/schemas";

const id = "11111111-1111-4111-8111-111111111111";

describe("AlumniUpdateSchema", () => {
  it("turns empty strings into null", () => {
    const r = AlumniUpdateSchema.parse({ id, contactEmail: "", contactPhone: "", occupation: " ", city: "" });
    expect(r).toEqual({ id, contactEmail: null, contactPhone: null, occupation: null, city: null });
  });
  it("accepts valid contact fields", () => {
    expect(AlumniUpdateSchema.safeParse({ id, contactEmail: "a@b.in", contactPhone: "9876543210", occupation: "Doctor", city: "Pune" }).success).toBe(true);
  });
  it("rejects bad phone and email", () => {
    expect(AlumniUpdateSchema.safeParse({ id, contactEmail: "x", contactPhone: "", occupation: "", city: "" }).success).toBe(false);
    expect(AlumniUpdateSchema.safeParse({ id, contactEmail: "", contactPhone: "12345", occupation: "", city: "" }).success).toBe(false);
  });
  it("rejects immutable fields", () => {
    expect(AlumniUpdateSchema.safeParse({ id, contactEmail: "", contactPhone: "", occupation: "", city: "", batchYear: 2020 }).success).toBe(false);
    expect(AlumniUpdateSchema.safeParse({ id, contactEmail: "", contactPhone: "", occupation: "", city: "", studentId: id }).success).toBe(false);
  });
});

describe("AlumniListSchema", () => {
  it("accepts filters and rejects unknown keys", () => {
    expect(AlumniListSchema.safeParse({ q: "a", batchYear: 2024, city: "Pune", page: 2 }).success).toBe(true);
    expect(AlumniListSchema.safeParse({ batchYear: 1800 }).success).toBe(false);
    expect(AlumniListSchema.safeParse({ x: 1 }).success).toBe(false);
  });
});
