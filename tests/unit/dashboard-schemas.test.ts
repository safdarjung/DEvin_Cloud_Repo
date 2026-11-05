import { describe, it, expect } from "vitest";
import { AttendanceTrendSchema, PortalDashboardSchema } from "../../src/modules/core/dashboard.schemas";

describe("AttendanceTrendSchema", () => {
  it("parses empty object with default days=30", () => {
    const result = AttendanceTrendSchema.parse({});
    expect(result.days).toBe(30);
  });

  it("accepts days in range 7-92", () => {
    expect(AttendanceTrendSchema.parse({ days: 7 }).days).toBe(7);
    expect(AttendanceTrendSchema.parse({ days: 92 }).days).toBe(92);
    expect(AttendanceTrendSchema.parse({ days: 30 }).days).toBe(30);
  });

  it("rejects days < 7", () => {
    expect(() => AttendanceTrendSchema.parse({ days: 6 })).toThrow();
  });

  it("rejects days > 92", () => {
    expect(() => AttendanceTrendSchema.parse({ days: 93 })).toThrow();
  });

  it("accepts classSectionId when studentId is absent", () => {
    const testId = "550e8400-e29b-41d4-a716-446655440000";
    const result = AttendanceTrendSchema.parse({ classSectionId: testId });
    expect(result.classSectionId).toBe(testId);
  });

  it("accepts studentId when classSectionId is absent", () => {
    const testId = "550e8400-e29b-41d4-a716-446655440000";
    const result = AttendanceTrendSchema.parse({ studentId: testId });
    expect(result.studentId).toBe(testId);
  });

  it("rejects both classSectionId and studentId together", () => {
    const testId = "550e8400-e29b-41d4-a716-446655440000";
    expect(() =>
      AttendanceTrendSchema.parse({
        classSectionId: testId,
        studentId: testId,
      })
    ).toThrow();
  });

  it("rejects non-uuid studentId", () => {
    expect(() => AttendanceTrendSchema.parse({ studentId: "not-a-uuid" })).toThrow();
  });

  it("rejects non-uuid classSectionId", () => {
    expect(() => AttendanceTrendSchema.parse({ classSectionId: "not-a-uuid" })).toThrow();
  });

  it("rejects unknown keys (strict mode)", () => {
    expect(() => AttendanceTrendSchema.parse({ unknownKey: "value" })).toThrow();
  });
});

describe("PortalDashboardSchema", () => {
  it("requires studentId", () => {
    const testId = "550e8400-e29b-41d4-a716-446655440000";
    const result = PortalDashboardSchema.parse({ studentId: testId });
    expect(result.studentId).toBe(testId);
  });

  it("rejects missing studentId", () => {
    expect(() => PortalDashboardSchema.parse({})).toThrow();
  });

  it("rejects non-uuid studentId", () => {
    expect(() => PortalDashboardSchema.parse({ studentId: "not-a-uuid" })).toThrow();
  });

  it("rejects unknown keys (strict mode)", () => {
    expect(() => PortalDashboardSchema.parse({ studentId: "550e8400-e29b-41d4-a716-446655440000", unknownKey: "value" })).toThrow();
  });
});
