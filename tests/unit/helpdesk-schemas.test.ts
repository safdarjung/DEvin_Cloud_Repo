import { describe, expect, it } from "vitest";
import { RaiseTicketSchema, TicketMessageSchema, UpdateTicketSchema, slaState } from "@/modules/helpdesk/schemas";

const U = "11111111-1111-4111-8111-111111111111";

describe("helpdesk schemas", () => {
  it("raise accepts a valid ticket and trims", () => {
    const r = RaiseTicketSchema.parse({ category: "fees", priority: "high", subject: "  Hi ", body: "Body" });
    expect(r.subject).toBe("Hi");
  });
  it("raise rejects unknown category, empty body and extra keys", () => {
    expect(RaiseTicketSchema.safeParse({ category: "x", priority: "low", subject: "a", body: "b" }).success).toBe(false);
    expect(RaiseTicketSchema.safeParse({ category: "fees", priority: "low", subject: "a", body: " " }).success).toBe(false);
    expect(RaiseTicketSchema.safeParse({ category: "fees", priority: "low", subject: "a", body: "b", status: "closed" }).success).toBe(false);
  });
  it("update requires both fields; null assignee allowed", () => {
    expect(UpdateTicketSchema.safeParse({ ticketId: U, status: "closed", assigneeStaffId: null }).success).toBe(true);
    expect(UpdateTicketSchema.safeParse({ ticketId: U, status: "closed" }).success).toBe(false);
    expect(UpdateTicketSchema.safeParse({ ticketId: U, status: "bogus", assigneeStaffId: null }).success).toBe(false);
  });
  it("message caps body at 4000", () => {
    expect(TicketMessageSchema.safeParse({ ticketId: U, body: "x".repeat(4001) }).success).toBe(false);
  });
});

describe("slaState", () => {
  const now = new Date("2026-11-01T10:00:00Z");
  it("is overdue past due_at, due soon within 4h, else on time", () => {
    expect(slaState("open", "2026-11-01T09:00:00Z", now)).toBe("overdue");
    expect(slaState("in_progress", "2026-11-01T13:00:00Z", now)).toBe("due_soon");
    expect(slaState("open", "2026-11-02T10:00:00Z", now)).toBe("on_time");
  });
  it("resolved and closed are done even when past due", () => {
    expect(slaState("resolved", "2026-10-01T00:00:00Z", now)).toBe("done");
    expect(slaState("closed", "2026-10-01T00:00:00Z", now)).toBe("done");
  });
});
