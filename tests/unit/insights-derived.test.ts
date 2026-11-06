import { describe, expect, it } from "vitest";
import { toInsightCards, toPriorityActions, toRiskIndicators, type RiskRecentRow } from "@/modules/insights/derived";
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
  function recent(domain: string, daysAgo: number): RiskRecentRow {
    return { domain, created_at: new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString() };
  }

  it("returns one indicator per domain with its highest open severity", () => {
    const open = [
      insight({ id: "a1", domain: "attendance", severity: "watch" }),
      insight({ id: "a2", domain: "attendance", severity: "critical" }),
      insight({ id: "f1", domain: "finance", severity: "warning" }),
    ];
    const out = toRiskIndicators(open, [], NOW);
    const byId = new Map(out.map((r) => [r.id, r]));
    expect(byId.get("risk:attendance")?.level).toBe("critical");
    expect(byId.get("risk:attendance")?.insight_id).toBe("a2");
    expect(byId.get("risk:finance")?.level).toBe("warning");
  });

  it("computes trend up/down/flat from the last 7 vs the previous 7 days", () => {
    const open = [insight({ id: "a1", domain: "attendance" })];
    const up = toRiskIndicators(open, [recent("attendance", 1), recent("attendance", 2), recent("attendance", 10)], NOW);
    expect(up.find((r) => r.id === "risk:attendance")?.trend).toBe("up");

    const down = toRiskIndicators(open, [recent("attendance", 1), recent("attendance", 9), recent("attendance", 10)], NOW);
    expect(down.find((r) => r.id === "risk:attendance")?.trend).toBe("down");

    const flat = toRiskIndicators(open, [recent("attendance", 1), recent("attendance", 9)], NOW);
    expect(flat.find((r) => r.id === "risk:attendance")?.trend).toBe("flat");
  });

  it("sorts by level desc then open count desc", () => {
    const open = [
      insight({ id: "s1", domain: "staff", severity: "watch" }),
      insight({ id: "o1", domain: "operations", severity: "watch" }),
      insight({ id: "o2", domain: "operations", severity: "watch" }),
      insight({ id: "ad1", domain: "admissions", severity: "critical" }),
    ];
    const out = toRiskIndicators(open, [], NOW);
    expect(out[0].id).toBe("risk:admissions");
    expect(out[1].id).toBe("risk:operations"); // watch, n=2 beats watch, n=1
    expect(out).toHaveLength(3);
  });

  it("caps at 6 indicators", () => {
    const domains = ["attendance", "academics", "finance", "admissions", "operations", "wellbeing", "staff"];
    const open = domains.map((domain, i) => insight({ id: `d${i}`, domain: domain as Insight["domain"] }));
    expect(toRiskIndicators(open, [], NOW)).toHaveLength(6);
  });
});

describe("toInsightCards", () => {
  it("uses explanation.why when present, else SIGNALS[signal].why", () => {
    const withExplanation = insight({
      explanation: { what: "w", why: "explained why", next_steps: [], provider: "local", model: "m", explained_at: "2026-11-01" },
    });
    const withoutExplanation = insight({ explanation: null, signal: "attendance.section_drop" });
    const [a, b] = toInsightCards([withExplanation, withoutExplanation], "demo", 3);
    expect(a.whyItMatters).toBe("explained why");
    expect(b.whyItMatters).toBe("A section's attendance fell sharply against its own recent baseline.");
  });

  it("formats evidence as '<label>: <value><unit>'", () => {
    const [card] = toInsightCards([insight({ evidence: [{ label: "Recent attendance", value: 80, unit: "%" }, { label: "Open items", value: 3 }] })], "demo", 3);
    expect(card.evidence).toEqual(["Recent attendance: 80%", "Open items: 3"]);
  });

  it("buckets confidence at 0.75/0.5", () => {
    const [high, medium, low] = toInsightCards(
      [insight({ id: "h", confidence: 0.75 }), insight({ id: "m", confidence: 0.5 }), insight({ id: "l", confidence: 0.49 })],
      "demo",
      3,
    );
    expect(high.confidence).toBe("high");
    expect(medium.confidence).toBe("medium");
    expect(low.confidence).toBe("low");
  });

  it("respects the limit", () => {
    const rows = Array.from({ length: 5 }, (_, i) => insight({ id: `i${i}` }));
    expect(toInsightCards(rows, "demo", 2)).toHaveLength(2);
  });

  it("marks requiresApproval from approval_required and builds the review href", () => {
    const [card] = toInsightCards([insight({ id: "x", approval_required: true })], "greenwood", 3);
    expect(card.requiresApproval).toBe(true);
    expect(card.suggestedAction).toEqual({ label: "Review insight", href: "/greenwood/fabric/insights?id=x" });
  });
});
