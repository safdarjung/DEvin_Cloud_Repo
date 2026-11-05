import { insertBatch } from "../lib/batch.ts";
import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";

// X07-T9 (X07-tasks.md Task 9) — demo visitor log, pickup persons and gate
// passes. Registered last: reads students/guardians (people) and staff
// login ids (core/staffing) that every earlier section has already
// written. Fully deterministic (fixed uuidV5 ids, fixed timestamps,
// service-role client) — no `ctx.rng` draws, so this section never
// disturbs any other section's PRNG sequence.
//
// Inserted directly as already-decided/-checked-out rows: the
// service-role bypass in `app.guard_visitor_entries` /
// `app.gate_pass_before_insert` (0090) is what makes that legal (lesson
// 5) — a real end-user JWT could never submit a pre-exited gate pass.
// `visitors` module: on for the demo tenant via `allModulesOn()`
// (core.ts) — asserted by the test, not re-toggled here.

const VISITOR_DAYS = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"];
const CHECK_IN_TIMES = ["09:00", "10:30", "12:00", "13:30", "15:00"];
const CHECK_OUT_TIMES = ["09:30", "11:00", "12:30", "14:00", "15:30"];
const PURPOSES = ["Fee enquiry", "PTM", "Vendor delivery", "Admission enquiry", "Meeting principal"] as const;
const ID_TYPE_CYCLE = ["aadhaar", "driving_licence", "voter_id", "pan", "passport", "other"] as const;

// 5 visitors/day: 3 have a host staff member (office staff or the VI-A
// class teacher), 2 instead name a department (rulings: "else
// meeting_with Office/Accounts"). Same slot pattern every day — this
// section's job is a fixed, readable fixture, not variety.
const HOST_LOGIN_BY_SLOT: (string | null)[] = ["principal", "teacher.vi-a", null, "admin", null];
const MEETING_WITH_BY_SLOT: (string | null)[] = [null, null, "Office", null, "Accounts"];

// 25 fictional visitors — distinct from every named demo individual
// (Sharma/Mehta/Yadav families) so nobody mistakes a logged visitor for a
// student's family member.
const VISITOR_NAMES = [
  "Vikram Nair",
  "Sunita Joshi",
  "Ravi Kapoor",
  "Deepa Iyer",
  "Anil Chawla",
  "Meena Pillai",
  "Sanjay Gupta",
  "Kavita Rao",
  "Arjun Bhatt",
  "Pooja Malhotra",
  "Rajesh Verma",
  "Neha Saxena",
  "Vivek Chauhan",
  "Shalini Menon",
  "Karan Thakur",
  "Divya Reddy",
  "Manoj Tiwari",
  "Priyanka Desai",
  "Ashok Pandey",
  "Nisha Bhatia",
  "Rahul Khanna",
  "Swati Agarwal",
  "Deepak Mehra",
  "Rekha Shetty",
  "Vinod Kulkarni",
];

function byFirstName(a: { firstName: string }, b: { firstName: string }): number {
  return a.firstName.toLowerCase().localeCompare(b.firstName.toLowerCase());
}

