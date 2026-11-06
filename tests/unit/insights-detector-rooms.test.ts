import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { detectRoomPressure, resourceShortageDetector, type RoomSourceRow } from "@/modules/insights/detectors/resource-shortage";

const AS_OF = "2026-11-01";
const VERSION_ID = "11111111-1111-1111-1111-111111111111";

function room(over: Partial<RoomSourceRow> = {}): RoomSourceRow {
  return {
    version_id: VERSION_ID,
    room_id: "room-0",
    room_name: "Room 0",
    periods_used: 0,
    periods_total: 20,
    open_maintenance: 0,
    ...over,
  };
}

/** `n` rooms, each used for `usedEach` periods out of `total`, named Room 1..n. */
function rooms(n: number, usedEach: number, total = 20, over: Partial<RoomSourceRow> = {}): RoomSourceRow[] {
  return Array.from({ length: n }, (_, i) =>
    room({ room_id: `room-${i + 1}`, room_name: `Room ${i + 1}`, periods_used: usedEach, periods_total: total, ...over }),
  );
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

describe("detectRoomPressure: operations.room_pressure", () => {
  it("2 of 10 used rooms hot (90%+) is a watch", () => {
    const rows = [...rooms(2, 18), ...rooms(8, 10)]; // 2 hot (18/20=90%), 8 in-use but not hot
    const out = detectRoomPressure(rows, AS_OF);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      signal: "operations.room_pressure",
      detector_version: 1,
      dedupe_key: `operations.room_pressure:school:-:${VERSION_ID}`,
      domain: "operations",
      kind: "diagnostic",
      reviewer_role: "admin",
      severity: "watch",
      title: "Teaching rooms close to full",
      confidence: 0.9,
      approval_required: false,
      sources: ["timetable_slots", "rooms", "periods", "maintenance_requests"],
      date_from: AS_OF,
      date_to: AS_OF,
      entity_type: null,
      entity_id: null,
      entity_label: null,
      class_section_id: null,
      factors: [],
    });
    expect(out[0].evidence.slice(0, 3)).toEqual([
      { label: "Rooms ≥ 90% booked", value: 2 },
      { label: "Rooms in use", value: 10 },
      { label: "Open repairs in busy rooms", value: 0 },
    ]);
  });

  it("4 of 10 used rooms hot is a warning (hot >= 0.4 x in-use)", () => {
    const rows = [...rooms(4, 18), ...rooms(6, 10)];
    const [c] = detectRoomPressure(rows, AS_OF);
    expect(c).toMatchObject({ severity: "warning" });
    expect(c.evidence.slice(0, 3)).toEqual([
      { label: "Rooms ≥ 90% booked", value: 4 },
      { label: "Rooms in use", value: 10 },
      { label: "Open repairs in busy rooms", value: 0 },
    ]);
  });

  it("a hot room with an open repair is a warning even below the 0.4 ratio", () => {
    const rows = [room({ room_id: "h1", room_name: "Room H1", periods_used: 18, open_maintenance: 1 }), room({ room_id: "h2", room_name: "Room H2", periods_used: 18 }), ...rooms(8, 10)];
    const [c] = detectRoomPressure(rows, AS_OF);
    expect(c).toMatchObject({ severity: "warning" });
    expect(c.evidence[2]).toEqual({ label: "Open repairs in busy rooms", value: 1 });
  });

  it("only 1 hot room never fires", () => {
    const rows = [...rooms(1, 18), ...rooms(9, 10)];
    expect(detectRoomPressure(rows, AS_OF)).toEqual([]);
  });

  it("periods_total 0 never fires", () => {
    const rows = rooms(5, 0, 0);
    expect(detectRoomPressure(rows, AS_OF)).toEqual([]);
  });

  it("excludes unused rooms (periods_used 0) from the in-use denominator", () => {
    // 2 hot of 2 in-use (unused rooms would otherwise dilute the ratio below the 0.2 threshold)
    const rows = [...rooms(2, 18), ...rooms(20, 0)];
    const [c] = detectRoomPressure(rows, AS_OF);
    expect(c).toMatchObject({ severity: "warning" }); // 2 hot / 2 in-use >= 0.4
    expect(c.evidence[1]).toEqual({ label: "Rooms in use", value: 2 });
  });

  it("returns [] for no rows", () => {
    expect(detectRoomPressure([], AS_OF)).toEqual([]);
  });

  it("lists the top 3 hottest rooms by booked %, ties broken by room name", () => {
    const rows = [
      room({ room_id: "a", room_name: "Room A", periods_used: 20, periods_total: 20 }),
      room({ room_id: "b", room_name: "Room B", periods_used: 19, periods_total: 20 }),
      room({ room_id: "c", room_name: "Room C", periods_used: 18, periods_total: 20 }),
      room({ room_id: "d", room_name: "Room D", periods_used: 18, periods_total: 20 }),
      room({ room_id: "e", room_name: "Room E", periods_used: 0, periods_total: 20 }),
    ];
    const [c] = detectRoomPressure(rows, AS_OF);
    expect(c.evidence.slice(3)).toEqual([
      { label: "Room A booked", value: 100, unit: "%" },
      { label: "Room B booked", value: 95, unit: "%" },
      { label: "Room C booked", value: 90, unit: "%" },
    ]);
  });
});

describe("resourceShortageDetector", () => {
  it("calls insight_src_rooms once and detects over its rows", async () => {
    const rows = [...rooms(2, 18), ...rooms(8, 10)];
    const { admin, calls } = fakeAdmin({ data: rows, error: null });
    const out = await resourceShortageDetector.run(admin, { institutionId: "inst-1", asOf: AS_OF, settings: {} });
    expect(resourceShortageDetector).toMatchObject({ key: "resource-shortage", module: "timetable", version: 1 });
    expect(calls).toEqual([{ fn: "insight_src_rooms", args: { p_institution_id: "inst-1", p_as_of: AS_OF } }]);
    expect(out.map((c) => c.signal)).toEqual(["operations.room_pressure"]);
  });

  it("returns [] when the source returns no rows", async () => {
    const { admin } = fakeAdmin({ data: [], error: null });
    expect(await resourceShortageDetector.run(admin, { institutionId: "inst-1", asOf: AS_OF, settings: {} })).toEqual([]);
  });

  it("throws the source error", async () => {
    const err = { message: "boom" };
    const { admin } = fakeAdmin({ data: null, error: err });
    await expect(resourceShortageDetector.run(admin, { institutionId: "inst-1", asOf: AS_OF, settings: {} })).rejects.toBe(err);
  });
});
