import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import {
  ADMISSION_STAGE_THRESHOLDS,
  admissionsDetector,
  detectAdmissions,
  type AdmissionsSourceRow,
} from "@/modules/insights/detectors/admissions";
import { detectFees, feesDetector, type FeesSourceRow } from "@/modules/insights/detectors/fees";

const AS_OF = "2026-11-01"; // ISO week 2026-W44

function feeRow(over: Partial<FeesSourceRow> = {}): FeesSourceRow {
  return {
    overdue_now: 0,
    overdue_then: 0,
    overdue_count_now: 0,
    overdue_count_then: 0,
    concessions_recent: 0,
    concessions_base: 0,
    concessions_flagged: 0,
    ...over,
  };
}

function stageRow(stage: string, open: number, over: Partial<AdmissionsSourceRow> = {}): AdmissionsSourceRow {
  return { stage, open_count: open, over_2: 0, over_7: 0, over_14: 0, ...over };
}

// Stand-in for `await admin.rpc(fn, args)`; records each call.
function fakeAdmin(result: { data: unknown[] | null; error: unknown }) {
  const calls: { fn: string; args: unknown }[] = [];
  const client = {
    rpc(fn: string, args: unknown) {
      calls.push({ fn, args });
      return Promise.resolve(result);
    },
  };
  return { admin: client as unknown as SupabaseClient<Database>, calls };
}

describe("detectFees: finance.overdue_growth", () => {
  it("flags overdue 100,000 -> 160,000 as a 60% warning", () => {
    const out = detectFees(feeRow({ overdue_then: 100000, overdue_now: 160000, overdue_count_now: 12 }), AS_OF);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      signal: "finance.overdue_growth",
      detector_version: 1,
      dedupe_key: "finance.overdue_growth:school:-:2026-W44",
      domain: "finance",
      kind: "descriptive",
      reviewer_role: "accountant",
      severity: "warning",
      title: "Overdue fees rising",
      confidence: 0.85,
      approval_required: false,
      sources: ["invoices", "payments", "payment_reversals"],
      date_from: "2026-10-04",
      date_to: AS_OF,
      entity_type: null,
      entity_id: null,
      entity_label: null,
      class_section_id: null,
      factors: [],
    });
    expect(out[0].evidence).toEqual([
      { label: "Overdue now", value: 160000, unit: "₹" },
      { label: "Overdue 4 weeks ago", value: 100000, unit: "₹" },
      { label: "Growth", value: 60, unit: "%" },
      { label: "Overdue invoices", value: 12 },
    ]);
  });

  it("treats growth from 0 -> 30,000 as 100%: critical with approval_required", () => {
    const [c] = detectFees(feeRow({ overdue_then: 0, overdue_now: 30000, overdue_count_now: 3 }), AS_OF);
    expect(c).toMatchObject({ severity: "critical", approval_required: true, confidence: 0.65 });
    expect(c.evidence[2]).toEqual({ label: "Growth", value: 100, unit: "%" });
  });

  it("ignores growth of 20,000", () => {
    expect(detectFees(feeRow({ overdue_then: 100000, overdue_now: 120000, overdue_count_now: 20 }), AS_OF)).toEqual([]);
  });

  it("ignores growth of 25,000 or more when it is under 25%", () => {
    expect(detectFees(feeRow({ overdue_then: 200000, overdue_now: 240000 }), AS_OF)).toEqual([]);
  });

  it("fires watch at exactly 25,000 and 25%", () => {
    const [c] = detectFees(feeRow({ overdue_then: 100000, overdue_now: 125000, overdue_count_now: 4 }), AS_OF);
    expect(c).toMatchObject({ signal: "finance.overdue_growth", severity: "watch", confidence: 0.5 });
  });

  it("ignores falling overdue balances", () => {
    expect(detectFees(feeRow({ overdue_then: 160000, overdue_now: 100000 }), AS_OF)).toEqual([]);
  });
});

