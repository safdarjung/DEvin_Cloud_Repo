// M13-T2 — migration 0075 RLS + guards: assets, maintenance_requests,
// transport_vehicles/routes/stops/assignments, academic_calendar_events,
// and the holiday block on attendance_sessions. Real signed-in clients +
// real RLS, same pattern as timetable-rls.test.ts / announcements-rls.test.ts.
// Lane B: no MOD module column; the holiday block uses the inline
// `institutions.settings.modules.calendar` predicate (M13-tasks.md ruling).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createEnrolment,
  createGrade,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });
const PASSWORD = "correct-horse-battery-staple";

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

function adminClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
}

function randomPhone(): string {
  const first = String(6 + Math.floor(Math.random() * 4));
  const rest = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join("");
  return first + rest;
}

/** A second guardian + their own child in an already-created institution (not the fixture guardian/student). */
async function addGuardianWithChild(inst: TestInstitution, label: string): Promise<{ client: SupabaseClient; studentId: string }> {
  const admin = adminClient();
  const email = `second-${label}-${crypto.randomUUID()}@test.coolskool.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw error ?? new Error(`failed to create ${label}`);

  const [guardian] = await sql`
    insert into public.guardians (institution_id, full_name, phone)
    values (${inst.institutionId}, ${label}, ${randomPhone()})
    returning id
  `;
  await sql`
    insert into public.memberships (institution_id, user_id, role, guardian_id)
    values (${inst.institutionId}, ${data.user.id}, 'guardian', ${guardian.id})
  `;
  const [student] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${inst.institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, ${label}, '2015-01-01', 'other')
    returning id
  `;
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${inst.institutionId}, ${guardian.id}, ${student.id}, 'father', true, true)
  `;

  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError) throw signInError;
  return { client, studentId: student.id as string };
}

/** A second staff member (any staff role) in an already-created institution. */
async function addStaffMember(inst: TestInstitution, role: string, label: string): Promise<{ client: SupabaseClient; staffId: string; userId: string }> {
  const admin = adminClient();
  const email = `second-${label}-${crypto.randomUUID()}@test.coolskool.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw error ?? new Error(`failed to create ${label}`);

  const [staff] = await sql`
    insert into public.staff (institution_id, employee_no, full_name, designation)
    values (${inst.institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, ${label}, ${role})
    returning id
  `;
  await sql`
    insert into public.memberships (institution_id, user_id, role, staff_id)
    values (${inst.institutionId}, ${data.user.id}, ${role}, ${staff.id})
  `;

  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError) throw signInError;
  return { client, staffId: staff.id as string, userId: data.user.id as string };
}

async function createVehicle(institutionId: string, overrides: Partial<{ registrationNo: string; capacity: number; driverName: string }> = {}): Promise<string> {
  const [row] = await sql`
    insert into public.transport_vehicles (institution_id, registration_no, capacity, driver_name)
    values (${institutionId}, ${overrides.registrationNo ?? `MH-${crypto.randomUUID().slice(0, 6)}`}, ${overrides.capacity ?? 40}, ${overrides.driverName ?? "Driver"})
    returning id
  `;
  return row.id as string;
}

async function createRoute(institutionId: string, overrides: Partial<{ name: string; vehicleId: string | null }> = {}): Promise<string> {
  const [row] = await sql`
    insert into public.transport_routes (institution_id, name, vehicle_id)
    values (${institutionId}, ${overrides.name ?? `Route-${crypto.randomUUID().slice(0, 6)}`}, ${overrides.vehicleId ?? null})
    returning id
  `;
  return row.id as string;
}

async function createStop(institutionId: string, routeId: string, overrides: Partial<{ seq: number; name: string }> = {}): Promise<string> {
  const seq = overrides.seq ?? 1;
  const [row] = await sql`
    insert into public.transport_stops (institution_id, route_id, seq, name, pickup_time, map_x, map_y)
    values (${institutionId}, ${routeId}, ${seq}, ${overrides.name ?? `Stop ${seq}`}, '07:00', 10, 10)
    returning id
  `;
  return row.id as string;
}

