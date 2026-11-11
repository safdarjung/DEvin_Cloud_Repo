import { insertBatch } from "../lib/batch.ts";
import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";

// Features-18 #7 — demo hostel: 12 rooms, up to 30 residents, 6 roll calls.
// Service-role inserts bypass RLS, so taken_by / allocated_by are set explicitly.
// No rng draws: never shifts another section's PRNG output.

const BLOCKS = ["Boys A", "Girls B"] as const;
const ROOMS_PER_BLOCK = 6;
const CAPACITY = 4;
const MAX_RESIDENTS = 30;
const CALLS = [
  ["2026-11-06", "morning"],
  ["2026-11-06", "night"],
  ["2026-11-07", "morning"],
  ["2026-11-07", "night"],
  ["2026-11-08", "morning"],
  ["2026-11-08", "night"],
] as const;

export async function run(ctx: SeedContext): Promise<void> {
  const adminUserId = ctx.userIdByLogin["admin"]!;
  const inst = ctx.institutionId;

  const rooms = BLOCKS.flatMap((block) =>
    Array.from({ length: ROOMS_PER_BLOCK }, (_, i) => ({
      id: uuidV5("hostel-room", `${inst}:${block}:${i}`),
      institution_id: inst,
      block,
      room_no: String(101 + i),
      capacity: CAPACITY,
    })),
  );
  await insertBatch(ctx.admin, "hostel_rooms", rooms);

  const students = Object.values(ctx.studentsBySection)
    .flat()
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, MAX_RESIDENTS);

  // Fill rooms in order; capacity 4 x 12 rooms = 48 >= 30 so none overflows.
  const allocations = students.map((s, i) => ({
    id: uuidV5("hostel-alloc", `${inst}:${s.id}`),
    institution_id: inst,
    room_id: rooms[Math.floor(i / CAPACITY)]!.id,
    student_id: s.id,
    allocated_on: "2026-10-01",
    allocated_by: adminUserId,
  }));
  await insertBatch(ctx.admin, "hostel_allocations", allocations);

  const calls = CALLS.map(([taken_on, session]) => ({
    id: uuidV5("hostel-call", `${inst}:${taken_on}:${session}`),
    institution_id: inst,
    taken_on,
    session,
    taken_by: adminUserId,
  }));
  await insertBatch(ctx.admin, "hostel_roll_calls", calls);

  const entries = calls.flatMap((c, ci) =>
    students.map((s, si) => {
      const n = (ci * 7 + si * 3) % 17;
      return {
        id: uuidV5("hostel-entry", `${c.id}:${s.id}`),
        institution_id: inst,
        roll_call_id: c.id,
        student_id: s.id,
        status: n === 0 ? "absent" : n === 1 ? "on_leave" : "present",
        note: n === 1 ? "Home visit" : null,
      };
    }),
  );
  await insertBatch(ctx.admin, "hostel_roll_call_entries", entries);
}