export async function run(ctx: SeedContext): Promise<void> {
  const adminUserId = ctx.userIdByLogin["admin"]!; // front desk = admin role (rulings)
  const guardianOneUserId = ctx.userIdByLogin["guardian.one"]!;
  const guardianOneId = ctx.linkIdByLogin["guardian.one"]!;
  const aaravId = ctx.studentsBySection["VI-A"]!.find((s) => s.firstName === "Aarav")!.id;
  const ananyaId = ctx.studentsBySection["X-A"]!.find((s) => s.firstName === "Ananya")!.id;

  // ---- visitor_entries: 25 entries, 5/day, 2026-10-26..30, 09:00-15:00 IST, all checked out ----
  const entryRows: Record<string, unknown>[] = [];
  let idx = 0;
  for (const day of VISITOR_DAYS) {
    for (let slot = 0; slot < 5; slot++) {
      const nn = String(idx + 1).padStart(2, "0");
      const hostLogin = HOST_LOGIN_BY_SLOT[slot]!;
      const hasId = idx % 2 === 0;
      entryRows.push({
        id: uuidV5("visitors", `entry:${idx}`),
        institution_id: ctx.institutionId,
        full_name: VISITOR_NAMES[idx]!,
        phone: `97000000${nn}`,
        purpose: PURPOSES[idx % PURPOSES.length],
        host_staff_id: hostLogin ? ctx.linkIdByLogin[hostLogin]! : null,
        meeting_with: hostLogin ? null : MEETING_WITH_BY_SLOT[slot]!,
        id_type: hasId ? ID_TYPE_CYCLE[idx % ID_TYPE_CYCLE.length]! : null,
        id_last4: hasId ? String(1000 + idx).slice(-4) : null,
        checked_in_at: `${day}T${CHECK_IN_TIMES[slot]}:00+05:30`,
        checked_in_by: adminUserId,
        checked_out_at: `${day}T${CHECK_OUT_TIMES[slot]}:00+05:30`,
        checked_out_by: adminUserId,
      });
      idx++;
    }
  }
  await insertBatch(ctx.admin, "visitor_entries", entryRows);

  // ---- pickup_persons: Aarav's grandfather + van driver, Ananya's grandfather ----
  const pickupRows = [
    {
      id: uuidV5("visitors", "pickup:aarav:grandfather"),
      institution_id: ctx.institutionId,
      student_id: aaravId,
      full_name: "Ramesh Sharma",
      relation: "grandparent",
      phone: "9800000090",
      created_by: guardianOneUserId,
    },
    {
      id: uuidV5("visitors", "pickup:aarav:driver"),
      institution_id: ctx.institutionId,
      student_id: aaravId,
      full_name: "Suresh Yadav",
      relation: "driver",
      phone: "9800000091",
      created_by: guardianOneUserId,
    },
    {
      id: uuidV5("visitors", "pickup:ananya:grandfather"),
      institution_id: ctx.institutionId,
      student_id: ananyaId,
      full_name: "Ramesh Sharma",
      relation: "grandparent",
      phone: "9800000090",
      created_by: guardianOneUserId,
    },
  ];
  await insertBatch(ctx.admin, "pickup_persons", pickupRows);

  // ---- gate_passes ----
  // VI-A roll 8 (academics.ts: roll_no = idx+1 after sorting the section's
  // named students alphabetically) — a generic student, never Aarav
  // (rank 7), so the class teacher sees a pending pass that isn't theirs.
  const viaRoll8 = [...ctx.studentsBySection["VI-A"]!].sort(byFirstName)[7];
  if (!viaRoll8) throw new Error("visitors: VI-A has fewer than 8 students");
  if (viaRoll8.firstName === "Aarav") {
    throw new Error("visitors: VI-A roll 8 resolved to Aarav — rulings require no open pass for Aarav");
  }

  const primaryGuardianRows = await ctx.sql`
    select guardian_id from public.guardian_students
    where institution_id = ${ctx.institutionId}::uuid
      and student_id = ${viaRoll8.id}::uuid
      and is_primary = true
    limit 1
  `;
  const viaRoll8GuardianId = primaryGuardianRows[0]?.guardian_id as string | undefined;
  if (!viaRoll8GuardianId) {
    throw new Error(`visitors: no primary guardian found for VI-A roll 8 student ${viaRoll8.id}`);
  }

  const gatePassRows = [
    {
      // Ananya: exited 2026-10-29, collector = Priya Sharma (guardian.one), decided by admin.
      id: uuidV5("visitors", "gatepass:ananya"),
      institution_id: ctx.institutionId,
      student_id: ananyaId,
      reason: "Dental check-up",
      guardian_id: guardianOneId,
      pickup_person_id: null,
      status: "exited",
      requested_by: adminUserId,
      requested_at: "2026-10-29T11:00:00+05:30",
      decided_by: adminUserId,
      decided_at: "2026-10-29T11:05:00+05:30",
      exited_at: "2026-10-29T11:30:00+05:30",
      exit_marked_by: adminUserId,
    },
    {
      // VI-A roll 8: pending, requested by front desk — teacher.vi-a (class
      // teacher of VI-A) sees it via gate_passes_select's class-teacher branch.
      id: uuidV5("visitors", "gatepass:via-roll8"),
      institution_id: ctx.institutionId,
      student_id: viaRoll8.id,
      reason: "Family function",
      guardian_id: viaRoll8GuardianId,
      pickup_person_id: null,
      status: "pending",
      requested_by: adminUserId,
      requested_at: "2026-10-30T09:15:00+05:30",
      decided_by: null,
      decided_at: null,
      exited_at: null,
      exit_marked_by: null,
    },
  ];
  // collector_name/collector_relation: left unset — app.gate_pass_before_insert
  // (BEFORE INSERT) fills both from guardian_id before the NOT NULL check runs.
  await insertBatch(ctx.admin, "gate_passes", gatePassRows);
}
