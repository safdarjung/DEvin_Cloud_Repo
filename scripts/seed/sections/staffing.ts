import { insertBatch } from "../lib/batch.ts";
import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";

// M08-T13 (M08-tasks.md Task 13) — staff_attendance / leave_requests /
// substitutions for the demo tenant. Dates are relative to the run date
// (not fixed, unlike attendance.ts's 2026-08-08..10-28 window), because the
// T11/T12 queries this seeds for ("today", "the next 14 days") read real
// wall-clock time. `d0` = today in Asia/Kolkata if Mon-Sat, else the next
// Monday — ids stay identical across same-day reseeds (uuidV5 keyed by the
// date string), which is all the determinism contract here requires.

function todayIST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

/** ISO weekday: Mon=1 ... Sun=7 (matches timetable_slots.weekday / extract(isodow ...)). */
function isodow(iso: string): number {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return dow === 0 ? 7 : dow;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function computeD0(): string {
  const today = todayIST();
  return isodow(today) <= 6 ? today : addDays(today, 1);
}

/** The `count` most recent school days (Mon-Sat) through and including `d0`. */
function lastSchoolDays(d0: string, count: number): string[] {
  const days: string[] = [];
  let cursor = d0;
  while (days.length < count) {
    if (isodow(cursor) !== 7) days.push(cursor);
    cursor = addDays(cursor, -1);
  }
  return days;
}

function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

interface LeaveRow {
  id: string;
  institution_id: string;
  staff_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  reason: string;
  status: string;
  created_by: string;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

export async function run(ctx: SeedContext): Promise<void> {
  const d0 = computeD0();
  const principalId = ctx.userIdByLogin["principal"]!;

  // 100 teaching staff, the 3 demo class teachers first (context.ts) —
  // teachers A-F below are just positions 0-5, picked for determinism, not
  // for any particular identity.
  const [teacherA, teacherB, teacherC, teacherD, teacherE, teacherF] = ctx.teacherStaffIds;
  if (!teacherA || !teacherB || !teacherC || !teacherD || !teacherE || !teacherF) {
    throw new Error("staffing: fewer than 6 teaching staff in ctx.teacherStaffIds");
  }

  // ---- leave_requests (service role bypasses guard_leave_requests, so
  // status/created_by/decided_by/decided_at/created_at are set explicitly) ----
  const leaveA: LeaveRow = {
    id: uuidV5("staffing", "leave:a"),
    institution_id: ctx.institutionId,
    staff_id: teacherA,
    leave_type: "sick",
    start_date: d0,
    end_date: addDays(d0, 1),
    reason: "Fever and seasonal flu; resting at home on medical advice.",
    status: "approved",
    created_by: principalId,
    decided_by: principalId,
    decided_at: `${addDays(d0, -1)}T09:00:00+05:30`,
    created_at: `${addDays(d0, -2)}T08:30:00+05:30`,
  };
  const leaveRows: LeaveRow[] = [
    leaveA,
    {
      id: uuidV5("staffing", "leave:b"),
      institution_id: ctx.institutionId,
      staff_id: teacherB,
      leave_type: "earned",
      start_date: addDays(d0, 7),
      end_date: addDays(d0, 9),
      reason: "Pre-planned family travel; earned leave.",
      status: "approved",
      created_by: principalId,
      decided_by: principalId,
      decided_at: `${addDays(d0, -1)}T09:30:00+05:30`,
      created_at: `${addDays(d0, -4)}T08:30:00+05:30`,
    },
    {
      id: uuidV5("staffing", "leave:c"),
      institution_id: ctx.institutionId,
      staff_id: teacherC,
      leave_type: "casual",
      start_date: addDays(d0, 3),
      end_date: addDays(d0, 3),
      reason: "Personal work; one day casual leave.",
      status: "pending",
      created_by: principalId,
      decided_by: null,
      decided_at: null,
      created_at: hoursAgoIso(5),
    },
    {
      id: uuidV5("staffing", "leave:d"),
      institution_id: ctx.institutionId,
      staff_id: teacherD,
      leave_type: "casual",
      start_date: addDays(d0, 4),
      end_date: addDays(d0, 5),
      reason: "Family function out of town.",
      status: "pending",
      created_by: principalId,
      decided_by: null,
      decided_at: null,
      created_at: hoursAgoIso(20),
    },
    {
      id: uuidV5("staffing", "leave:e"),
      institution_id: ctx.institutionId,
      staff_id: teacherE,
      leave_type: "casual",
      start_date: addDays(d0, 10),
      end_date: addDays(d0, 11),
      reason: "Personal errands.",
      status: "pending",
      created_by: principalId,
      decided_by: null,
      decided_at: null,
      created_at: hoursAgoIso(55),
    },
    {
      id: uuidV5("staffing", "leave:f"),
      institution_id: ctx.institutionId,
      staff_id: teacherF,
      leave_type: "other",
      start_date: addDays(d0, 2),
      end_date: addDays(d0, 2),
      reason: "Requested leave for a personal matter.",
      status: "rejected",
      created_by: principalId,
      decided_by: principalId,
      decided_at: `${addDays(d0, -1)}T11:00:00+05:30`,
      created_at: `${addDays(d0, -3)}T09:00:00+05:30`,
    },
  ];
  await insertBatch(ctx.admin, "leave_requests", leaveRows as unknown as Record<string, unknown>[]);

  // ---- staff_attendance: last 5 school days through d0, every active
  // staff, 92% present / 4% late / 4% absent — skip whoever is on
  // approved leave that day (only teacher A, on d0, falls in this window). ----
  const { data: activeStaff, error: staffError } = await ctx.admin
    .from("staff")
    .select("id")
    .eq("institution_id", ctx.institutionId)
    .eq("status", "active")
    .order("id");
  if (staffError) throw new Error(`staffing: staff query failed: ${staffError.message}`);

  const onApprovedLeave = (staffId: string, date: string): boolean =>
    leaveRows.some((l) => l.status === "approved" && l.staff_id === staffId && date >= l.start_date && date <= l.end_date);

  const attendanceRows: Record<string, unknown>[] = [];
  for (const date of lastSchoolDays(d0, 5)) {
    for (const staff of activeStaff ?? []) {
      if (onApprovedLeave(staff.id, date)) continue;
      const r = ctx.rng();
      const status = r < 0.92 ? "present" : r < 0.96 ? "late" : "absent";
      attendanceRows.push({
        id: uuidV5("staffing", `attendance:${staff.id}:${date}`),
        institution_id: ctx.institutionId,
        staff_id: staff.id,
        date,
        status,
        source: "admin",
        marked_by: principalId,
      });
    }
  }
  await insertBatch(ctx.admin, "staff_attendance", attendanceRows, 2000);

  // ---- substitutions: teacher A's first published slot on d0, covered by
  // the first free teacher (T3 rules: active teaching staff, not the
  // original teacher, not teaching that weekday/period in the published
  // version, not on approved leave that date). ----
  const { data: version, error: versionError } = await ctx.admin
    .from("timetable_versions")
    .select("id")
    .eq("institution_id", ctx.institutionId)
    .eq("status", "published")
    .single();
  if (versionError || !version) throw new Error(`staffing: no published timetable version found`);

  const weekday = isodow(d0);
  const { data: slotRows, error: slotError } = await ctx.admin
    .from("timetable_slots")
    .select("id, period_id, periods(seq)")
    .eq("institution_id", ctx.institutionId)
    .eq("version_id", version.id)
    .eq("teacher_id", teacherA)
    .eq("weekday", weekday);
  if (slotError) throw new Error(`staffing: slot query failed: ${slotError.message}`);
  const slot = [...(slotRows ?? [])].sort(
    (a, b) => (a.periods as { seq: number } | null)!.seq - (b.periods as { seq: number } | null)!.seq,
  )[0];
  if (!slot) throw new Error(`staffing: teacher A has no published slot on weekday ${weekday}`);

  const { data: busyRows, error: busyError } = await ctx.admin
    .from("timetable_slots")
    .select("teacher_id")
    .eq("version_id", version.id)
    .eq("weekday", weekday)
    .eq("period_id", slot.period_id);
  if (busyError) throw new Error(`staffing: busy-teacher query failed: ${busyError.message}`);
  const busyTeacherIds = new Set((busyRows ?? []).map((r) => r.teacher_id));

  const substitute = ctx.teacherStaffIds
    .slice(1)
    .find((id) => !busyTeacherIds.has(id) && !onApprovedLeave(id, d0));
  if (!substitute) throw new Error("staffing: no free teacher found to cover teacher A's slot");

  const { error: subError } = await ctx.admin.from("substitutions").insert({
    id: uuidV5("staffing", "substitution:a"),
    institution_id: ctx.institutionId,
    slot_id: slot.id,
    date: d0,
    period_id: slot.period_id,
    original_teacher_id: teacherA,
    substitute_teacher_id: substitute,
    leave_request_id: leaveA.id,
    status: "assigned",
    created_by: principalId,
  });
  if (subError) throw new Error(`staffing: substitution insert failed: ${subError.message}`);
}
