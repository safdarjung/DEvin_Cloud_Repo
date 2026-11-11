import { describe, expect, it } from "vitest";
import { toPriorityActions, toRiskIndicators, type OpenDomainRow } from "@/modules/insights/derived";
import type { Insight } from "@/modules/fabric/types";

const NOW = new Date("2026-11-05T00:00:00Z");

function insight(overrides: Partial<Insight> = {}): Insight {
  return {
    id: "ins-1",
    institution_id: "inst-1",
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    title: "Attendance dropped in 8-A",
    domain: "attendance",
    severity: "watch",
    kind: "diagnostic",
    pattern: "Attendance in 8-A fell from 92% to 80%.",
    evidence: [{ label: "Recent attendance", value: 80, unit: "%" }],
    sources: ["attendance_sessions"],
    date_from: "2026-10-25",
    date_to: "2026-11-01",
    confidence: 0.6,
    factors: [],
    reviewer_role: "principal",
    recommended_actions: [],
    approval_required: false,
    status: "new",
    entity_ref: null,
    signal: "attendance.section_drop",
    detector_version: 1,
    explanation: null,
    ...overrides,
  };
}

describe("toPriorityActions", () => {
  it("sorts critical before warning", () => {
    const rows = [insight({ id: "a", severity: "warning" }), insight({ id: "b", severity: "critical" })];
    const out = toPriorityActions(rows, "demo", NOW);
    expect(out.map((a) => a.id)).toEqual(["b", "a"]);
  });

  it("within the same severity, higher confidence sorts first", () => {
    const rows = [insight({ id: "lo", confidence: 0.3 }), insight({ id: "hi", confidence: 0.9 })];
    const out = toPriorityActions(rows, "demo", NOW);
    expect(out.map((a) => a.id)).toEqual(["hi", "lo"]);
  });

  it("caps at 8 rows", () => {
    const rows = Array.from({ length: 12 }, (_, i) => insight({ id: `i${i}` }));
    expect(toPriorityActions(rows, "demo", NOW)).toHaveLength(8);
  });

  it("excludes actioned (and other non-open) rows", () => {
    const rows = [
      insight({ id: "new", status: "new" }),
      insight({ id: "reviewing", status: "reviewing" }),
      insight({ id: "actioned", status: "actioned" }),
      insight({ id: "resolved", status: "resolved" }),
      insight({ id: "dismissed", status: "dismissed" }),
    ];
    const ids = toPriorityActions(rows, "demo", NOW).map((a) => a.id);
    expect(ids.sort()).toEqual(["new", "reviewing"]);
  });

  it("due = created date + SLA for the severity", () => {
    const critical = insight({ id: "c", severity: "critical", created_at: "2026-11-01T00:00:00Z" });
    const warning = insight({ id: "w", severity: "warning", created_at: "2026-11-01T00:00:00Z" });
    const watch = insight({ id: "wa", severity: "watch", created_at: "2026-11-01T00:00:00Z" });
    const info = insight({ id: "i", severity: "info", created_at: "2026-11-01T00:00:00Z" });
    const out = toPriorityActions([critical, warning, watch, info], "demo", NOW);
    const due = (id: string) => out.find((a) => a.id === id)?.due;
    expect(due("c")).toBe("2026-11-02");
    expect(due("w")).toBe("2026-11-04");
    expect(due("wa")).toBe("2026-11-08");
    expect(due("i")).toBe("2026-11-15");
  });

  it("builds href as /<slug>/fabric/insights?id=<id>", () => {
    const out = toPriorityActions([insight({ id: "x" })], "greenwood", NOW);
    expect(out[0].href).toBe("/greenwood/fabric/insights?id=x");
  });

  it("why falls back to pattern when there is no explanation", () => {
    const out = toPriorityActions([insight({ pattern: "the pattern" })], "demo", NOW);
    expect(out[0].why).toBe("the pattern");
  });

  it("why uses explanation.why when present", () => {
    const out = toPriorityActions(
      [insight({ explanation: { what: "w", why: "explained why", next_steps: [], provider: "local", model: "m", explained_at: "2026-11-01" } })],
      "demo",
      NOW,
    );
    expect(out[0].why).toBe("explained why");
  });

  it("maps reviewer_role to a display label", () => {
    const out = toPriorityActions([insight({ reviewer_role: "exam_controller" })], "demo", NOW);
    expect(out[0].owner).toBe("Exam controller");
  });
});

describe("toRiskIndicators", () => {
  const row = (domain: string, over: Partial<OpenDomainRow> = {}): OpenDomainRow => ({
    domain,
    n: 1,
    top_id: `${domain}-top`,
    top_severity: "watch",
    last7: 0,
    prev7: 0,
    ...over,
  });

  it("returns one indicator per domain with its top insight and severity", () => {
    const out = toRiskIndicators([row("attendance", { top_id: "a2", top_severity: "critical", n: 2 }), row("finance", { top_severity: "warning" })]);
    const byId = new Map(out.map((r) => [r.id, r]));
    expect(byId.get("risk:attendance")?.level).toBe("critical");
    expect(byId.get("risk:attendance")?.insight_id).toBe("a2");
    expect(byId.get("risk:attendance")?.label).toBe("Attendance: 2 open");
    expect(byId.get("risk:finance")?.level).toBe("warning");
  });

  it("computes trend up/down/flat from the last 7 vs the previous 7 days", () => {
    const trend = (last7: number, prev7: number) => toRiskIndicators([row("attendance", { last7, prev7 })])[0].trend;
    expect(trend(2, 1)).toBe("up");
    expect(trend(1, 2)).toBe("down");
    expect(trend(1, 1)).toBe("flat");
  });

  it("sorts by level desc then open count desc", () => {
    const out = toRiskIndicators([row("staff"), row("operations", { n: 2 }), row("admissions", { top_severity: "critical" })]);
    expect(out.map((r) => r.id)).toEqual(["risk:admissions", "risk:operations", "risk:staff"]);
  });

  it("caps at 6 indicators", () => {
    const domains = ["attendance", "academics", "finance", "admissions", "operations", "wellbeing", "staff"];
    expect(toRiskIndicators(domains.map((d) => row(d)))).toHaveLength(6);
  });
});
