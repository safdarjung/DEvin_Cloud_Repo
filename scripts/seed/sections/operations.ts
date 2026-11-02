import { insertBatch } from "../lib/batch.ts";
import type { SeedContext } from "../lib/context.ts";
import { GRADES, sectionKey, sectionNames } from "../lib/grades.ts";
import { uuidV5 } from "../lib/ids.ts";

// M13-T11 (M13-tasks.md Task 11) — facilities (assets, maintenance
// requests), transport (vehicles, routes, stops, assignments) and the
// 2026-27 academic calendar (holidays/exam weeks/PTM/events). Registered
// right after `timetable` (before `attendance`) so `public.rooms` already
// exists for assets.room_id, while the calendar dates below are hardcoded
// to match attendance.ts's HOLIDAYS and exams.ts's held_on window rather
// than read from those sections, which haven't run yet at this point.

// Mirrors attendance.ts's HOLIDAYS exactly (2026-10-20..22 combined into
// one event) — duplicated, not imported: attendance.ts doesn't export it,
// and this packet may only touch its own files.
const HOLIDAYS: { title: string; startsOn: string; endsOn: string }[] = [
  { title: "Independence Day", startsOn: "2026-08-15", endsOn: "2026-08-15" },
  { title: "Gandhi Jayanti", startsOn: "2026-10-02", endsOn: "2026-10-02" },
  { title: "Dussehra / Diwali Break", startsOn: "2026-10-20", endsOn: "2026-10-22" },
  { title: "Christmas", startsOn: "2026-12-25", endsOn: "2026-12-25" },
  { title: "Republic Day", startsOn: "2027-01-26", endsOn: "2027-01-26" },
];

// exams.ts's heldOnFor() window for both HY-2026 and PT2-X papers (start
// 2026-09-14, 12-day cycle) — an exact bound on every seeded paper date.
const EXAM_WEEK_START = "2026-09-14";
const EXAM_WEEK_END = "2026-09-25";

const VEHICLES = [
  { reg: "DL1PA1234", driver: "Ramesh Kumar" },
  { reg: "DL1PA1235", driver: "Suresh Yadav" },
  { reg: "DL1PA1236", driver: "Mahesh Singh" },
  { reg: "DL1PA1237", driver: "Dinesh Rao" },
];
const VEHICLE_CAPACITY = 40;
const ROUTE_COUNT = 4;
const STOPS_PER_ROUTE = 6;
const PICKUP_TIMES = ["07:00", "07:10", "07:20", "07:30", "07:40", "07:50"];
const TARGET_PER_ROUTE = 30;

async function seedCalendar(ctx: SeedContext): Promise<void> {
  const createdBy = ctx.userIdByLogin["principal"]!;
  const rows: Record<string, unknown>[] = [];

  for (const h of HOLIDAYS) {
    rows.push({
      id: uuidV5("operations", `calendar:holiday:${h.startsOn}`),
      institution_id: ctx.institutionId,
      academic_year_id: ctx.academicYearId,
      kind: "holiday",
      title: h.title,
      starts_on: h.startsOn,
      ends_on: h.endsOn,
      audience: "all",
      created_by: createdBy,
    });
  }

  rows.push(
    {
      id: uuidV5("operations", "calendar:exam-week:hy-2026"),
      institution_id: ctx.institutionId,
      academic_year_id: ctx.academicYearId,
      kind: "exam_week",
      title: "Half-Yearly Examinations 2026",
      starts_on: EXAM_WEEK_START,
      ends_on: EXAM_WEEK_END,
      audience: "all",
      created_by: createdBy,
    },
    {
      id: uuidV5("operations", "calendar:exam-week:pt2-x"),
      institution_id: ctx.institutionId,
      academic_year_id: ctx.academicYearId,
      kind: "exam_week",
      title: "Periodic Test 2 (Grade X)",
      starts_on: EXAM_WEEK_START,
      ends_on: EXAM_WEEK_END,
      audience: "all",
      created_by: createdBy,
    },
    {
      id: uuidV5("operations", "calendar:ptm:2026-11-21"),
      institution_id: ctx.institutionId,
      academic_year_id: ctx.academicYearId,
      kind: "ptm",
      title: "Parent-Teacher Meeting",
      starts_on: "2026-11-21",
      ends_on: "2026-11-21",
      audience: "all",
      created_by: createdBy,
    },
    {
      // Matches website.ts's EVENTS "Annual Day Celebration" date.
      id: uuidV5("operations", "calendar:event:annual-day"),
      institution_id: ctx.institutionId,
      academic_year_id: ctx.academicYearId,
      kind: "event",
      title: "Annual Day Celebration",
      starts_on: "2026-12-12",
      ends_on: "2026-12-12",
      audience: "all",
      created_by: createdBy,
    },
    {
      id: uuidV5("operations", "calendar:event:staff-training"),
      institution_id: ctx.institutionId,
      academic_year_id: ctx.academicYearId,
      kind: "event",
      title: "Staff Training Day",
      starts_on: "2026-05-15",
      ends_on: "2026-05-15",
      audience: "staff",
      created_by: createdBy,
    },
  );

  await insertBatch(ctx.admin, "academic_calendar_events", rows);
}

