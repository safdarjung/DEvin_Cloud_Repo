// Features-18 #20 — achievements RLS, column-scoped insert, verify/void definers, actions.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { recordAchievement, verifyAchievement, voidAchievement } from "@/modules/achievements/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createEnrolment, createGrade } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
let inst: TestInstitution;
let other: TestInstitution;
let studentId: string; // the fixture student, taught by the fixture teacher, child of the fixture guardian
let strangerId: string; // taught by nobody, not the guardian's child
let otherStudentId: string; // belongs to the other institution

async function one(q: Promise<postgres.RowList<postgres.Row[]>>) {
  const [r] = await q;
  return r!;
}

beforeAll(async () => {
  inst = await createTestInstitution("achv");
  other = await createTestInstitution("achv-x");
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId, { code: "VI" });
  const teacherStaff = (await one(sql`select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'`)).staff_id as string;
  const sectionA = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A", classTeacherId: teacherStaff });
  studentId = (await one(sql`select student_id from public.memberships where institution_id = ${inst.institutionId} and role = 'student'`)).student_id as string;
  await createEnrolment(inst.institutionId, studentId, sectionA, yearId, { status: "active" });
  const guardianId = (await one(sql`select guardian_id from public.memberships where institution_id = ${inst.institutionId} and role = 'guardian'`)).guardian_id as string;
  await sql`insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${inst.institutionId}, ${guardianId}, ${studentId}, 'father', true, true)`;
  strangerId = (await one(sql`insert into public.students (institution_id, admission_no, first_name, last_name, dob, gender)
    values (${inst.institutionId}, 'AC-X1', 'Stray', 'Student', '2014-01-01', 'male') returning id`)).id as string;
  otherStudentId = (await one(sql`select student_id from public.memberships where institution_id = ${other.institutionId} and role = 'student'`)).student_id as string;
});