describe("detectFees: finance.concession_spike", () => {
  it("concessions 6 vs base 6 fires the spike with approval_required (6 >= 3 x usual 2 is warning per ruling)", () => {
    const out = detectFees(feeRow({ concessions_recent: 6, concessions_base: 6, concessions_flagged: 3 }), AS_OF);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      signal: "finance.concession_spike",
      dedupe_key: "finance.concession_spike:school:-:2026-W44",
      domain: "finance",
      kind: "diagnostic",
      reviewer_role: "principal",
      severity: "warning",
      approval_required: true,
      title: "Unusual number of fee concessions",
      confidence: 0.7,
      sources: ["concessions"],
      date_from: "2026-07-13",
      date_to: AS_OF,
      entity_type: null,
    });
    expect(out[0].evidence).toEqual([
      { label: "Concessions (4 weeks)", value: 6 },
      { label: "Usual per 4 weeks", value: 2 },
      { label: "Hardship/other", value: 3 },
    ]);
  });

  it("concessions 6 vs base 9 is a spike watch, still approval_required", () => {
    const [c] = detectFees(feeRow({ concessions_recent: 6, concessions_base: 9, concessions_flagged: 2 }), AS_OF);
    expect(c).toMatchObject({ signal: "finance.concession_spike", severity: "watch", approval_required: true, confidence: 0.6 });
    expect(c.evidence[1]).toEqual({ label: "Usual per 4 weeks", value: 3 });
  });

  it("concessions 4 never fire", () => {
    expect(detectFees(feeRow({ concessions_recent: 4, concessions_base: 0 }), AS_OF)).toEqual([]);
  });

  it("does not fire below twice the usual rate", () => {
    expect(detectFees(feeRow({ concessions_recent: 6, concessions_base: 10 }), AS_OF)).toEqual([]);
  });

  it("shows the usual rate to 1 dp", () => {
    const [c] = detectFees(feeRow({ concessions_recent: 5, concessions_base: 7 }), AS_OF);
    expect(c.evidence[1]).toEqual({ label: "Usual per 4 weeks", value: 2.3 });
  });
});

describe("detectFees: edge cases", () => {
  it("returns [] for a null fee row", () => {
    expect(detectFees(null, AS_OF)).toEqual([]);
  });

  it("returns both signals from one row", () => {
    const out = detectFees(
      feeRow({ overdue_then: 100000, overdue_now: 160000, concessions_recent: 6, concessions_base: 9 }),
      AS_OF,
    );
    expect(out.map((c) => c.signal)).toEqual(["finance.overdue_growth", "finance.concession_spike"]);
  });

  it("keeps recommended actions to 1-2 plain strings without digits", () => {
    const out = detectFees(
      feeRow({ overdue_then: 100000, overdue_now: 160000, concessions_recent: 6, concessions_base: 9 }),
      AS_OF,
    );
    for (const c of out) {
      expect(c.recommended_actions.length).toBeGreaterThanOrEqual(1);
      expect(c.recommended_actions.length).toBeLessThanOrEqual(2);
      for (const a of c.recommended_actions) {
        expect(a.length).toBeLessThanOrEqual(160);
        expect(a).not.toMatch(/\d/);
      }
    }
  });
});

