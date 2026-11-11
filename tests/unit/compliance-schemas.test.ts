import { describe, expect, it } from "vitest";
import { ComplianceItemCreateSchema, ComplianceRenewSchema, ComplianceStarterLoadSchema } from "../../src/modules/compliance/schemas";
import { complianceStatus } from "../../src/modules/compliance/status";
import { COMPLIANCE_STARTER } from "../../src/modules/compliance/templates";

const id = "11111111-1111-4111-8111-111111111111";

describe("complianceStatus boundaries", () => {
  it("is overdue the day after the due date, due soon on the due date", () => {
    expect(complianceStatus("2026-11-10", "2026-11-11")).toBe("overdue");
    expect(complianceStatus("2026-11-11", "2026-11-11")).toBe("due_soon");
  });
  it("is due soon through day 30 and ok from day 31", () => {
    expect(complianceStatus("2026-12-11", "2026-11-11")).toBe("due_soon"); // +30
    expect(complianceStatus("2026-12-12", "2026-11-11")).toBe("ok"); // +31
  });
  it("handles month and year rollover", () => {
    expect(complianceStatus("2027-01-09", "2026-12-31")).toBe("due_soon");
    expect(complianceStatus("2026-12-31", "2027-01-01")).toBe("overdue");
  });
});

describe("compliance schemas", () => {
  it("creates an item with a title and first due date, trims the title", () => {
    const r = ComplianceItemCreateSchema.parse({ title: "  Fire NOC ", category: "safety", dueOn: "2027-01-01" });
    expect(r.title).toBe("Fire NOC");
  });
  it("rejects bad category, missing due date, renewal period out of range and unknown keys", () => {
    expect(ComplianceItemCreateSchema.safeParse({ title: "A", category: "legal", dueOn: "2027-01-01" }).success).toBe(false);
    expect(ComplianceItemCreateSchema.safeParse({ title: "A", category: "safety" }).success).toBe(false);
    expect(ComplianceItemCreateSchema.safeParse({ title: "A", category: "safety", dueOn: "2027-01-01", renewEveryMonths: 0 }).success).toBe(false);
    expect(ComplianceItemCreateSchema.safeParse({ title: "A", category: "safety", dueOn: "2027-01-01", x: 1 }).success).toBe(false);
  });
  it("requires new due date after renewal date when both are given", () => {
    expect(ComplianceRenewSchema.safeParse({ itemId: id, renewedOn: "2026-11-01", newDueOn: "2026-11-01" }).success).toBe(false);
    expect(ComplianceRenewSchema.safeParse({ itemId: id, renewedOn: "2026-11-01", newDueOn: "2027-11-01" }).success).toBe(true);
    expect(ComplianceRenewSchema.safeParse({ itemId: id }).success).toBe(true);
  });
  it("starter list has titles and categories only, and load needs a date per item", () => {
    expect(COMPLIANCE_STARTER).toHaveLength(10);
    for (const t of COMPLIANCE_STARTER) expect(Object.keys(t).sort()).toEqual(["category", "title"]);
    expect(ComplianceStarterLoadSchema.safeParse({ items: [{ title: "Fire NOC" }] }).success).toBe(false);
    expect(ComplianceStarterLoadSchema.safeParse({ items: [{ title: "Fire NOC", dueOn: "2027-01-01" }] }).success).toBe(true);
  });
});
