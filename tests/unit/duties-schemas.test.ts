import { describe, expect, it } from "vitest";
import { addDays, weekDays, weekStart } from "../../src/modules/duties/dates";
import { DutyRangeSchema, DutySetAssignmentSchema, DutyTypeCreateSchema } from "../../src/modules/duties/schemas";

const id = "11111111-1111-4111-8111-111111111111";

describe("duties schemas", () => {
  it("accepts a duty type and rejects slots out of 1-20", () => {
    expect(DutyTypeCreateSchema.safeParse({ name: " Gate ", slotsPerDay: 2 }).success).toBe(true);
    expect(DutyTypeCreateSchema.safeParse({ name: "Gate", slotsPerDay: 0 }).success).toBe(false);
    expect(DutyTypeCreateSchema.safeParse({ name: "Gate", slotsPerDay: 21 }).success).toBe(false);
  });
  it("limits the roster range to 62 days and requires to >= from", () => {
    expect(DutyRangeSchema.safeParse({ from: "2026-12-01", to: "2027-01-31" }).success).toBe(true); // 62 days
    expect(DutyRangeSchema.safeParse({ from: "2026-12-01", to: "2027-02-01" }).success).toBe(false); // 63 days
    expect(DutyRangeSchema.safeParse({ from: "2026-12-02", to: "2026-12-01" }).success).toBe(false);
  });
  it("needs exactly one of staffId or cancel", () => {
    expect(DutySetAssignmentSchema.safeParse({ assignmentId: id }).success).toBe(false);
    expect(DutySetAssignmentSchema.safeParse({ assignmentId: id, staffId: id, cancel: true }).success).toBe(false);
    expect(DutySetAssignmentSchema.safeParse({ assignmentId: id, staffId: id }).success).toBe(true);
    expect(DutySetAssignmentSchema.safeParse({ assignmentId: id, cancel: true }).success).toBe(true);
  });
});

describe("week helpers", () => {
  it("finds the Monday of any weekday, including Sunday", () => {
    expect(weekStart("2026-11-11")).toBe("2026-11-09"); // Wed
    expect(weekStart("2026-11-09")).toBe("2026-11-09"); // Mon
    expect(weekStart("2026-11-15")).toBe("2026-11-09"); // Sun
  });
  it("lists seven days and crosses month ends", () => {
    expect(weekDays("2026-11-30")).toHaveLength(7);
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
  });
});