afterAll(async () => {
  await inst.cleanup();
  await other.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

const input = (sid: string, title = "Chess winner") => ({ studentId: sid, title, category: "sports" as const, level: "district" as const, position: "1st", eventDate: "2026-10-10" });

async function record(role: "teacher" | "admin" | "principal", sid = studentId): Promise<string> {
  const r = await callAs(inst, role, recordAchievement, input(sid));
  if (!r.ok) throw new Error(`setup: ${r.error.code}`);
  return r.data.id;
}

describe("achievements", () => {
  it("teacher records for a taught student only; admin for any; others refused", async () => {
    expect((await callAs(inst, "teacher", recordAchievement, input(studentId))).ok).toBe(true);
    expect((await callAs(inst, "teacher", recordAchievement, input(strangerId))).ok).toBe(false);
    expect((await callAs(inst, "admin", recordAchievement, input(strangerId))).ok).toBe(true);
    for (const role of ["guardian", "student", "accountant"] as const) {
      expect((await callAs(inst, role, recordAchievement, input(studentId))).ok).toBe(false);
    }
  });

  it("teacher cannot verify; admin verifies once; second verify is invalid_state", async () => {
    const id = await record("teacher");
    const denied = await callAs(inst, "teacher", verifyAchievement, { achievementId: id });
    expect(denied.ok).toBe(false);
    expect((await callAs(inst, "admin", verifyAchievement, { achievementId: id })).ok).toBe(true);
    const again = await callAs(inst, "principal", verifyAchievement, { achievementId: id });
    expect(!again.ok && again.error.code).toBe("invalid_state");
    const row = await one(sql`select verified_by from public.achievements where id = ${id}`);
    expect(row.verified_by).toBe(inst.users.admin.id);
  });

  it("guardian sees only the own child, student only self; stranger rows hidden; accountant sees none", async () => {
    const strangerRow = await record("admin", strangerId);
    const mine = await record("admin", studentId);
    for (const role of ["guardian", "student"] as const) {
      const { data } = await inst.clientAs(role).from("achievements").select("id, student_id");
      expect(data!.length).toBeGreaterThan(0);
      expect(data!.every((r) => r.student_id === studentId)).toBe(true);
      expect(data!.some((r) => r.id === strangerRow)).toBe(false);
      expect(data!.some((r) => r.id === mine)).toBe(true);
    }
    const { data: acct } = await inst.clientAs("accountant").from("achievements").select("id");
    expect(acct).toEqual([]);
    const { data: teach } = await inst.clientAs("teacher").from("achievements").select("id").eq("id", strangerRow);
    expect(teach).toEqual([]);
  });

  it("void: guardian/student never see voided rows; teacher voids only own unverified; admin any", async () => {
    const mine = await record("teacher");
    const theirs = await record("admin");
    const verifiedMine = await record("teacher");
    await callAs(inst, "admin", verifyAchievement, { achievementId: verifiedMine });

    expect((await callAs(inst, "teacher", voidAchievement, { achievementId: theirs, reason: "nope" })).ok).toBe(false);
    expect((await callAs(inst, "teacher", voidAchievement, { achievementId: verifiedMine, reason: "nope" })).ok).toBe(false);
    expect((await callAs(inst, "teacher", voidAchievement, { achievementId: mine, reason: "mistake" })).ok).toBe(true);
    expect((await callAs(inst, "admin", voidAchievement, { achievementId: verifiedMine, reason: "withdrawn" })).ok).toBe(true);

    const again = await callAs(inst, "admin", voidAchievement, { achievementId: mine, reason: "again" });
    expect(!again.ok && again.error.code).toBe("invalid_state");
    const verifyVoided = await callAs(inst, "admin", verifyAchievement, { achievementId: mine });
    expect(!verifyVoided.ok && verifyVoided.error.code).toBe("invalid_state");

    for (const role of ["guardian", "student"] as const) {
      const { data } = await inst.clientAs(role).from("achievements").select("id").in("id", [mine, verifiedMine]);
      expect(data).toEqual([]);
    }
    const { data: adm } = await inst.clientAs("admin").from("achievements").select("id, voided_at").eq("id", mine);
    expect(adm).toHaveLength(1);
    const audit = await sql`select 1 from public.audit_events where entity_id = ${mine} and action = 'achievement.voided'`;
    expect(audit).toHaveLength(1);
  });

  it("direct update of verify/void fields and delete are refused", async () => {
    const id = await record("admin");
    for (const patch of [{ verified_at: new Date().toISOString(), verified_by: inst.users.admin.id }, { title: "Edited" }, { voided_at: new Date().toISOString() }]) {
      const upd = await inst.clientAs("admin").from("achievements").update(patch).eq("id", id).select();
      expect(upd.error !== null || upd.data!.length === 0).toBe(true);
    }
    const del = await inst.clientAs("admin").from("achievements").delete().eq("id", id).select();
    expect(del.error !== null || del.data!.length === 0).toBe(true);
    const row = await one(sql`select title, verified_at, voided_at from public.achievements where id = ${id}`);
    expect(row.title).toBe("Chess winner");
    expect(row.verified_at).toBeNull();
    expect(row.voided_at).toBeNull();
  });

  it("direct insert with verified fields set is refused", async () => {
    const r = await inst.clientAs("admin").from("achievements").insert({
      institution_id: inst.institutionId, student_id: studentId, title: "Sneaky", category: "other", level: "school", event_date: "2026-10-10",
      verified_at: new Date().toISOString(), verified_by: inst.users.admin.id,
    } as never);
    expect(r.error).not.toBeNull();
  });

  it("cross-tenant: record, verify and void are refused; rows are invisible", async () => {
    const id = await record("admin");
    expect((await callAs(other, "admin", recordAchievement, input(studentId))).ok).toBe(false);
    expect((await callAs(inst, "admin", recordAchievement, input(otherStudentId))).ok).toBe(false);
    const v = await callAs(other, "admin", verifyAchievement, { achievementId: id });
    expect(!v.ok && v.error.code).toBe("not_found");
    const x = await callAs(other, "admin", voidAchievement, { achievementId: id, reason: "x-tenant" });
    expect(!x.ok && x.error.code).toBe("not_found");
    const { data } = await other.clientAs("admin").from("achievements").select("id").eq("id", id);
    expect(data).toEqual([]);
  });
});
