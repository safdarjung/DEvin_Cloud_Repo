// Features-18 #14 — alumni_profiles RLS, column grants, sync_alumni definer, actions.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { syncAlumni, updateAlumniProfile } from "@/modules/alumni/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
let inst: TestInstitution;
let other: TestInstitution;
let gradId: string;
let leaverId: string;

async function mkStudent(institutionId: string, no: string, status: string): Promise<string> {
  const [r] = await sql`insert into public.students (institution_id, admission_no, first_name, last_name, dob, gender)
    values (${institutionId}, ${no}, 'Alum', ${no}, '2008-01-01', 'female') returning id`;
  if (status !== "active") await sql`update public.students set status = ${status} where id = ${r!.id}`;
  return r!.id as string;
}

beforeAll(async () => {
  inst = await createTestInstitution("alumni");
  other = await createTestInstitution("alumni-x");
  gradId = await mkStudent(inst.institutionId, "AL-1", "alumni");
  leaverId = await mkStudent(inst.institutionId, "AL-2", "withdrawn"); // not graduated: must not sync
  const [owner] = await sql`select user_id from public.memberships where institution_id = ${inst.institutionId} and role = 'owner'`;
  await sql`insert into public.student_lifecycle_events (institution_id, student_id, kind, effective_on, created_by)
    values (${inst.institutionId}, ${gradId}, 'graduated', '2024-03-31', ${owner!.user_id})`;
});

afterAll(async () => {
  await inst.cleanup();
  await other.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

describe("sync_alumni", () => {
  it("inserts graduated students once; second run adds 0; withdrawn student skipped", async () => {
    const first = await callAs(inst, "admin", syncAlumni, {});
    expect(first.ok && first.data.added).toBe(1);
    const second = await callAs(inst, "admin", syncAlumni, {});
    expect(second.ok && second.data.added).toBe(0);
    const rows = await sql`select student_id, batch_year from public.alumni_profiles where institution_id = ${inst.institutionId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.student_id).toBe(gradId);
    expect(rows[0]!.batch_year).toBe(2024);
    expect(rows.some((r) => r.student_id === leaverId)).toBe(false);
  });

  it("teacher, accountant, guardian and student are refused", async () => {
    for (const role of ["teacher", "accountant", "guardian", "student"] as const) {
      expect((await callAs(inst, role, syncAlumni, {})).ok).toBe(false);
    }
  });

  it("cross-tenant sync is refused (other tenant's admin cannot sync this institution)", async () => {
    const { error } = await other.clientAs("admin").rpc("sync_alumni", { p_institution_id: inst.institutionId });
    expect(error).not.toBeNull();
  });
});

describe("alumni_profiles", () => {
  it("contact update works; student_id and batch_year cannot change", async () => {
    const [p] = await sql`select id from public.alumni_profiles where institution_id = ${inst.institutionId}`;
    const ok = await callAs(inst, "principal", updateAlumniProfile, {
      id: p!.id, contactEmail: "a@b.in", contactPhone: "9876543210", occupation: "Doctor", city: "Pune",
    });
    expect(ok.ok).toBe(true);
    const [row] = await sql`select contact_email, city from public.alumni_profiles where id = ${p!.id}`;
    expect(row).toMatchObject({ contact_email: "a@b.in", city: "Pune" });

    const c = inst.clientAs("admin");
    const bad1 = await c.from("alumni_profiles").update({ batch_year: 1999 }).eq("id", p!.id);
    const bad2 = await c.from("alumni_profiles").update({ student_id: leaverId }).eq("id", p!.id);
    expect(bad1.error).not.toBeNull();
    expect(bad2.error).not.toBeNull();
    const [after] = await sql`select batch_year, student_id from public.alumni_profiles where id = ${p!.id}`;
    expect(after).toMatchObject({ batch_year: 2024, student_id: gradId });
  });

  it("teacher cannot update; client insert and delete are refused", async () => {
    const [p] = await sql`select id from public.alumni_profiles where institution_id = ${inst.institutionId}`;
    const r = await callAs(inst, "teacher", updateAlumniProfile, { id: p!.id, contactEmail: "", contactPhone: "", occupation: "", city: "x" });
    expect(r.ok).toBe(false);
    const ins = await inst.clientAs("admin").from("alumni_profiles").insert({ institution_id: inst.institutionId, student_id: leaverId, batch_year: 2020 });
    expect(ins.error).not.toBeNull();
    const del = await inst.clientAs("admin").from("alumni_profiles").delete().eq("id", p!.id);
    expect(del.error).not.toBeNull();
  });

  it("teacher, guardian and student read nothing; admissions reads", async () => {
    for (const role of ["teacher", "guardian", "student"] as const) {
      const { data } = await inst.clientAs(role).from("alumni_profiles").select("id");
      expect(data ?? []).toHaveLength(0);
    }
    const { data } = await inst.clientAs("admissions").from("alumni_profiles").select("id");
    expect(data).toHaveLength(1);
  });

  it("cross-tenant: other admin reads none and cannot update", async () => {
    const [p] = await sql`select id from public.alumni_profiles where institution_id = ${inst.institutionId}`;
    const { data } = await other.clientAs("admin").from("alumni_profiles").select("id");
    expect(data ?? []).toHaveLength(0);
    const r = await callAs(other, "admin", updateAlumniProfile, { id: p!.id, contactEmail: "", contactPhone: "", occupation: "", city: "Hax" });
    expect(r.ok).toBe(false);
    const [row] = await sql`select city from public.alumni_profiles where id = ${p!.id}`;
    expect(row!.city).toBe("Pune");
  });
});
