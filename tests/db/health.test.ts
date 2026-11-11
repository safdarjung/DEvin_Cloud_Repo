import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { addHealthVisit, addVaccination, saveHealthProfile } from "@/modules/health/actions";
import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
let inst: TestInstitution;
let other: TestInstitution;
let studentId: string;
let otherStudentId: string;
let guardianChildId: string;
let strangerChildId: string;

async function makeStudent(institutionId: string, name: string): Promise<string> {
  const [s] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, ${name}, '2015-01-01', 'other') returning id`;
  return s.id as string;
}

beforeAll(async () => {
  inst = await createTestInstitution("health-main");
  other = await createTestInstitution("health-other");
  studentId = await makeStudent(inst.institutionId, "Own");
  otherStudentId = await makeStudent(other.institutionId, "Foreign");
  guardianChildId = await makeStudent(inst.institutionId, "GuardianChild");
  strangerChildId = await makeStudent(inst.institutionId, "StrangerChild");
  const ctx = await buildContext(inst, "guardian");
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${inst.institutionId}, ${ctx.membership.guardianId}, ${guardianChildId}, 'mother', true, true)`;
});

afterAll(async () => {
  await inst.cleanup();
  await other.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

describe("health module (0114)", () => {
  it("admin saves a profile twice (insert then update by id) leaving one row", async () => {
    const first = await callAs(inst, "admin", saveHealthProfile, { studentId, bloodGroup: "O+", allergies: "Peanuts" });
    expect(first.ok).toBe(true);
    const second = await callAs(inst, "principal", saveHealthProfile, { studentId, bloodGroup: "A-", conditions: "Asthma" });
    expect(second.ok).toBe(true);
    const rows = await sql`select blood_group, allergies, conditions from public.health_profiles where student_id = ${studentId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ blood_group: "A-", allergies: null, conditions: "Asthma" });
  });

  it("owner adds a visit and a vaccination; audit carries no clinical text", async () => {
    const v = await callAs(inst, "owner", addHealthVisit, { studentId, complaint: "SecretComplaintXyz", outcome: "sent_home" });
    expect(v.ok).toBe(true);
    const vx = await callAs(inst, "owner", addVaccination, { studentId, vaccine: "SecretVaccineXyz", administeredOn: "2026-02-01" });
    expect(vx.ok).toBe(true);
    const audits = await sql`select before, after, metadata from public.audit_events where institution_id = ${inst.institutionId} and action like 'health.%'`;
    expect(audits.length).toBeGreaterThanOrEqual(4);
    const json = JSON.stringify(audits);
    expect(json).not.toContain("SecretComplaintXyz");
    expect(json).not.toContain("SecretVaccineXyz");
    expect(json).not.toContain("Peanuts");
  });

  it("teacher and student are refused every write action", async () => {
    for (const role of ["teacher", "student", "guardian"] as const) {
      const r1 = await callAs(inst, role, saveHealthProfile, { studentId, allergies: "x" });
      const r2 = await callAs(inst, role, addHealthVisit, { studentId, complaint: "x" });
      const r3 = await callAs(inst, role, addVaccination, { studentId, vaccine: "x", administeredOn: "2026-01-01" });
      for (const r of [r1, r2, r3]) {
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code).toBe("forbidden");
      }
    }
  });

  it("teacher and student read zero rows from all three tables; admin reads them", async () => {
    for (const role of ["teacher", "student"] as const) {
      const c = inst.clientAs(role);
      for (const t of ["health_profiles", "health_visits", "vaccinations"]) {
        const { data, error } = await c.from(t).select("id");
        expect(error).toBeNull();
        expect(data).toEqual([]);
      }
    }
    const { data } = await inst.clientAs("admin").from("health_visits").select("id");
    expect(data!.length).toBeGreaterThan(0);
  });

  it("guardian reads only their own child's rows", async () => {
    await sql`insert into public.health_profiles (institution_id, student_id, blood_group) values (${inst.institutionId}, ${guardianChildId}, 'B+')`;
    await sql`insert into public.health_profiles (institution_id, student_id, blood_group) values (${inst.institutionId}, ${strangerChildId}, 'B-')`;
    const { data, error } = await inst.clientAs("guardian").from("health_profiles").select("student_id");
    expect(error).toBeNull();
    expect(data).toEqual([{ student_id: guardianChildId }]);
    const visits = await inst.clientAs("guardian").from("health_visits").select("id");
    expect(visits.data).toEqual([]); // own child has no visits; the other student's visit is hidden
  });

  it("guardian cannot write directly", async () => {
    const { error } = await inst.clientAs("guardian").from("health_profiles").insert({ institution_id: inst.institutionId, student_id: guardianChildId });
    expect(error).not.toBeNull();
    const upd = await inst.clientAs("guardian").from("health_profiles").update({ allergies: "x" }).eq("student_id", guardianChildId).select("id");
    expect(upd.data ?? []).toEqual([]);
  });

  it("cross-tenant: admin cannot write for, or read, another school's student", async () => {
    const r = await callAs(inst, "admin", addHealthVisit, { studentId: otherStudentId, complaint: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("forbidden");
      expect(r.error.message).not.toContain("x");
    }
    await sql`insert into public.health_profiles (institution_id, student_id) values (${other.institutionId}, ${otherStudentId})`;
    const { data } = await inst.clientAs("admin").from("health_profiles").select("student_id").eq("student_id", otherStudentId);
    expect(data).toEqual([]);
  });

  it("UPDATE cannot change student_id or institution_id (column grants)", async () => {
    const { error } = await inst.clientAs("admin").from("health_profiles").update({ student_id: guardianChildId }).eq("student_id", studentId);
    expect(error).not.toBeNull();
  });
});