async function seedAssets(ctx: SeedContext): Promise<{ id: string }[]> {
  const { data: rooms, error } = await ctx.admin
    .from("rooms")
    .select("id, name")
    .eq("institution_id", ctx.institutionId)
    .order("name");
  if (error) throw new Error(`operations: rooms query failed: ${error.message}`);

  const hallRoom = (rooms ?? []).find((r) => r.name === "Hall");
  const classrooms = (rooms ?? []).filter((r) => r.name !== "Hall").slice(0, 15);

  const assetRows: Record<string, unknown>[] = classrooms.map((room, i) => ({
    id: uuidV5("operations", `asset:projector:${i}`),
    institution_id: ctx.institutionId,
    name: `Projector (${room.name})`,
    category: "it",
    asset_tag: `AST-${String(i + 1).padStart(4, "0")}`,
    room_id: room.id,
    status: "in_use",
  }));

  const extras: { key: string; name: string; category: string; roomId?: string; location?: string }[] = [
    { key: "lab-kit", name: "Science Lab Kit", category: "lab", location: "Science Lab" },
    { key: "hall-sound", name: "Hall Sound System", category: "electrical", roomId: hallRoom?.id, location: hallRoom ? undefined : "Hall" },
    { key: "generator", name: "Backup Generator", category: "electrical", location: "Main Campus" },
    { key: "library-ac", name: "Library AC Unit", category: "electrical", location: "Library" },
    { key: "sports-kit", name: "Sports Equipment Set", category: "sports", location: "Sports Room" },
  ];
  const extraRows: Record<string, unknown>[] = extras.map((e, i) => ({
    id: uuidV5("operations", `asset:${e.key}`),
    institution_id: ctx.institutionId,
    name: e.name,
    category: e.category,
    asset_tag: `AST-${String(classrooms.length + i + 1).padStart(4, "0")}`,
    room_id: e.roomId ?? null,
    location: e.location ?? null,
    status: "in_use",
  }));

  const rows = [...assetRows, ...extraRows];
  await insertBatch(ctx.admin, "assets", rows);
  return rows.map((r) => ({ id: r.id as string }));
}

