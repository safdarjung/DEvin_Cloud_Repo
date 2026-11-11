import { insertBatch } from "../lib/batch.ts";
import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";

// Features-18 #24 — demo duty roster: 4 duty types, 7 weekdays (2026-11-09..17) of rotation, 3 swap requests.
// Staff rotate round-robin over the teaching staff so nobody doubles up on a day. Deterministic, no rng draws.
const TYPES: [string, number][] = [["Gate", 1], ["Bus", 1], ["Lunch", 2], ["Assembly", 1]];
const DAYS = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-16", "2026-11-17"];

export async function run(ctx: SeedContext): Promise<void> {
  const inst = ctx.institutionId;
  const staff = ctx.teacherStaffIds;
  const types = TYPES.map(([name, slots_per_day]) => ({ id: uuidV5("duty-type", `${inst}:${name}`), institution_id: inst, name, slots_per_day, is_active: true }));
  await insertBatch(ctx.admin, "duty_types", types);

  let cursor = 0;
  const assignments = DAYS.flatMap((date, di) =>
    types.flatMap((t, ti) =>
      Array.from({ length: TYPES[ti]![1] }, (_, slot) => ({
        id: uuidV5("duty-assignment", `${inst}:${di}:${ti}:${slot}`),
        institution_id: inst,
        duty_type_id: t.id,
        staff_id: staff[cursor++ % staff.length]!,
        date,
        status: "assigned",
      })),
    ),
  );

  // Three swaps on future rows (Nov 16-17, first Gate/Bus rows): pending, rejected, accepted (row already moved).
  const gate = (di: number) => assignments.find((a) => a.date === DAYS[di] && a.duty_type_id === types[0]!.id)!;
  const bus = (di: number) => assignments.find((a) => a.date === DAYS[di] && a.duty_type_id === types[1]!.id)!;
  const pendingRow = gate(5);
  const rejectedRow = bus(5);
  const acceptedRow = gate(6);
  const acceptedFrom = acceptedRow.staff_id;
  const acceptedTo = staff[(staff.indexOf(acceptedFrom) + 40) % staff.length]!;
  acceptedRow.staff_id = acceptedTo;
  acceptedRow.status = "swapped";
  await insertBatch(ctx.admin, "duty_assignments", assignments);

  const userOf = (staffId: string) => Object.entries(ctx.linkIdByLogin).find(([, v]) => v === staffId)?.[0];
  const requester = (staffId: string) => ctx.userIdByLogin[userOf(staffId) ?? ""] ?? ctx.userIdByLogin["admin"]!;
  const other = (staffId: string, k: number) => staff[(staff.indexOf(staffId) + k) % staff.length]!;
  const swaps = [
    { row: pendingRow, from: pendingRow.staff_id, to: other(pendingRow.staff_id, 7), status: "pending" },
    { row: rejectedRow, from: rejectedRow.staff_id, to: other(rejectedRow.staff_id, 11), status: "rejected" },
    { row: acceptedRow, from: acceptedFrom, to: acceptedTo, status: "accepted" },
  ].map((s, i) => ({
    id: uuidV5("duty-swap", `${inst}:${i}`),
    institution_id: inst,
    assignment_id: s.row.id,
    from_staff_id: s.from,
    to_staff_id: s.to,
    status: s.status,
    requested_by: requester(s.from),
    decided_at: s.status === "pending" ? null : "2026-11-10T16:00:00+05:30",
  }));
  await insertBatch(ctx.admin, "duty_swap_requests", swaps);
}