async function createAssignment(institutionId: string, studentId: string, routeId: string, stopId: string, assignedBy: string) {
  return sql`
    insert into public.transport_assignments (institution_id, student_id, route_id, stop_id, assigned_by)
    values (${institutionId}, ${studentId}, ${routeId}, ${stopId}, ${assignedBy})
  `;
}

async function createAsset(institutionId: string, overrides: Partial<{ name: string; category: string; assetTag: string | null }> = {}): Promise<string> {
  const [row] = await sql`
    insert into public.assets (institution_id, name, category, asset_tag)
    values (${institutionId}, ${overrides.name ?? "Projector"}, ${overrides.category ?? "electrical"}, ${overrides.assetTag ?? null})
    returning id
  `;
  return row.id as string;
}

async function createCalendarEvent(
  institutionId: string,
  academicYearId: string,
  createdBy: string,
  overrides: Partial<{ kind: string; title: string; startsOn: string; endsOn: string; audience: string }> = {},
) {
  return sql`
    insert into public.academic_calendar_events (institution_id, academic_year_id, kind, title, starts_on, ends_on, audience, created_by)
    values (
      ${institutionId}, ${academicYearId}, ${overrides.kind ?? "holiday"}, ${overrides.title ?? "Event"},
      ${overrides.startsOn ?? "2026-10-20"}, ${overrides.endsOn ?? "2026-10-20"}, ${overrides.audience ?? "all"}, ${createdBy}
    )
    returning id
  `;
}

