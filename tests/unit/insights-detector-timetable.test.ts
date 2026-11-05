import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import {
  detectRoomCapacity,
  timetableConflictsDetector,
  type RoomCapacitySourceRow,
} from "@/modules/insights/detectors/timetable-conflicts";
import { detectWorkload, workloadDetector, type WorkloadSourceRow } from "@/modules/insights/detectors/workload";

const AS_OF = "2026-11-01";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const STAFF = "44444444-4444-4444-8444-444444444444";
const SECTION = "22222222-2222-4222-8222-222222222222";

function workloadRow(periods: number, overrides: Partial<WorkloadSourceRow> = {}): WorkloadSourceRow {
  return { version_id: VERSION_ID, staff_id: STAFF, periods_week: periods, ...overrides };
}

function capacityRow(strength: number, smallest: number, slotsOver: number): RoomCapacitySourceRow {
  return {
    version_id: VERSION_ID,
    class_section_id: SECTION,
    section_label: "8-A",
    strength,
    smallest_capacity: smallest,
    slots_over: slotsOver,
  };
}

// Minimal stand-in for `admin.rpc(...).order(...).range(...)`: serves `rows`
// in the requested window and records each call.
function fakeAdmin(rows: unknown[]) {
  const calls: { fn: string; args: unknown; from: number; to: number }[] = [];
  const client = {
    rpc(fn: string, args: unknown) {
      const builder = {
        order: () => builder,
        range: (from: number, to: number) => {
          calls.push({ fn, args, from, to });
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
        },
      };
      return builder;
    },
  };
  return { admin: client as unknown as SupabaseClient<Database>, calls };
}

describe("detectWorkload", () => {
  it("flags 37 periods against a limit of 36 as watch", () => {
    const [c] = detectWorkload([workloadRow(37)], AS_OF, 36);
    expect(c.signal).toBe("staff.workload");
    expect(c.severity).toBe("watch");
    expect(c.confidence).toBe(0.95);
    expect(c.domain).toBe("staff");
    expect(c.kind).toBe("descriptive");
    expect(c.reviewer_role).toBe("principal");
    expect(c.approval_required).toBe(false);
    expect(c.title).toBe("Teacher timetable above the weekly limit");
    expect(c.evidence).toEqual([
      { label: "Periods per week", value: 37 },
      { label: "Limit", value: 36 },
    ]);
    expect(c).toMatchObject({ entity_type: "staff", entity_id: STAFF, entity_label: null, class_section_id: null });
  });

  it("rates 4+ periods over the limit as warning", () => {
    expect(detectWorkload([workloadRow(40)], AS_OF, 36)[0].severity).toBe("warning");
    expect(detectWorkload([workloadRow(39)], AS_OF, 36)[0].severity).toBe("watch");
  });

  it("does not fire at the limit", () => {
    expect(detectWorkload([workloadRow(36)], AS_OF, 36)).toEqual([]);
  });

  it("uses the timetable version id as the window", () => {
    const [c] = detectWorkload([workloadRow(37)], AS_OF, 36);
    expect(c.dedupe_key).toBe(`staff.workload:staff:${STAFF}:${VERSION_ID}`);
  });

  it("keeps ids out of the title and pattern", () => {
    const [c] = detectWorkload([workloadRow(37)], AS_OF, 36);
    expect(c.title).not.toContain(STAFF);
    expect(c.pattern).not.toContain(STAFF);
    expect(c.pattern).not.toContain(VERSION_ID);
  });
});

describe("detectRoomCapacity", () => {
  it("flags strength 42 in a 30-seat room as warning", () => {
    const [c] = detectRoomCapacity([capacityRow(42, 30, 2)], AS_OF);
    expect(c.signal).toBe("operations.room_capacity");
    expect(c.severity).toBe("warning");
    expect(c.confidence).toBe(0.95);
    expect(c.domain).toBe("operations");
    expect(c.reviewer_role).toBe("admin");
    expect(c.title).toBe("Rooms too small for 8-A");
    expect(c.evidence).toEqual([
      { label: "Section strength", value: 42 },
      { label: "Smallest room capacity", value: 30 },
      { label: "Periods in too-small rooms", value: 2 },
    ]);
    expect(c).toMatchObject({
      entity_type: "section",
      entity_id: SECTION,
      entity_label: "8-A",
      class_section_id: SECTION,
    });
  });

  it("rates 3 short seats in 2 slots as watch", () => {
    expect(detectRoomCapacity([capacityRow(33, 30, 2)], AS_OF)[0].severity).toBe("watch");
  });

  it("rates 12+ periods in too-small rooms as warning", () => {
    expect(detectRoomCapacity([capacityRow(33, 30, 12)], AS_OF)[0].severity).toBe("warning");
  });

  it("uses the timetable version id as the window", () => {
    const [c] = detectRoomCapacity([capacityRow(33, 30, 2)], AS_OF);
    expect(c.dedupe_key).toBe(`operations.room_capacity:section:${SECTION}:${VERSION_ID}`);
  });
});

describe("detector objects", () => {
  it("workloadDetector falls back to 36 when the setting is not a number", async () => {
    const { admin, calls } = fakeAdmin([workloadRow(37)]);
    const out = await workloadDetector.run(admin, {
      institutionId: "inst-1",
      asOf: AS_OF,
      settings: { timetable: { max_periods_week: "x" } },
    });
    expect(workloadDetector).toMatchObject({ key: "workload", module: "timetable", version: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ fn: "insight_src_workload", args: { p_institution_id: "inst-1", p_as_of: AS_OF } });
    expect(out).toHaveLength(1);
    expect(out[0].evidence[1]).toEqual({ label: "Limit", value: 36 });
  });

  it("workloadDetector reads the limit from settings", async () => {
    const { admin } = fakeAdmin([workloadRow(37)]);
    const out = await workloadDetector.run(admin, {
      institutionId: "inst-1",
      asOf: AS_OF,
      settings: { timetable: { max_periods_week: 40 } },
    });
    expect(out).toEqual([]);
  });

  it("timetableConflictsDetector pages the source in 1000s", async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({ ...capacityRow(33, 30, 2), class_section_id: `section-${i}` }));
    const { admin, calls } = fakeAdmin(rows);
    const out = await timetableConflictsDetector.run(admin, { institutionId: "inst-1", asOf: AS_OF, settings: {} });
    expect(timetableConflictsDetector).toMatchObject({ key: "timetable-conflicts", module: "timetable", version: 1 });
    expect(calls.map((c) => [c.from, c.to])).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(calls[0]).toMatchObject({ fn: "insight_src_room_capacity", args: { p_institution_id: "inst-1", p_as_of: AS_OF } });
    expect(out).toHaveLength(1001);
  });
});