describe("detectAdmissions: admissions.stage_dwell", () => {
  it("exports the stage thresholds in days", () => {
    expect(ADMISSION_STAGE_THRESHOLDS).toEqual({
      "enquiry.new": 2,
      "enquiry.contacted": 7,
      "enquiry.visit_scheduled": 14,
      "enquiry.application_sent": 14,
      "application.submitted": 7,
      "application.under_review": 7,
      "application.interaction_scheduled": 14,
    });
  });

  it("flags 6 stale of 12 open as watch", () => {
    const out = detectAdmissions([stageRow("enquiry.contacted", 12, { over_7: 6 })], AS_OF);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      signal: "admissions.stage_dwell",
      detector_version: 1,
      dedupe_key: "admissions.stage_dwell:school:-:2026-W44",
      domain: "admissions",
      kind: "diagnostic",
      reviewer_role: "admissions",
      severity: "watch",
      confidence: 0.75,
      approval_required: false,
      title: "Admissions follow-ups are stalling",
      sources: ["enquiries", "applications"],
      date_to: AS_OF,
      entity_type: null,
      class_section_id: null,
    });
    expect(out[0].evidence).toEqual([
      { label: "Contacted enquiries waiting > 7 days", value: 6 },
      { label: "Open items", value: 12 },
    ]);
  });

  it("flags 10 stale new enquiries as warning", () => {
    const [c] = detectAdmissions([stageRow("enquiry.new", 15, { over_2: 10 })], AS_OF);
    expect(c.severity).toBe("warning");
  });

  it("ignores 4 stale items", () => {
    expect(detectAdmissions([stageRow("enquiry.new", 4, { over_2: 4 })], AS_OF)).toEqual([]);
  });

  it("ignores stale items under a quarter of open items", () => {
    expect(detectAdmissions([stageRow("application.submitted", 30, { over_7: 6 })], AS_OF)).toEqual([]);
  });

  it("reads only each stage's own threshold column", () => {
    expect(detectAdmissions([stageRow("enquiry.visit_scheduled", 10, { over_2: 9, over_7: 9, over_14: 1 })], AS_OF)).toEqual([]);
  });

  it("sums stages: 20 stale is warning and evidence lists the top 4 stages then open items", () => {
    const rows = [
      stageRow("enquiry.new", 6, { over_2: 2 }),
      stageRow("enquiry.contacted", 8, { over_7: 6 }),
      stageRow("enquiry.visit_scheduled", 5, { over_14: 3 }),
      stageRow("application.submitted", 9, { over_7: 6 }),
      stageRow("application.under_review", 4, { over_7: 3 }),
      stageRow("application.interaction_scheduled", 2),
    ];
    const [c] = detectAdmissions(rows, AS_OF);
    expect(c.severity).toBe("warning");
    expect(c.evidence).toEqual([
      { label: "Submitted applications waiting > 7 days", value: 6 },
      { label: "Contacted enquiries waiting > 7 days", value: 6 },
      { label: "Applications under review waiting > 7 days", value: 3 },
      { label: "Visit-scheduled enquiries waiting > 14 days", value: 3 },
      { label: "Open items", value: 34 },
    ]);
  });

  it("returns [] for no rows", () => {
    expect(detectAdmissions([], AS_OF)).toEqual([]);
  });
});

describe("detector objects", () => {
  it("feesDetector calls insight_src_fees once and uses its single row", async () => {
    const { admin, calls } = fakeAdmin({ data: [feeRow({ overdue_then: 0, overdue_now: 30000 })], error: null });
    const out = await feesDetector.run(admin, { institutionId: "inst-1", asOf: AS_OF, settings: {} });
    expect(feesDetector).toMatchObject({ key: "fees", module: "fees", version: 1 });
    expect(calls).toEqual([{ fn: "insight_src_fees", args: { p_institution_id: "inst-1", p_as_of: AS_OF } }]);
    expect(out.map((c) => c.signal)).toEqual(["finance.overdue_growth"]);
  });

  it("feesDetector returns [] when the source returns no row", async () => {
    const { admin } = fakeAdmin({ data: [], error: null });
    expect(await feesDetector.run(admin, { institutionId: "inst-1", asOf: AS_OF, settings: {} })).toEqual([]);
  });

  it("feesDetector throws the source error", async () => {
    const err = { message: "boom" };
    const { admin } = fakeAdmin({ data: null, error: err });
    await expect(feesDetector.run(admin, { institutionId: "inst-1", asOf: AS_OF, settings: {} })).rejects.toBe(err);
  });

  it("admissionsDetector calls insight_src_admissions and detects over its rows", async () => {
    const { admin, calls } = fakeAdmin({ data: [stageRow("enquiry.new", 12, { over_2: 10 })], error: null });
    const out = await admissionsDetector.run(admin, { institutionId: "inst-1", asOf: AS_OF, settings: {} });
    expect(admissionsDetector).toMatchObject({ key: "admissions", module: "admissions", version: 1 });
    expect(calls).toEqual([{ fn: "insight_src_admissions", args: { p_institution_id: "inst-1", p_as_of: AS_OF } }]);
    expect(out.map((c) => c.severity)).toEqual(["warning"]);
  });
});