describe("operations migration (0075) RLS + guards", () => {
  it("guardian/student see only their own route, own stop (not a sibling's stop), its vehicle, and only their own assignment", async () => {
    const inst = await createTestInstitution("ops-transport-scope");
    try {
      const vehicleId = await createVehicle(inst.institutionId, { capacity: 10 });
      const routeId = await createRoute(inst.institutionId, { vehicleId });
      const stopA = await createStop(inst.institutionId, routeId, { seq: 1, name: "Stop A" });
      const stopB = await createStop(inst.institutionId, routeId, { seq: 2, name: "Stop B" });

      const [guardianMembership] = await sql`
        select guardian_id from public.memberships where institution_id = ${inst.institutionId} and user_id = ${inst.users.guardian.id}
      `;
      const [studentMembership] = await sql`
        select student_id from public.memberships where institution_id = ${inst.institutionId} and user_id = ${inst.users.student.id}
      `;
      const studentAId = studentMembership.student_id as string;
      await sql`
        insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
        values (${inst.institutionId}, ${guardianMembership.guardian_id}, ${studentAId}, 'father', true, true)
      `;
      await createAssignment(inst.institutionId, studentAId, routeId, stopA, inst.users.admin.id);

      const familyB = await addGuardianWithChild(inst, "family-b");
      await createAssignment(inst.institutionId, familyB.studentId, routeId, stopB, inst.users.admin.id);

      for (const client of [inst.clientAs("guardian"), inst.clientAs("student")]) {
        const stops = await client.from("transport_stops").select("id").eq("route_id", routeId);
        expect(stops.error).toBeNull();
        expect((stops.data ?? []).map((r) => r.id)).toEqual([stopA]);

        const routes = await client.from("transport_routes").select("id").eq("id", routeId);
        expect((routes.data ?? []).map((r) => r.id)).toEqual([routeId]);

        const vehicles = await client.from("transport_vehicles").select("id").eq("id", vehicleId);
        expect((vehicles.data ?? []).map((r) => r.id)).toEqual([vehicleId]);

        const assignments = await client.from("transport_assignments").select("student_id");
        expect((assignments.data ?? []).map((r) => r.student_id)).toEqual([studentAId]);
      }

      const bStops = await familyB.client.from("transport_stops").select("id").eq("route_id", routeId);
      expect((bStops.data ?? []).map((r) => r.id)).toEqual([stopB]);
      const bAssignments = await familyB.client.from("transport_assignments").select("student_id");
      expect((bAssignments.data ?? []).map((r) => r.student_id)).toEqual([familyB.studentId]);
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher sees assignments of taught students only; accountant sees all", async () => {
    const inst = await createTestInstitution("ops-transport-teacher-scope");
    try {
      const [teacherStaff] = await sql`
        select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'
      `;
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const taughtSection = await createClassSection(inst.institutionId, gradeId, yearId, { name: "Taught", classTeacherId: teacherStaff.staff_id });
      const otherSection = await createClassSection(inst.institutionId, gradeId, yearId, { name: "Other" });

      const [studentMembership] = await sql`
        select student_id from public.memberships where institution_id = ${inst.institutionId} and user_id = ${inst.users.student.id}
      `;
      const taughtStudentId = studentMembership.student_id as string;
      await createEnrolment(inst.institutionId, taughtStudentId, taughtSection, yearId);

      const [untaughtStudent] = await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        values (${inst.institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'Untaught', '2015-01-01', 'other')
        returning id
      `;
      const untaughtStudentId = untaughtStudent.id as string;
      await createEnrolment(inst.institutionId, untaughtStudentId, otherSection, yearId);

      const vehicleId = await createVehicle(inst.institutionId, { capacity: 10 });
      const routeId = await createRoute(inst.institutionId, { vehicleId });
      const stop1 = await createStop(inst.institutionId, routeId, { seq: 1 });
      const stop2 = await createStop(inst.institutionId, routeId, { seq: 2 });
      await createAssignment(inst.institutionId, taughtStudentId, routeId, stop1, inst.users.admin.id);
      await createAssignment(inst.institutionId, untaughtStudentId, routeId, stop2, inst.users.admin.id);

      const teacherView = await inst.clientAs("teacher").from("transport_assignments").select("student_id");
      expect((teacherView.data ?? []).map((r) => r.student_id)).toEqual([taughtStudentId]);

      const accountantView = await inst.clientAs("accountant").from("transport_assignments").select("student_id");
      expect((accountantView.data ?? []).map((r) => r.student_id).sort()).toEqual([taughtStudentId, untaughtStudentId].sort());
    } finally {
      await inst.cleanup();
    }
  });

  it("a third assignment beyond vehicle capacity is rejected; a second row for the same student is rejected (23505)", async () => {
    const inst = await createTestInstitution("ops-transport-capacity");
    try {
      const vehicleId = await createVehicle(inst.institutionId, { capacity: 1 });
      const routeId = await createRoute(inst.institutionId, { vehicleId });
      const stop1 = await createStop(inst.institutionId, routeId, { seq: 1 });
      const stop2 = await createStop(inst.institutionId, routeId, { seq: 2 });

      const [studentA] = await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        values (${inst.institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'A', '2015-01-01', 'other') returning id
      `;
      const [studentB] = await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        values (${inst.institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'B', '2015-01-01', 'other') returning id
      `;

      await createAssignment(inst.institutionId, studentA.id, routeId, stop1, inst.users.admin.id);
      await expect(createAssignment(inst.institutionId, studentB.id, routeId, stop2, inst.users.admin.id)).rejects.toThrow(/conflict/);

      // Re-assigning the SAME student on a different, uncrowded route is a
      // duplicate student_id, not a capacity hit — isolates the named
      // unique constraint (23505) from app.guard_transport_capacity.
      const vehicleId2 = await createVehicle(inst.institutionId, { capacity: 10 });
      const routeId2 = await createRoute(inst.institutionId, { vehicleId: vehicleId2 });
      const stop3 = await createStop(inst.institutionId, routeId2, { seq: 1 });
      await expect(createAssignment(inst.institutionId, studentA.id, routeId2, stop3, inst.users.admin.id)).rejects.toMatchObject({
        code: "23505",
      });
    } finally {
      await inst.cleanup();
    }
  });

  it("a staff role raises a maintenance request forced open; another staff member cannot read or update it; admin's open->in_progress->done works and done is terminal", async () => {
    const inst = await createTestInstitution("ops-maintenance");
    try {
      const assetId = await createAsset(inst.institutionId);
      const teacherB = await addStaffMember(inst, "teacher", "teacher-b");

      const raised = await inst
        .clientAs("teacher")
        .from("maintenance_requests")
        .insert({ institution_id: inst.institutionId, asset_id: assetId, issue: "Leaking tap" })
        .select("id, status, raised_by")
        .single();
      expect(raised.error).toBeNull();
      expect(raised.data?.status).toBe("open");
      const requestId = raised.data?.id as string;

      const bRead = await teacherB.client.from("maintenance_requests").select("id").eq("id", requestId);
      expect((bRead.data ?? [])).toEqual([]);

      const bUpdate = await teacherB.client.from("maintenance_requests").update({ priority: "high" }).eq("id", requestId).select("id");
      expect((bUpdate.data ?? [])).toEqual([]);

      const [officeStaff] = await sql`
        select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'admin'
      `;
      const toInProgress = await inst
        .clientAs("admin")
        .from("maintenance_requests")
        .update({ status: "in_progress", assignee_staff_id: officeStaff.staff_id })
        .eq("id", requestId)
        .select("status")
        .single();
      expect(toInProgress.error).toBeNull();
      expect(toInProgress.data?.status).toBe("in_progress");

      const toDone = await inst
        .clientAs("admin")
        .from("maintenance_requests")
        .update({ status: "done", resolution_note: "Fixed" })
        .eq("id", requestId)
        .select("status, closed_at, closed_by")
        .single();
      expect(toDone.error).toBeNull();
      expect(toDone.data?.status).toBe("done");
      expect(toDone.data?.closed_at).not.toBeNull();

      await expect(
        sql`update public.maintenance_requests set resolution_note = 'again' where id = ${requestId}`,
      ).rejects.toThrow(/invalid_state/);

      // in_progress -> open is rejected on a fresh request.
      const second = await inst
        .clientAs("teacher")
        .from("maintenance_requests")
        .insert({ institution_id: inst.institutionId, asset_id: assetId, issue: "Broken chair" })
        .select("id")
        .single();
      await sql`update public.maintenance_requests set status = 'in_progress', assignee_staff_id = ${officeStaff.staff_id} where id = ${second.data?.id}`;
      await expect(sql`update public.maintenance_requests set status = 'open' where id = ${second.data?.id}`).rejects.toThrow(/invalid_state/);
    } finally {
      await inst.cleanup();
    }
  });

  it("a holiday blocks attendance_sessions insert; exam_week does not; disabling the calendar module un-blocks it", async () => {
    const inst = await createTestInstitution("ops-holiday-block");
    try {
      const yearId = await createAcademicYear(inst.institutionId, { startsOn: "2026-04-01", endsOn: "2027-03-31" });
      const gradeId = await createGrade(inst.institutionId);
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId);

      await createCalendarEvent(inst.institutionId, yearId, inst.users.admin.id, { kind: "holiday", startsOn: "2026-10-20", endsOn: "2026-10-22" });
      await createCalendarEvent(inst.institutionId, yearId, inst.users.admin.id, { kind: "exam_week", startsOn: "2026-11-01", endsOn: "2026-11-05" });

      await expect(
        sql`insert into public.attendance_sessions (institution_id, class_section_id, date) values (${inst.institutionId}, ${sectionId}, '2026-10-21')`,
      ).rejects.toThrow(/invalid_state/);

      const examWeekSession = await sql`
        insert into public.attendance_sessions (institution_id, class_section_id, date)
        values (${inst.institutionId}, ${sectionId}, '2026-11-02')
        returning id
      `;
      expect(examWeekSession).toHaveLength(1);

      // jsonb_set's create_missing only creates the final path element, not
      // intermediate containers — settings starts as '{}' with no "modules"
      // key, so build the nested object explicitly instead.
      await sql`update public.institutions set settings = settings || jsonb_build_object('modules', jsonb_build_object('calendar', false)) where id = ${inst.institutionId}`;

      const afterDisable = await sql`
        insert into public.attendance_sessions (institution_id, class_section_id, date)
        values (${inst.institutionId}, ${sectionId}, '2026-10-22')
        returning id
      `;
      expect(afterDisable).toHaveLength(1);
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian cannot read a staff-only calendar event; a holiday forced to audience staff is rejected (23514); an event outside its academic year is rejected", async () => {
    const inst = await createTestInstitution("ops-calendar-rules");
    try {
      const yearId = await createAcademicYear(inst.institutionId, { startsOn: "2026-04-01", endsOn: "2027-03-31" });

      await createCalendarEvent(inst.institutionId, yearId, inst.users.admin.id, {
        kind: "ptm",
        title: "Staff training",
        startsOn: "2026-11-21",
        endsOn: "2026-11-21",
        audience: "staff",
      });
      const [allEvent] = await createCalendarEvent(inst.institutionId, yearId, inst.users.admin.id, {
        kind: "ptm",
        title: "Parent meeting",
        startsOn: "2026-11-22",
        endsOn: "2026-11-22",
        audience: "all",
      });

      const guardianView = await inst.clientAs("guardian").from("academic_calendar_events").select("id");
      expect((guardianView.data ?? []).map((r) => r.id)).toEqual([allEvent.id]);

      await expect(
        sql`insert into public.academic_calendar_events (institution_id, academic_year_id, kind, title, starts_on, ends_on, audience, created_by)
            values (${inst.institutionId}, ${yearId}, 'holiday', 'Bad holiday', '2026-12-25', '2026-12-25', 'staff', ${inst.users.admin.id})`,
      ).rejects.toMatchObject({ code: "23514" });

      await expect(
        createCalendarEvent(inst.institutionId, yearId, inst.users.admin.id, { kind: "event", startsOn: "2025-01-01", endsOn: "2025-01-01" }),
      ).rejects.toThrow(/validation_failed/);
    } finally {
      await inst.cleanup();
    }
  });

  it("admin of institution A cannot reference institution B's room, asset, vehicle, route, stop, student or academic year", async () => {
    await withTwoInstitutions(async (instA, instB) => {
      const [roomB] = await sql`insert into public.rooms (institution_id, name, capacity) values (${instB.institutionId}, 'B Room', 30) returning id`;
      const vehicleB = await createVehicle(instB.institutionId);
      const routeB = await createRoute(instB.institutionId, { vehicleId: vehicleB });
      const stopB = await createStop(instB.institutionId, routeB, { seq: 1 });
      const yearB = await createAcademicYear(instB.institutionId);
      const [studentB] = await sql`
        select student_id from public.memberships where institution_id = ${instB.institutionId} and role = 'student'
      `;

      const admin = instA.clientAs("admin");

      const assetCrossRoom = await admin.from("assets").insert({ institution_id: instA.institutionId, name: "X", category: "other", room_id: roomB.id }).select("id");
      expect(assetCrossRoom.error).not.toBeNull();

      const vehicleId = await createVehicle(instA.institutionId);
      const routeCrossVehicle = await admin.from("transport_routes").insert({ institution_id: instA.institutionId, name: "X", vehicle_id: vehicleB }).select("id");
      expect(routeCrossVehicle.error).not.toBeNull();

      const routeA = await createRoute(instA.institutionId, { vehicleId });
      const stopCrossRoute = await admin.from("transport_stops").insert({ institution_id: instA.institutionId, route_id: routeB, seq: 1, name: "X", pickup_time: "07:00", map_x: 1, map_y: 1 }).select("id");
      expect(stopCrossRoute.error).not.toBeNull();

      const stopA = await createStop(instA.institutionId, routeA, { seq: 1 });
      const assignCrossStudent = await admin.from("transport_assignments").insert({ institution_id: instA.institutionId, student_id: studentB.student_id, route_id: routeA, stop_id: stopA, assigned_by: instA.users.admin.id }).select("id");
      expect(assignCrossStudent.error).not.toBeNull();

      const [ownStudentA] = await sql`
        select student_id from public.memberships where institution_id = ${instA.institutionId} and role = 'student'
      `;
      const assignCrossStop = await admin.from("transport_assignments").insert({ institution_id: instA.institutionId, student_id: ownStudentA.student_id, route_id: routeA, stop_id: stopB, assigned_by: instA.users.admin.id }).select("id");
      expect(assignCrossStop.error).not.toBeNull();

      const eventCrossYear = await admin
        .from("academic_calendar_events")
        .insert({ institution_id: instA.institutionId, academic_year_id: yearB, kind: "event", title: "X", starts_on: "2026-05-01", ends_on: "2026-05-01" })
        .select("id");
      expect(eventCrossYear.error).not.toBeNull();
    });
  });
});
