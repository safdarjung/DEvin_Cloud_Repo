// M13-T12 — operations acceptance over HTTP: admin via /api/v1/actions/*
// builds vehicle/route/stops, assigns two children to two different
// guardians' stops; guardian transport.forStudent/PostgREST scoping; a
// holiday blocks attendance.mark (409); guardian calendar.forRole sees the
// holiday, not a staff-only event; teacher raises a maintenance request,
// admin assigns/closes it, teacher sees it done.
//
// Lane B note (M13-tasks.md header): MOD is not merged in this worktree —
// the packet's "module disabled -> forbidden" sub-test is skipped here on
// the controller's explicit ruling (no module toggle exists yet).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { POST as actionsPost } from "@/app/api/v1/actions/[name]/route";
import { GET as queryGet } from "@/app/api/v1/query/[name]/route";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createEnrolment, createGrade } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const PASSWORD = "correct-horse-battery-staple";

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

function actionRequest(name: string, body: unknown, headers: Record<string, string>): Request {
  return new Request(`http://localhost/api/v1/actions/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function dispatchAction(name: string, body: unknown, headers: Record<string, string>): Promise<Response> {
  return actionsPost(actionRequest(name, body, headers), { params: Promise.resolve({ name }) });
}

function queryUrl(name: string, institution: string, input: unknown): URL {
  const url = new URL(`http://localhost/api/v1/query/${name}`);
  url.searchParams.set("institution", institution);
  url.searchParams.set("input", JSON.stringify(input));
  return url;
}

function dispatchQuery(name: string, institution: string, input: unknown, headers: Record<string, string>): Promise<Response> {
  return queryGet(new Request(queryUrl(name, institution, input), { headers }), { params: Promise.resolve({ name }) });
}

async function tokenForClient(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session) throw error ?? new Error("no session");
  return data.session.access_token;
}

async function tokenFor(inst: TestInstitution, role: "admin" | "teacher" | "guardian"): Promise<string> {
  return tokenForClient(inst.clientAs(role));
}

function adminClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
}

