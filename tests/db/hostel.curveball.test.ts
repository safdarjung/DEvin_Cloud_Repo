// Curveball sweep (hostel): action-level coverage for room/allocation/vacate/roll-call — role gates, cross-tenant ids,
// Zod fieldErrors, double-booked beds under concurrency, vacate twice, capacity below occupancy.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { allocateRoom, createRoom, saveRollCall, updateRoom, vacateAllocation } from "@/modules/hostel/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
let a: TestInstitution;
let b: TestInstitution;

async function student(inst: TestInstitution): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${inst.institutionId}, ${`HCB-${crypto.randomUUID().slice(0, 8)}`}, 'Res', '2012-01-01', 'other') returning id
  `;
  return row.id as string;
}
async function room(inst: TestInstitution, capacity: number): Promise<string> {
  const r = await callAs(inst, "admin", createRoom, { block: "A", roomNo: crypto.randomUUID().slice(0, 8), capacity });
  if (!r.ok) throw new Error(`room: ${r.error.code}`);
  return r.data.id;
}
async function occupants(roomId: string): Promise<number> {
  const [r] = await sql`select count(*)::int as n from public.hostel_allocations where room_id = ${roomId} and vacated_on is null`;
  return r.n as number;
}

beforeAll(async () => {
  a = await createTestInstitution("hostel-cb");
  b = await createTestInstitution("hostel-cb-x");
}, 60_000);

afterAll(async () => {
  await a?.cleanup();
  await b?.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

describe("hostel rooms", () => {
  it.each([
    ["capacity 0", { block: "A", roomNo: "1", capacity: 0 }, "capacity"],
    ["capacity 51", { block: "A", roomNo: "1", capacity: 51 }, "capacity"],
    ["fractional capacity", { block: "A", roomNo: "1", capacity: 1.5 }, "capacity"],
    ["blank block", { block: "  ", roomNo: "1", capacity: 2 }, "block"],
    ["room no too long", { block: "A", roomNo: "x".repeat(21), capacity: 2 }, "roomNo"],
  ])("create: %s → validation_failed on %s", async (_l, body, field) => {
    const r = await callAs(a, "admin", createRoom, body);
    expect(r.ok ? null : r.error.code).toBe("validation_failed");
    expect(r.ok ? null : r.error.fieldErrors?.[field as string]).toBeTruthy();
  });

  it("duplicate block+room → conflict", async () => {
    const roomNo = crypto.randomUUID().slice(0, 8);
    expect((await callAs(a, "admin", createRoom, { block: "B", roomNo, capacity: 2 })).ok).toBe(true);
    const dup = await callAs(a, "principal", createRoom, { block: "B", roomNo, capacity: 3 });
    expect(dup.ok ? null : dup.error.code).toBe("conflict");
  });

  it("teacher, accountant and guardian are forbidden from every hostel action", async () => {
    const roomId = await room(a, 2);
    const sid = await student(a);
    for (const role of ["teacher", "accountant", "guardian"] as const) {
      const rs = [
        await callAs(a, role, createRoom, { block: "Z", roomNo: "9", capacity: 2 }),
        await callAs(a, role, updateRoom, { id: roomId, block: "Z", roomNo: "9", capacity: 2, isActive: true }),
        await callAs(a, role, allocateRoom, { roomId, studentId: sid }),
        await callAs(a, role, vacateAllocation, { allocationId: crypto.randomUUID() }),
        await callAs(a, role, saveRollCall, { takenOn: "2026-11-01", session: "night", entries: [{ studentId: sid, status: "present" }] }),
      ];
      expect(rs.map((r) => (r.ok ? "ok" : r.error.code))).toEqual(Array(5).fill("forbidden"));
    }
  });

  it("update: another school's room → not_found; capacity below occupancy → conflict", async () => {
    const foreign = await room(b, 2);
    const x = await callAs(a, "admin", updateRoom, { id: foreign, block: "A", roomNo: "x", capacity: 2, isActive: true });
    expect(x.ok ? null : x.error.code).toBe("not_found");
    const roomId = await room(a, 2);
    for (let i = 0; i < 2; i++) expect((await callAs(a, "admin", allocateRoom, { roomId, studentId: await student(a) })).ok).toBe(true);
    const shrink = await callAs(a, "admin", updateRoom, { id: roomId, block: "A", roomNo: "shrunk", capacity: 1, isActive: true });
    expect(shrink.ok ? null : shrink.error.code).toBe("conflict");
    const deactivate = await callAs(a, "admin", updateRoom, { id: roomId, block: "A", roomNo: "shrunk", capacity: 2, isActive: false });
    expect(deactivate.ok ? null : deactivate.error.code).toBe("conflict");
  });
});

describe("hostel allocations", () => {
  it("last bed: three students race for a 1-bed room — exactly one gets it", async () => {
    const roomId = await room(a, 1);
    const students = [await student(a), await student(a), await student(a)];
    const rs = await Promise.all(students.map((studentId) => callAs(a, "admin", allocateRoom, { roomId, studentId })));
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(rs.filter((r) => !r.ok).map((r) => (r.ok ? "" : r.error.code))).toEqual(["conflict", "conflict"]);
    expect(await occupants(roomId)).toBe(1);
  });

  it("one student allocated to two rooms in parallel: exactly one active allocation", async () => {
    const sid = await student(a);
    const [r1, r2] = [await room(a, 4), await room(a, 4)];
    const rs = await Promise.all([r1, r2].map((roomId) => callAs(a, "admin", allocateRoom, { roomId, studentId: sid })));
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    const [c] = await sql`select count(*)::int as n from public.hostel_allocations where student_id = ${sid} and vacated_on is null`;
    expect(c.n).toBe(1);
  });

  it("another school's student or room → refused (not_found), nothing written", async () => {
    const roomId = await room(a, 2);
    const foreignStudent = await student(b);
    const s = await callAs(a, "admin", allocateRoom, { roomId, studentId: foreignStudent });
    expect(s.ok ? null : s.error.code).toBe("not_found");
    const foreignRoom = await room(b, 2);
    const r = await callAs(a, "admin", allocateRoom, { roomId: foreignRoom, studentId: await student(a) });
    expect(r.ok ? null : r.error.code).toBe("not_found");
    expect(await occupants(foreignRoom)).toBe(0);
  });

  it("vacate twice → invalid_state; unknown allocation → not_found; another school's allocation → not_found", async () => {
    const roomId = await room(a, 2);
    const al = await callAs(a, "admin", allocateRoom, { roomId, studentId: await student(a) });
    if (!al.ok) throw new Error(al.error.code);
    expect((await callAs(a, "admin", vacateAllocation, { allocationId: al.data.allocationId })).ok).toBe(true);
    const again = await callAs(a, "principal", vacateAllocation, { allocationId: al.data.allocationId });
    expect(again.ok ? null : again.error.code).toBe("invalid_state");
    const unknown = await callAs(a, "admin", vacateAllocation, { allocationId: crypto.randomUUID() });
    expect(unknown.ok ? null : unknown.error.code).toBe("not_found");
    const bRoom = await room(b, 2);
    const bAl = await callAs(b, "admin", allocateRoom, { roomId: bRoom, studentId: await student(b) });
    if (!bAl.ok) throw new Error(bAl.error.code);
    const cross = await callAs(a, "admin", vacateAllocation, { allocationId: bAl.data.allocationId });
    expect(cross.ok ? null : cross.error.code).toBe("not_found");
  });
});

describe("hostel roll call", () => {
  it("duplicate student in entries / empty entries / bad session → validation_failed with fieldErrors", async () => {
    const sid = crypto.randomUUID();
    const dup = await callAs(a, "admin", saveRollCall, {
      takenOn: "2026-11-02",
      session: "night",
      entries: [{ studentId: sid, status: "present" }, { studentId: sid, status: "absent" }],
    });
    expect(dup.ok ? null : dup.error.fieldErrors?.entries).toBeTruthy();
    const empty = await callAs(a, "admin", saveRollCall, { takenOn: "2026-11-02", session: "night", entries: [] });
    expect(empty.ok ? null : empty.error.fieldErrors?.entries).toBeTruthy();
    const bad = await callAs(a, "admin", saveRollCall, { takenOn: "2026-11-02", session: "noon", entries: [{ studentId: sid, status: "present" }] });
    expect(bad.ok ? null : bad.error.fieldErrors?.session).toBeTruthy();
  });

  it("a student without an active allocation (or from another school) is refused; absent count is reported on success", async () => {
    const roomId = await room(a, 3);
    const resident = await student(a);
    const al = await callAs(a, "admin", allocateRoom, { roomId, studentId: resident });
    expect(al.ok).toBe(true);
    const nonResident = await student(a);
    const bad = await callAs(a, "admin", saveRollCall, {
      takenOn: "2026-11-03",
      session: "evening",
      entries: [{ studentId: resident, status: "present" }, { studentId: nonResident, status: "absent" }],
    });
    expect(bad.ok ? null : bad.error.code).toBe("validation_failed");
    const foreign = await callAs(a, "admin", saveRollCall, {
      takenOn: "2026-11-03",
      session: "evening",
      entries: [{ studentId: await student(b), status: "present" }],
    });
    expect(foreign.ok ? null : foreign.error.code).toBe("validation_failed");
    const ok = await callAs(a, "admin", saveRollCall, { takenOn: "2026-11-03", session: "evening", entries: [{ studentId: resident, status: "absent", note: "Home visit" }] });
    expect(ok.ok ? ok.data.absent : null).toBe(1);
  });
});
