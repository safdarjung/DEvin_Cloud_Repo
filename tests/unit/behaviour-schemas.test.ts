import { describe, expect, it } from "vitest";
import { IncidentListSchema, IncidentLogSchema, IncidentVoidSchema, PortalTimelineSchema } from "../../src/modules/behaviour/schemas.ts";

const id = "11111111-1111-4111-8111-111111111111";

describe("behaviour schemas", () => {
  it("accepts a merit and a demerit incident", () => {
    expect(IncidentLogSchema.safeParse({ studentId: id, category: "Helpfulness", severity: "low", points: 5 }).success).toBe(true);
    expect(IncidentLogSchema.safeParse({ studentId: id, category: "Bullying", severity: "high", points: -20, note: "x" }).success).toBe(true);
  });
  it("rejects points outside -100..100 and non-integers", () => {
    expect(IncidentLogSchema.safeParse({ studentId: id, category: "a", severity: "low", points: 101 }).success).toBe(false);
    expect(IncidentLogSchema.safeParse({ studentId: id, category: "a", severity: "low", points: 1.5 }).success).toBe(false);
  });
  it("rejects bad severity, long note, extra keys", () => {
    expect(IncidentLogSchema.safeParse({ studentId: id, category: "a", severity: "x", points: 1 }).success).toBe(false);
    expect(IncidentLogSchema.safeParse({ studentId: id, category: "a", severity: "low", points: 1, note: "n".repeat(501) }).success).toBe(false);
    expect(IncidentLogSchema.safeParse({ studentId: id, category: "a", severity: "low", points: 1, reportedBy: id }).success).toBe(false);
  });
  it("void needs a 1-200 char reason", () => {
    expect(IncidentVoidSchema.safeParse({ incidentId: id, reason: "Logged on wrong student" }).success).toBe(true);
    expect(IncidentVoidSchema.safeParse({ incidentId: id, reason: "  " }).success).toBe(false);
    expect(IncidentVoidSchema.safeParse({ incidentId: id, reason: "r".repeat(201) }).success).toBe(false);
  });
  it("list filters are optional; portal timeline needs a student", () => {
    expect(IncidentListSchema.safeParse({}).success).toBe(true);
    expect(IncidentListSchema.safeParse({ sectionId: id, category: "x", from: "2026-10-01", to: "2026-10-31", page: 2 }).success).toBe(true);
    expect(PortalTimelineSchema.safeParse({}).success).toBe(false);
  });
});