/** A second guardian + their own child in an already-created institution — mirrors operations-rls.test.ts. */
async function addGuardianWithChild(inst: TestInstitution, label: string): Promise<{ client: SupabaseClient; studentId: string }> {
  const admin = adminClient();
  const email = `second-${label}-${crypto.randomUUID()}@test.coolskool.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw error ?? new Error(`failed to create ${label}`);

  const [guardian] = await sql`
    insert into public.guardians (institution_id, full_name, phone)
    values (${inst.institutionId}, ${label}, '9876500000')
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

// 05 §4.1 default statuses, mirrors attendance-actions.test.ts.
const ATTENDANCE_STATUSES = [{ code: "P", label: "Present", counts_present: 1, in_denominator: true }];

async function setAttendanceSettings(institutionId: string): Promise<void> {
  await sql`
    update public.institutions
    set settings = settings || jsonb_build_object(
      'attendance', jsonb_build_object(
        'mode', 'daily',
        'correction_window_days', 3,
        'statuses', ${sql.json(ATTENDANCE_STATUSES)}::jsonb,
        'alert_thresholds', jsonb_build_object('warn', 80, 'critical', 75)
      )
    )
    where id = ${institutionId}
  `;
}

function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

describe("M13 operations acceptance: admin manages transport/calendar/maintenance over HTTP", () => {
  it(
    "transport assign + guardian scoping; holiday blocks attendance.mark; guardian sees holiday not staff event; " +
      "maintenance request -> assign -> close -> teacher sees done",
    async () => {
      const inst = await createTestInstitution("operations-acceptance");
      try {
        const yearId = await createAcademicYear(inst.institutionId);
        await setAttendanceSettings(inst.institutionId);

        // --- Child A = the fixture student/guardian, enrolled + linked ----
        const gradeId = await createGrade(inst.institutionId);
        const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { name: "Ops-A" });
        const [studentMembership] = await sql`
          select student_id from public.memberships where institution_id = ${inst.institutionId} and user_id = ${inst.users.student.id}
        `;
        const childAId = studentMembership.student_id as string;
        await createEnrolment(inst.institutionId, childAId, sectionId, yearId);
        const [guardianMembership] = await sql`
          select guardian_id from public.memberships where institution_id = ${inst.institutionId} and user_id = ${inst.users.guardian.id}
        `;
        await sql`
          insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
          values (${inst.institutionId}, ${guardianMembership.guardian_id}, ${childAId}, 'father', true, true)
        `;

        // --- Child B = a second family (guardian G2) --------------------
        const familyB = await addGuardianWithChild(inst, "family-b");
        const childBId = familyB.studentId;

        const adminAuth = { authorization: `Bearer ${await tokenFor(inst, "admin")}` };
        const guardian1Auth = { authorization: `Bearer ${await tokenFor(inst, "guardian")}` };
        const teacherAuth = { authorization: `Bearer ${await tokenFor(inst, "teacher")}` };

        // --- Admin builds vehicle/route/3 stops --------------------------
        const vehicleRes = await dispatchAction(
          "transport.vehicle.upsert",
          { institution: inst.slug, input: { registrationNo: `MH-${crypto.randomUUID().slice(0, 6)}`, capacity: 20, driverName: "Driver One" } },
          adminAuth,
        );
        expect(vehicleRes.status).toBe(200);
        const vehicleId = (await vehicleRes.json()).data.id as string;

        const routeRes = await dispatchAction(
          "transport.route.upsert",
          { institution: inst.slug, input: { name: `Route-${crypto.randomUUID().slice(0, 6)}`, vehicleId } },
          adminAuth,
        );
        expect(routeRes.status).toBe(200);
        const routeId = (await routeRes.json()).data.id as string;

        const stopIds: string[] = [];
        for (let seq = 1; seq <= 3; seq++) {
          const stopRes = await dispatchAction(
            "transport.stop.upsert",
            { institution: inst.slug, input: { routeId, seq, name: `Stop ${seq}`, eta: "07:30", mapX: 10, mapY: 10 } },
            adminAuth,
          );
          expect(stopRes.status).toBe(200);
          stopIds.push((await stopRes.json()).data.id as string);
        }
        const [, stop2Id, stop3Id] = stopIds;

        // --- Admin assigns child A -> stop 2, child B -> stop 3 ----------
        const assignARes = await dispatchAction(
          "transport.assign",
          { institution: inst.slug, input: { studentId: childAId, stopId: stop2Id } },
          adminAuth,
        );
        expect(assignARes.status).toBe(200);
        const assignBRes = await dispatchAction(
          "transport.assign",
          { institution: inst.slug, input: { studentId: childBId, stopId: stop3Id } },
          adminAuth,
        );
        expect(assignBRes.status).toBe(200);

        // --- G1 forStudent(A) -> stop 2; forStudent(B) -> null -----------
        const forARes = await dispatchQuery("transport.forStudent", inst.slug, { studentId: childAId }, guardian1Auth);
        expect(forARes.status).toBe(200);
        const forABody = await forARes.json();
        expect(forABody.ok).toBe(true);
        expect(forABody.data.stop.name).toBe("Stop 2");

        const forBRes = await dispatchQuery("transport.forStudent", inst.slug, { studentId: childBId }, guardian1Auth);
        expect(forBRes.status).toBe(200);
        const forBBody = await forBRes.json();
        expect(forBBody.ok).toBe(true);
        expect(forBBody.data).toBeNull();

        // --- G1 PostgREST transport_stops -> only stop 2 ------------------
        const g1Stops = await inst.clientAs("guardian").from("transport_stops").select("id").eq("route_id", routeId);
        expect(g1Stops.error).toBeNull();
        expect((g1Stops.data ?? []).map((r) => r.id)).toEqual([stop2Id]);

        // sanity: guardian 2's own query sees their own stop, not stop 2
        const g2Stops = await familyB.client.from("transport_stops").select("id").eq("route_id", routeId);
        expect((g2Stops.data ?? []).map((r) => r.id)).toEqual([stop3Id]);

        // --- Admin declares a holiday today; a staff-only event too ------
        const today = todayIso();
        const holidayRes = await dispatchAction(
          "calendar.event.upsert",
          { institution: inst.slug, input: { academicYearId: yearId, kind: "holiday", title: "Founders Day", startsOn: today, endsOn: today, audience: "all" } },
          adminAuth,
        );
        expect(holidayRes.status).toBe(200);

        const staffEventRes = await dispatchAction(
          "calendar.event.upsert",
          { institution: inst.slug, input: { academicYearId: yearId, kind: "event", title: "Staff Meeting", startsOn: today, endsOn: today, audience: "staff" } },
          adminAuth,
        );
        expect(staffEventRes.status).toBe(200);

        // --- Admin attendance.mark today -> 409 invalid_state (holiday) --
        const markRes = await dispatchAction(
          "attendance.mark",
          { institution: inst.slug, input: { classSectionId: sectionId, date: today, records: [{ studentId: childAId, status: "P" }] } },
          adminAuth,
        );
        expect(markRes.status).toBe(409);
        const markBody = await markRes.json();
        expect(markBody.ok).toBe(false);
        expect(markBody.error.code).toBe("invalid_state");

        // --- Guardian calendar.forRole sees the holiday, not the staff event --
        const calRes = await dispatchQuery("calendar.forRole", inst.slug, {}, guardian1Auth);
        expect(calRes.status).toBe(200);
        const calBody = await calRes.json();
        expect(calBody.ok).toBe(true);
        const titles = (calBody.data as Array<{ title: string }>).map((e) => e.title);
        expect(titles).toContain("Founders Day");
        expect(titles).not.toContain("Staff Meeting");

        // --- Teacher raises -> admin assigns -> admin closes --------------
        const [teacherStaff] = await sql`
          select staff_id from public.memberships where institution_id = ${inst.institutionId} and user_id = ${inst.users.teacher.id}
        `;
        const teacherStaffId = teacherStaff.staff_id as string;

        const raiseRes = await dispatchAction(
          "maintenance.request",
          { institution: inst.slug, input: { location: "Library", issue: "Leaking roof", priority: "high" } },
          teacherAuth,
        );
        expect(raiseRes.status).toBe(200);
        const requestId = (await raiseRes.json()).data.id as string;

        const assignRes = await dispatchAction(
          "maintenance.assign",
          { institution: inst.slug, input: { requestId, assigneeStaffId: teacherStaffId } },
          adminAuth,
        );
        expect(assignRes.status).toBe(200);
        expect((await assignRes.json()).data.status).toBe("in_progress");

        const closeRes = await dispatchAction(
          "maintenance.close",
          { institution: inst.slug, input: { requestId, resolutionNote: "Fixed the leak" } },
          adminAuth,
        );
        expect(closeRes.status).toBe(200);
        expect((await closeRes.json()).data.status).toBe("done");

        // --- Teacher's own facilities.maintenanceRequests shows it done --
        const listRes = await dispatchQuery("facilities.maintenanceRequests", inst.slug, {}, teacherAuth);
        expect(listRes.status).toBe(200);
        const listBody = await listRes.json();
        expect(listBody.ok).toBe(true);
        const mine = (listBody.data as Array<{ id: string; status: string }>).find((r) => r.id === requestId);
        expect(mine?.status).toBe("done");
      } finally {
        await inst.cleanup();
      }
    },
  );
});