async function seedMaintenanceRequests(ctx: SeedContext, assets: { id: string }[]): Promise<void> {
  const officeStaffId = ctx.linkIdByLogin["admin"]!;
  const adminProfileId = ctx.userIdByLogin["admin"]!;
  // assets order: 15 projectors, then lab-kit, hall-sound, generator,
  // library-ac, sports-kit (seedAssets's push order).
  const [projector0] = assets;
  const labKit = assets[assets.length - 5]!;
  const hallSound = assets[assets.length - 4]!;
  const generator = assets[assets.length - 3]!;
  const libraryAc = assets[assets.length - 2]!;

  const rows: Record<string, unknown>[] = [
    {
      id: uuidV5("operations", "maintenance:1"),
      institution_id: ctx.institutionId,
      asset_id: projector0!.id,
      issue: "Projector not powering on.",
      priority: "medium",
      status: "open",
      raised_by: ctx.userIdByLogin["principal"]!,
      raised_at: "2026-10-05T09:00:00+05:30",
    },
    {
      id: uuidV5("operations", "maintenance:2"),
      institution_id: ctx.institutionId,
      location: "Staff washroom - ground floor",
      issue: "Leaking tap in staff washroom.",
      priority: "low",
      status: "open",
      raised_by: ctx.userIdByLogin["admissions"]!,
      raised_at: "2026-10-06T09:00:00+05:30",
    },
    {
      id: uuidV5("operations", "maintenance:3"),
      institution_id: ctx.institutionId,
      location: "Block A corridor",
      issue: "Short circuit tripping the MCB repeatedly.",
      priority: "high",
      status: "open",
      raised_by: ctx.userIdByLogin["accountant"]!,
      raised_at: "2026-10-07T09:00:00+05:30",
    },
    {
      id: uuidV5("operations", "maintenance:4"),
      institution_id: ctx.institutionId,
      asset_id: labKit.id,
      issue: "Microscope slides missing from the lab kit.",
      priority: "medium",
      status: "in_progress",
      raised_by: ctx.userIdByLogin["examcontroller"]!,
      raised_at: "2026-10-08T09:00:00+05:30",
      assignee_staff_id: officeStaffId,
      assigned_at: "2026-10-09T09:00:00+05:30",
    },
    {
      id: uuidV5("operations", "maintenance:5"),
      institution_id: ctx.institutionId,
      asset_id: hallSound.id,
      issue: "Sound system crackling during assembly.",
      priority: "high",
      status: "in_progress",
      raised_by: ctx.userIdByLogin["teacher.vi-a"]!,
      raised_at: "2026-10-10T09:00:00+05:30",
      assignee_staff_id: officeStaffId,
      assigned_at: "2026-10-11T09:00:00+05:30",
    },
    {
      id: uuidV5("operations", "maintenance:6"),
      institution_id: ctx.institutionId,
      asset_id: generator.id,
      issue: "Generator not starting during a power cut.",
      priority: "high",
      status: "in_progress",
      raised_by: ctx.userIdByLogin["teacher.viii-b"]!,
      raised_at: "2026-10-12T09:00:00+05:30",
      assignee_staff_id: officeStaffId,
      assigned_at: "2026-10-13T09:00:00+05:30",
    },
    {
      id: uuidV5("operations", "maintenance:7"),
      institution_id: ctx.institutionId,
      asset_id: libraryAc.id,
      issue: "Library AC unit not cooling.",
      priority: "medium",
      status: "done",
      raised_by: ctx.userIdByLogin["teacher.x-a"]!,
      raised_at: "2026-09-20T09:00:00+05:30",
      assignee_staff_id: officeStaffId,
      assigned_at: "2026-09-21T09:00:00+05:30",
      closed_at: "2026-09-23T09:00:00+05:30",
      closed_by: adminProfileId,
      resolution_note: "AC gas refilled and unit serviced.",
    },
    {
      id: uuidV5("operations", "maintenance:8"),
      institution_id: ctx.institutionId,
      location: "Room II-B",
      issue: "Broken window pane.",
      priority: "low",
      status: "done",
      raised_by: adminProfileId,
      raised_at: "2026-09-18T09:00:00+05:30",
      assignee_staff_id: officeStaffId,
      assigned_at: "2026-09-19T09:00:00+05:30",
      closed_at: "2026-09-20T09:00:00+05:30",
      closed_by: ctx.userIdByLogin["principal"]!,
      resolution_note: "Pane replaced by the maintenance vendor.",
    },
  ];

  await insertBatch(ctx.admin, "maintenance_requests", rows);
}

