import { describe, expect, it } from "vitest";
import {
  capPerSignal,
  confidence,
  isoWeekKey,
  makeCandidate,
  pct,
  SIGNALS,
  type InsightCandidate,
} from "@/modules/insights/signals";

function candidate(overrides: Partial<InsightCandidate> = {}): InsightCandidate {
  return {
    signal: "attendance.section_drop",
    detector_version: 1,
    dedupe_key: "attendance.section_drop:section:sec-1:2026-W44",
    domain: "attendance",
    kind: "diagnostic",
    severity: "watch",
    title: "t",
    pattern: "p",
    evidence: [],
    sources: [],
    date_from: "2026-10-01",
    date_to: "2026-11-01",
    confidence: 0.5,
    factors: [],
    reviewer_role: "principal",
    recommended_actions: [],
    approval_required: false,
    entity_type: "section",
    entity_id: "sec-1",
    entity_label: null,
    class_section_id: "sec-1",
    ...overrides,
  };
}

describe("isoWeekKey", () => {
  it("returns the ISO-8601 week", () => {
    expect(isoWeekKey("2026-11-01")).toBe("2026-W44");
    expect(isoWeekKey("2027-01-01")).toBe("2026-W53");
  });
});

describe("confidence", () => {
  it("clamps to [0.05, 0.95]", () => {
    expect(confidence(1.2)).toBe(0.95);
    expect(confidence(0)).toBe(0.05);
  });
});

describe("pct", () => {
  it("returns null on a zero denominator", () => {
    expect(pct(1, 0)).toBeNull();
  });

  it("rounds to 1 dp otherwise", () => {
    expect(pct(1, 3)).toBe(33.3);
  });
});

describe("makeCandidate", () => {
  it("sets approval_required for a critical candidate", () => {
    const c = makeCandidate("attendance.section_drop", 1, {
      severity: "critical",
      title: "Attendance drop in 8-A",
      pattern: "Attendance in 8-A fell.",
      evidence: [],
      sources: ["attendance_sessions"],
      date_from: "2026-10-01",
      date_to: "2026-11-01",
      confidence: 0.9,
      recommended_actions: [],
      entity_type: "section",
      entity_id: "sec-1",
      entity_label: null,
      class_section_id: "sec-1",
      window: "2026-W44",
    });
    expect(c.approval_required).toBe(true);
  });

  it("always sets approval_required for finance.concession_spike, regardless of severity", () => {
    const c = makeCandidate("finance.concession_spike", 1, {
      severity: "watch",
      title: "Unusual number of fee concessions",
      pattern: "p",
      evidence: [],
      sources: ["concessions"],
      date_from: "2026-10-01",
      date_to: "2026-11-01",
      confidence: 0.6,
      recommended_actions: [],
      entity_type: null,
      entity_id: null,
      entity_label: null,
      class_section_id: null,
      window: "2026-W44",
    });
    expect(c.approval_required).toBe(true);
    expect(c.severity).toBe("watch");
  });

  it("does not set approval_required for a non-critical, non-flagged signal", () => {
    const c = makeCandidate("attendance.section_drop", 1, {
      severity: "warning",
      title: "t",
      pattern: "p",
      evidence: [],
      sources: [],
      date_from: "2026-10-01",
      date_to: "2026-11-01",
      confidence: 0.6,
      recommended_actions: [],
      entity_type: "section",
      entity_id: "sec-1",
      entity_label: null,
      class_section_id: "sec-1",
      window: "2026-W44",
    });
    expect(c.approval_required).toBe(false);
  });

  it("builds the dedupe_key as signal:entity_type|school:entity_id|-:window", () => {
    const withEntity = makeCandidate("attendance.student_drop", 1, {
      severity: "watch",
      title: "t",
      pattern: "p",
      evidence: [],
      sources: [],
      date_from: "2026-10-01",
      date_to: "2026-11-01",
      confidence: 0.5,
      recommended_actions: [],
      entity_type: "student",
      entity_id: "stu-1",
      entity_label: null,
      class_section_id: "sec-1",
      window: "2026-W44",
    });
    expect(withEntity.dedupe_key).toBe("attendance.student_drop:student:stu-1:2026-W44");

    const schoolWide = makeCandidate("finance.overdue_growth", 1, {
      severity: "watch",
      title: "t",
      pattern: "p",
      evidence: [],
      sources: [],
      date_from: "2026-10-01",
      date_to: "2026-11-01",
      confidence: 0.5,
      recommended_actions: [],
      entity_type: null,
      entity_id: null,
      entity_label: null,
      class_section_id: null,
      window: "2026-W44",
    });
    expect(schoolWide.dedupe_key).toBe("finance.overdue_growth:school:-:2026-W44");
  });

  it("fills domain/kind/reviewer_role from SIGNALS and slices title/pattern", () => {
    const c = makeCandidate("academics.marks_decline", 1, {
      severity: "watch",
      title: "x".repeat(130),
      pattern: "y".repeat(310),
      evidence: [],
      sources: [],
      date_from: "2026-10-01",
      date_to: "2026-11-01",
      confidence: 0.5,
      recommended_actions: [],
      entity_type: "student",
      entity_id: "stu-1",
      entity_label: null,
      class_section_id: "sec-1",
      window: "exam-1",
    });
    expect(c.domain).toBe(SIGNALS["academics.marks_decline"].domain);
    expect(c.kind).toBe(SIGNALS["academics.marks_decline"].kind);
    expect(c.reviewer_role).toBe(SIGNALS["academics.marks_decline"].reviewerRole);
    expect(c.title).toHaveLength(120);
    expect(c.pattern).toHaveLength(300);
    expect(c.factors).toEqual([]);
  });
});

describe("capPerSignal", () => {
  it("keeps at most 20 per signal, in rule order, deterministically", () => {
    const many: InsightCandidate[] = Array.from({ length: 25 }, (_, i) =>
      candidate({
        dedupe_key: `attendance.section_drop:section:sec-${i}:2026-W44`,
        severity: i < 5 ? "critical" : i < 15 ? "warning" : "watch",
        confidence: 0.5 + (i % 3) * 0.01,
      }),
    );
    const capped = capPerSignal(many, 20);
    expect(capped).toHaveLength(20);
    // severity desc first
    expect(capped[0].severity).toBe("critical");
    expect(capped.at(-1)?.severity).toBe("watch");
    // deterministic: same input twice -> identical output
    expect(capPerSignal(many, 20)).toEqual(capped);
  });

  it("caps independently per signal", () => {
    const a = candidate({ signal: "attendance.section_drop", dedupe_key: "a" });
    const b = candidate({ signal: "staff.workload", domain: "staff", dedupe_key: "b" });
    const capped = capPerSignal([a, b], 20);
    expect(capped).toHaveLength(2);
  });
});
