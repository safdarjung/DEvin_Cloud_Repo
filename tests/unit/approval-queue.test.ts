import { describe, expect, test } from "vitest";
import { ageLabel, buildApprovalQueue } from "../../src/modules/core/approval-queue";

const NOW = Date.parse("2026-11-06T12:00:00Z");
const leave = (id: string, status = "pending") => ({
  id,
  studentId: "s",
  studentName: "Asha Rao",
  classSection: "5-A",
  startDate: "2026-11-07",
  endDate: "2026-11-08",
  days: 2,
  reason: "Fever",
  status,
  decidedAt: null,
  decisionNote: null,
  createdAt: "2026-11-06T09:00:00Z",
});

describe("buildApprovalQueue", () => {
  test("marks staff leave actionable and other kinds as links", () => {
    const { items } = buildApprovalQueue(
      [
        { id: "a", kind: "leave", title: "Sick leave, 1 day", requestedBy: "T", age: "2 h" },
        { id: "b", kind: "recheck", title: "Recheck: Maths", requestedBy: "S", age: "1 d", href: "/x/exams/rechecks" },
      ],
      [],
      NOW,
    );
    expect(items.map((i) => i.kind)).toEqual(["staff_leave", "link"]);
    expect(items[1].href).toBe("/x/exams/rechecks");
  });
  test("includes only pending student leave", () => {
    const { items, total } = buildApprovalQueue([], [leave("1"), leave("2", "approved")], NOW);
    expect(total).toBe(1);
    expect(items[0]).toMatchObject({ kind: "student_leave", who: "Asha Rao (5-A)", age: "3 h" });
  });
  test("caps visible items but reports the true total", () => {
    const many = Array.from({ length: 12 }, (_, i) => leave(String(i)));
    const { items, total } = buildApprovalQueue([], many, NOW, 8);
    expect(items).toHaveLength(8);
    expect(total).toBe(12);
  });
  test("ageLabel switches to days after 24 hours", () => {
    expect(ageLabel("2026-11-04T12:00:00Z", NOW)).toBe("2 d");
  });
});
