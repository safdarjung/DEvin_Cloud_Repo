import { describe, it, expect, vi } from "vitest";
import {
  briefingSources,
  composeBriefing,
  BRIEF_ROLE,
  BRIEF_ROLE_LABEL,
  type BriefingSourceResult,
} from "@/modules/insights/briefing-compose";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// Wednesday (non-Monday) and Monday fixtures used across tests.
const WED = { today: "2026-11-04", weekday: 3 };
const MON = { today: "2026-11-09", weekday: 1 };

function result(query: string, params: Record<string, unknown>, data: unknown): BriefingSourceResult {
  return { query, params, data };
}

describe("briefingSources (recipes)", () => {
  it("teacher recipe is exactly calendar.forRole + exams.schedule, from today to today+6", () => {
    const sources = briefingSources("teacher", WED.today, WED.weekday);
    expect(sources).toEqual([
      { query: "calendar.forRole", params: { from: "2026-11-04", to: "2026-11-10" } },
      { query: "exams.schedule", params: { from: "2026-11-04", to: "2026-11-10" } },
    ]);
  });

  it("principal/admin on Monday add the weekly attendance + risk sources", () => {
    const weekday = briefingSources("principal", MON.today, MON.weekday);
    const names = weekday.map((s) => s.query);
    expect(names.filter((n) => n === "dashboard.attendanceTrend")).toHaveLength(2);
    expect(weekday).toContainEqual({ query: "dashboard.attendanceTrend", params: { days: 7 } });
    expect(weekday).toContainEqual({ query: "insights.riskIndicators", params: {} });

    const nonMonday = briefingSources("principal", WED.today, WED.weekday);
    expect(nonMonday.map((s) => s.query)).not.toContain("insights.riskIndicators");
  });

  it("BRIEF_ROLE maps owner/principal to principal; exam_controller/guardian/student have no brief role", () => {
    expect(BRIEF_ROLE.owner).toBe("principal");
    expect(BRIEF_ROLE.principal).toBe("principal");
    expect(BRIEF_ROLE.admin).toBe("admin");
    expect(BRIEF_ROLE.exam_controller).toBeUndefined();
    expect(BRIEF_ROLE.guardian).toBeUndefined();
    expect(BRIEF_ROLE.student).toBeUndefined();
  });

  it("BRIEF_ROLE_LABEL maps accountant to Finance", () => {
    expect(BRIEF_ROLE_LABEL.accountant).toBe("Finance");
  });

  // Known M16 (dashboard.*) / M19 (insights.*, core.approvals.pending) gap:
  // those modules are not merged into this lane yet, so only calendar.forRole
  // and exams.schedule are in the live registry today. This still catches a
  // typo'd recipe name: every name must be either registered now or in the
  // documented M16/M19 pending set below.
  it("every recipe query name is registered, or an explicitly pending M16/M19 source", async () => {
    await import("@/app/api/v1/query/all-queries");
    const { getRegisteredQueries } = await import("@/lib/actions/define-query");
    const registered = getRegisteredQueries();

    const pendingM16M19 = new Set([
      "dashboard.attendanceTrend",
      "dashboard.finance",
      "dashboard.admissions",
      "dashboard.operations",
      "core.approvals.pending",
      "insights.priorityActions",
      "insights.riskIndicators",
    ]);

    const names = new Set(
      (["principal", "admin", "accountant", "admissions", "teacher"] as const).flatMap((role) =>
        briefingSources(role, MON.today, MON.weekday).map((s) => s.query),
      ),
    );

    for (const name of names) {
      expect(registered.has(name) || pendingM16M19.has(name)).toBe(true);
    }
    // calendar.forRole and exams.schedule (M11/M13) must already be live.
    expect(registered.has("calendar.forRole")).toBe(true);
    expect(registered.has("exams.schedule")).toBe(true);
  });
});