async function seedTransport(ctx: SeedContext): Promise<void> {
  const assignedBy = ctx.userIdByLogin["admin"]!;

  const vehicleRows: Record<string, unknown>[] = VEHICLES.map((v, i) => ({
    id: uuidV5("operations", `vehicle:${i}`),
    institution_id: ctx.institutionId,
    registration_no: v.reg,
    capacity: VEHICLE_CAPACITY,
    driver_name: v.driver,
    status: "active",
  }));
  await insertBatch(ctx.admin, "transport_vehicles", vehicleRows);

  const routeRows: Record<string, unknown>[] = Array.from({ length: ROUTE_COUNT }, (_, i) => ({
    id: uuidV5("operations", `route:${i}`),
    institution_id: ctx.institutionId,
    name: `Route ${i + 1}`,
    vehicle_id: vehicleRows[i]!.id,
    status: "on_time",
  }));
  await insertBatch(ctx.admin, "transport_routes", routeRows);

  const stopIdByRouteSeq = new Map<string, string>(); // `${routeIndex}:${seq}` -> stop id
  const stopRows: Record<string, unknown>[] = [];
  for (let r = 0; r < ROUTE_COUNT; r++) {
    for (let seq = 1; seq <= STOPS_PER_ROUTE; seq++) {
      const stopId = uuidV5("operations", `stop:${r}:${seq}`);
      stopIdByRouteSeq.set(`${r}:${seq}`, stopId);
      stopRows.push({
        id: stopId,
        institution_id: ctx.institutionId,
        route_id: routeRows[r]!.id,
        seq,
        name: `Route ${r + 1} Stop ${seq}`,
        pickup_time: PICKUP_TIMES[seq - 1],
        map_x: (seq * 15) % 101,
        map_y: (r * 20 + seq * 5) % 101,
      });
    }
  }
  await insertBatch(ctx.admin, "transport_stops", stopRows);

  // ---- assignments: ~30 students/route, round-robin over 6 stops; Aarav
  // (VI-A) and Ananya (X-A) forced onto Route 1 Stop 3 (05 §8.1 fixture).
  const sectionKeys = GRADES.flatMap((grade) => sectionNames(grade.code).map((name) => sectionKey(grade.code, name)));
  const allStudents: { id: string; firstName: string; sectionKey: string }[] = [];
  for (const key of sectionKeys) {
    for (const s of ctx.studentsBySection[key] ?? []) allStudents.push({ ...s, sectionKey: key });
  }

  const aarav = allStudents.find((s) => s.sectionKey === "VI-A" && s.firstName === "Aarav");
  const ananya = allStudents.find((s) => s.sectionKey === "X-A" && s.firstName === "Ananya");
  if (!aarav || !ananya) throw new Error("operations: Aarav (VI-A) / Ananya (X-A) not found in ctx.studentsBySection");

  const pool = allStudents.filter((s) => s.id !== aarav.id && s.id !== ananya.id);
  const routeChunkSizes = [TARGET_PER_ROUTE - 2, TARGET_PER_ROUTE, TARGET_PER_ROUTE, TARGET_PER_ROUTE];
  const assignmentRows: Record<string, unknown>[] = [];
  let cursor = 0;

  for (let r = 0; r < ROUTE_COUNT; r++) {
    const chunk = pool.slice(cursor, cursor + routeChunkSizes[r]!);
    cursor += routeChunkSizes[r]!;
    chunk.forEach((student, i) => {
      const seq = (i % STOPS_PER_ROUTE) + 1;
      assignmentRows.push({
        id: uuidV5("operations", `assignment:${student.id}`),
        institution_id: ctx.institutionId,
        student_id: student.id,
        route_id: routeRows[r]!.id,
        stop_id: stopIdByRouteSeq.get(`${r}:${seq}`)!,
        assigned_by: assignedBy,
      });
    });
  }

  // Route 1 (index 0) Stop 3 — the fixed fixture pair.
  for (const student of [aarav, ananya]) {
    assignmentRows.push({
      id: uuidV5("operations", `assignment:${student.id}`),
      institution_id: ctx.institutionId,
      student_id: student.id,
      route_id: routeRows[0]!.id,
      stop_id: stopIdByRouteSeq.get("0:3")!,
      assigned_by: assignedBy,
    });
  }

  await insertBatch(ctx.admin, "transport_assignments", assignmentRows);
}

export async function run(ctx: SeedContext): Promise<void> {
  await seedCalendar(ctx);
  const assets = await seedAssets(ctx);
  await seedMaintenanceRequests(ctx, assets);
  await seedTransport(ctx);
}
