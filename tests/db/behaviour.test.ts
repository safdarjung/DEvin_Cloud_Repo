// Features-18 #4 — behaviour_incidents RLS, append-only guard, void definer, actions.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { logIncident, voidIncident } from "@/modules/behaviour/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createEnrolment, createGrade } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
let inst: TestInstitution;
let other: TestInstitution;
let studentId: string;
let strangerId: string;

async function one(q: Promise<postgres.RowList<postgres.Row[]>>) {
  const [r] = await q;
  return r!;
}

beforeAll(async () => {
  inst = await createTestInstitution("behav");
  other = await createTestInstitution("behav-x");
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId, { code: "VI" });
  const teacherStaff = (await one(sql`select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'`)).staff_id as string;
  const sectionA = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A", classTeacherId: teacherStaff });
  studentId = (await one(sql`select student_id from public.memberships where institution_id = ${inst.institutionId} and role = 'student'`)).student_id as string;
  await createEnrolment(inst.institutionId, studentId, sectionA, yearId, { status: "active" });
  const guardianId = (await one(sql`select guardian_id from public.memberships where institution_id = ${inst.institutionId} and role = 'guardian'`)).guardian_id as string;
  await sql`insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${inst.institutionId}, ${guardianId}, ${studentId}, 'father', true, true)`;
  // A student the teacher does not teach.
  strangerId = (await one(sql`insert into public.students (institution_id, admission_no, first_name, last_name, dob, gender)
    values (${inst.institutionId}, 'BH-X1', 'Stray', 'Student', '2014-01-01', 'male') returning id`)).id as string;
});

afterAll(async () => {
  await inst.cleanup();
  await other.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

const input = (sid: string, points = -5) => ({ studentId: sid, category: "Disruption", severity: "medium" as const, points, note: "test" });

describe("behaviour_incidents", () => {
  it("teacher logs for a taught student, refused for another student", async () => {
    const ok = await callAs(inst, "teacher", logIncident, input(studentId));
    expect(ok.ok).toBe(true);
    const bad = await callAs(inst, "teacher", logIncident, input(strangerId));
    expect(bad.ok).toBe(false);
  });

  it("admin logs for any student; guardian, student, accountant cannot write", async () => {
    expect((await callAs(inst, "admin", logIncident, input(strangerId, 3))).ok).toBe(true);
    for (const role of ["guardian", "student", "accountant"] as const) {
      const r = await callAs(inst, role, logIncident, input(studentId));
      expect(r.ok).toBe(false);
    }
  });

  it("cross-tenant student is refused", async () => {
    const r = await callAs(other, "admin", logIncident, input(studentId));
    expect(r.ok).toBe(false);
  });

  it("guardian and student read own non-voided rows; accountant reads none", async () => {
    const created = await callAs(inst, "principal", logIncident, input(studentId, 7));
    if (!created.ok) throw new Error("setup");
    await callAs(inst, "principal", voidIncident, { incidentId: created.data.id, reason: "Wrong student" });
    for (const role of ["guardian", "student"] as const) {
      const { data } = await inst.clientAs(role).from("behaviour_incidents").select("id, voided_at");
      expect(data!.length).toBeGreaterThan(0);
      expect(data!.every((r) => r.voided_at === null)).toBe(true);
      expect(data!.some((r) => r.id === created.data.id)).toBe(false);
    }
    const { data: acct } = await inst.clientAs("accountant").from("behaviour_incidents").select("id");
    expect(acct).toEqual([]);
    const { data: adm } = await inst.clientAs("admin").from("behaviour_incidents").select("id").eq("id", created.data.id);
    expect(adm).toHaveLength(1);
  });

  it("direct update and delete are refused; guard forces reported_by", async () => {
    const created = await callAs(inst, "admin", logIncident, input(studentId));
    if (!created.ok) throw new Error("setup");
    const upd = await inst.clientAs("admin").from("behaviour_incidents").update({ points: 99 }).eq("id", created.data.id).select();
    expect(upd.error !== null || upd.data!.length === 0).toBe(true);
    const del = await inst.clientAs("admin").from("behaviour_incidents").delete().eq("id", created.data.id).select();
    expect(del.error !== null || del.data!.length === 0).toBe(true);
    const row = await one(sql`select reported_by, points from public.behaviour_incidents where id = ${created.data.id}`);
    expect(row.reported_by).toBe(inst.users.admin.id);
    expect(row.points).toBe(-5);
  });

  it("void: teacher voids own report only, double void invalid_state, non-member not_found", async () => {
    const mine = await callAs(inst, "teacher", logIncident, input(studentId));
    const theirs = await callAs(inst, "admin", logIncident, input(studentId));
    if (!mine.ok || !theirs.ok) throw new Error("setup");
    expect((await callAs(inst, "teacher", voidIncident, { incidentId: theirs.data.id, reason: "nope" })).ok).toBe(false);
    expect((await callAs(inst, "teacher", voidIncident, { incidentId: mine.data.id, reason: "mistake" })).ok).toBe(true);
    const again = await callAs(inst, "admin", voidIncident, { incidentId: mine.data.id, reason: "again" });
    expect(!again.ok && again.error.code).toBe("invalid_state");
    const foreign = await callAs(other, "admin", voidIncident, { incidentId: theirs.data.id, reason: "x-tenant" });
    expect(!foreign.ok && foreign.error.code).toBe("not_found");
    const audit = await sql`select 1 from public.audit_events where entity_id = ${mine.data.id} and action = 'behaviour.incident.voided'`;
    expect(audit).toHaveLength(1);
  });
});