describe("composeBriefing", () => {
  it("canned principal results produce items in order: approvals, attendance, 2 insights, fees, admissions, staff, maintenance, events", () => {
    const results: BriefingSourceResult[] = [
      result("dashboard.attendanceTrend", { days: 14 }, [
        { label: "D1", value: 90 },
        { label: "D2", value: 90 },
        { label: "D3", value: 90 },
        { label: "D4", value: 90 },
        { label: "D5", value: 90 },
        { label: "D6", value: 90 },
        { label: "D7", value: 90 },
        { label: "D8", value: 93 },
      ]),
      result("core.approvals.pending", {}, [{ kind: "leave" }, { kind: "agent_run" }, { kind: "expense" }]),
      result("dashboard.finance", {}, {
        collections: { collectedPaise: 12_345_678, duePaise: 20_000_000, overdue: [1, 2] },
      }),
      result("dashboard.admissions", {}, {
        funnel: { enquiryStages: { new: 3, contacted: 2 } },
        applicationStatuses: { submitted: 1, under_review: 1, interaction_scheduled: 0, offered: 1, rejected: 5 },
      }),
      result("dashboard.operations", {}, {
        staffToday: { onLeave: 2, absent: 1 },
        coverNeeded: [1, 2, 3],
        openMaintenance: [1, 2],
        upcomingEvents: [{ title: "PTM", startsOn: "2026-11-10", kind: "ptm" }],
      }),
      result("insights.priorityActions", {}, [
        { id: "i1", title: "Fix timetable gap", why: "", href: "/demo/insights/i1", owner: "", due: "2026-11-10", severity: "warning" },
        { id: "i2", title: "Review fee defaulters", why: "", href: "/demo/insights/i2", owner: "", due: "2026-11-10", severity: "watch" },
        { id: "i3", title: "Third", why: "", href: "/demo/insights/i3", owner: "", due: "2026-11-10", severity: "info" },
      ]),
    ];

    const out = composeBriefing({ role: "principal", slug: "demo", today: WED.today, weekday: WED.weekday, results });

    expect(out.headline).toBe("Principal briefing · Wed 4 Nov");
    expect(out.items.map((i) => i.text)).toEqual([
      "2 items awaiting approval.",
      "Attendance on D8: 93%, up 3 pts on the previous 7 school days.",
      "Review: Fix timetable gap",
      "Review: Review fee defaulters",
      "Fees this term: 61.7% collected (₹1,23,456 of ₹2,00,000); 2 invoices overdue.",
      "Admissions: 5 open enquiries, 3 applications in progress.",
      "Staff today: 2 on leave, 1 absent; 3 periods need cover.",
      "2 open maintenance requests.",
      "PTM on 10 Nov",
    ]);
    expect(out.items[0].href).toBe("/demo/dashboard");
    expect(out.items[2]).toEqual({ text: "Review: Fix timetable gap", insight_id: "i1", href: "/demo/insights/i1" });
    expect(out.sources).toHaveLength(results.length);
  });

  it("agent_run approvals are not counted; 0 non-agent_run rows → no approvals item", () => {
    const results: BriefingSourceResult[] = [result("core.approvals.pending", {}, [{ kind: "agent_run" }, { kind: "agent_run" }])];
    const out = composeBriefing({ role: "admin", slug: "demo", today: WED.today, weekday: WED.weekday, results });
    expect(out.items).toEqual([]);
  });

  it("fees 12,345,678 of 20,000,000 paise formats as the exact string", () => {
    const results: BriefingSourceResult[] = [
      result("dashboard.finance", {}, { collections: { collectedPaise: 12_345_678, duePaise: 20_000_000, overdue: [] } }),
    ];
    const out = composeBriefing({ role: "accountant", slug: "demo", today: WED.today, weekday: WED.weekday, results });
    expect(out.items[0].text).toBe("Fees this term: 61.7% collected (₹1,23,456 of ₹2,00,000).");
  });

  it("attendance: up, down and in-line cases; fewer than 3 previous points → no comparison", () => {
    const up = composeBriefing({
      role: "principal",
      slug: "demo",
      today: WED.today,
      weekday: WED.weekday,
      results: [result("dashboard.attendanceTrend", { days: 14 }, [
        { label: "A", value: 90 }, { label: "B", value: 90 }, { label: "C", value: 90 }, { label: "D", value: 95 },
      ])],
    });
    expect(up.items[0].text).toBe("Attendance on D: 95%, up 5 pts on the previous 3 school days.");

    const down = composeBriefing({
      role: "principal",
      slug: "demo",
      today: WED.today,
      weekday: WED.weekday,
      results: [result("dashboard.attendanceTrend", { days: 14 }, [
        { label: "A", value: 95 }, { label: "B", value: 95 }, { label: "C", value: 95 }, { label: "D", value: 90 },
      ])],
    });
    expect(down.items[0].text).toContain("down 5 pts on the previous 3 school days");

    const inLine = composeBriefing({
      role: "principal",
      slug: "demo",
      today: WED.today,
      weekday: WED.weekday,
      results: [result("dashboard.attendanceTrend", { days: 14 }, [
        { label: "A", value: 90 }, { label: "B", value: 90 }, { label: "C", value: 90 }, { label: "D", value: 90.2 },
      ])],
    });
    expect(inLine.items[0].text).toContain("in line with the previous 3 school days");

    const tooFew = composeBriefing({
      role: "principal",
      slug: "demo",
      today: WED.today,
      weekday: WED.weekday,
      results: [result("dashboard.attendanceTrend", { days: 14 }, [
        { label: "A", value: 90 }, { label: "B", value: 95 },
      ])],
    });
    expect(tooFew.items[0].text).toBe("Attendance on B: 95%.");
  });

  it("a source missing from results → no item and is not in sources", () => {
    const results: BriefingSourceResult[] = [result("core.approvals.pending", {}, [{ kind: "x" }])];
    const out = composeBriefing({ role: "principal", slug: "demo", today: WED.today, weekday: WED.weekday, results });
    expect(out.items).toHaveLength(1);
    expect(out.sources).toEqual([{ query: "core.approvals.pending", params: {} }]);
  });

  it("Monday principal: weekly items come first, headline ends '· week in review', never more than 10 items", () => {
    // Every principal/admin Monday source present and non-empty: 11 raw
    // candidates (weekAttendance, weekInsights, approvals, daily attendance,
    // 2 insights, fees, admissions, staff, maintenance, events) — one more
    // than the cap, so the last one (events) must be dropped.
    const results: BriefingSourceResult[] = [
      result("dashboard.attendanceTrend", { days: 7 }, [
        { label: "W1", value: 90 }, { label: "W2", value: 92 },
      ]),
      result(
        "dashboard.attendanceTrend",
        { days: 14 },
        Array.from({ length: 14 }, (_, i) => ({ label: `D${i + 1}`, value: 90 })),
      ),
      result("insights.riskIndicators", {}, [
        { id: "r1", label: "Attendance dip", level: "warning", trend: "up", insight_id: null },
        { id: "r2", label: "Stable metric", level: "info", trend: "flat", insight_id: null },
      ]),
      result("core.approvals.pending", {}, [{ kind: "leave" }]),
      result("insights.priorityActions", {}, [
        { id: "i1", title: "First", why: "", href: "/demo/insights/i1", owner: "", due: "2026-11-09", severity: "warning" },
        { id: "i2", title: "Second", why: "", href: "/demo/insights/i2", owner: "", due: "2026-11-09", severity: "watch" },
      ]),
      result("dashboard.finance", {}, { collections: { collectedPaise: 5_000_000, duePaise: 10_000_000, overdue: [] } }),
      result("dashboard.admissions", {}, {
        funnel: { enquiryStages: { new: 1 } },
        applicationStatuses: { submitted: 1, under_review: 0, interaction_scheduled: 0, offered: 0 },
      }),
      result("dashboard.operations", {}, {
        staffToday: { onLeave: 1, absent: 0 },
        coverNeeded: [1],
        openMaintenance: [1],
        upcomingEvents: [{ title: "PTM", startsOn: "2026-11-10", kind: "ptm" }],
      }),
    ];

    const out = composeBriefing({ role: "principal", slug: "demo", today: MON.today, weekday: MON.weekday, results });

    expect(out.headline).toBe("Principal briefing · Mon 9 Nov · week in review");
    expect(out.items).toHaveLength(10);
    expect(out.items[0].text).toContain("Last 7 days: attendance averaged 91%");
    expect(out.items[1].text).toBe("Insights rising this week: Attendance dip.");
    expect(out.items[2].text).toContain("awaiting approval");
    expect(out.items.some((i) => i.text === "PTM on 10 Nov")).toBe(false);
  });

  it("every item text is at most 200 chars and contains no UUID", () => {
    const longTitle = "x".repeat(300);
    const results: BriefingSourceResult[] = [
      result("insights.priorityActions", {}, [
        {
          id: "11111111-1111-1111-1111-111111111111",
          title: longTitle,
          why: "",
          href: "/demo/insights/i1",
          owner: "",
          due: "2026-11-10",
          severity: "warning",
        },
      ]),
    ];
    const out = composeBriefing({ role: "principal", slug: "demo", today: WED.today, weekday: WED.weekday, results });
    for (const item of out.items) {
      expect(item.text.length).toBeLessThanOrEqual(200);
      expect(item.text).not.toMatch(UUID_RE);
    }
    expect(out.items[0].insight_id).toBe("11111111-1111-1111-1111-111111111111");
  });
});
