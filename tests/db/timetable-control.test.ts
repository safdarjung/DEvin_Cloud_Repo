import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mock (T-022 lead review pattern): actions run on the role's real client.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { publishVersion } from "@/modules/timetable/actions";
import { applyTimetableChanges, rollbackTimetableChange, setTimetableRules } from "@/modules/timetable/control.actions";
import { defaultRules } from "@/modules/timetable/rules";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createEnrolment, createGrade, createSubject, createSubjectAssignment } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

// 0141 — timetable control: change log RLS + immutability, notes on published
// edits, rollback refusals, version restore, rules permissions.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function staffRow(institutionId: string, fullName: string): Promise<string> {
  const [row] = await sql`
    insert into public.staff (institution_id, employee_no, full_name, designation, is_teaching)
    values (${institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, ${fullName}, 'Teacher', true)
    returning id
  `;
  return row.id as string;
}

interface Fixture {
  inst: TestInstitution;
  yearId: string;
  sectionA: string;
  sectionB: string;
  subjectId: string;
  iyer: string;
  rao: string;
  p1: string;
  p2: string;
  versionId: string;
}

async function setup(name: string): Promise<Fixture> {
  const inst = await createTestInstitution(name);
  const id = inst.institutionId;
  const yearId = await createAcademicYear(id);
  const gradeId = await createGrade(id);
  const sectionA = await createClassSection(id, gradeId, yearId, { name: "A" });
  const sectionB = await createClassSection(id, gradeId, yearId, { name: "B" });
  const subjectId = await createSubject(id);
  const iyer = await staffRow(id, "Ms Iyer");
  const rao = await staffRow(id, "Mr Rao");
  const [p1] = await sql`insert into public.periods (institution_id, seq, name, starts_at, ends_at) values (${id}, 1, 'Period 1', '08:00', '08:45') returning id`;
  const [p2] = await sql`insert into public.periods (institution_id, seq, name, starts_at, ends_at) values (${id}, 2, 'Period 2', '08:45', '09:30') returning id`;
  const [v] = await sql`
    insert into public.timetable_versions (institution_id, academic_year_id, name, created_by)
    values (${id}, ${yearId}, 'Draft v1', ${inst.users.admin.id}) returning id
  `;
  return { inst, yearId, sectionA, sectionB, subjectId, iyer, rao, p1: p1.id, p2: p2.id, versionId: v.id };
}

const cell = (f: Fixture, sectionId: string, periodId: string, teacherId: string | null) => ({
  classSectionId: sectionId,
  weekday: 1,
  periodId,
  after: teacherId ? { subjectId: f.subjectId, teacherId } : null,
});

describe("timetable control (0141)", () => {
  it("teacher cannot change the rules or roll back; admin can, and the rules change is logged with its reason", async () => {
    const f = await setup("ttc-perms");
    try {
      const rules = { ...defaultRules(36), max_teacher_per_day: { enabled: true, value: 5 } };
      const denied = await callAs(f.inst, "teacher", setTimetableRules, { rules, reason: "Probe" });
      expect(denied.ok).toBe(false);
      if (!denied.ok) expect(denied.error.code).toBe("forbidden");

      const direct = await f.inst.clientAs("teacher").rpc("set_timetable_rules", { p_institution_id: f.inst.institutionId, p_rules: rules, p_reason: "x" });
      expect(direct.error?.message).toBe("code:forbidden");

      const ok = await callAs(f.inst, "admin", setTimetableRules, { rules, reason: "Teachers asked for lighter days" });
      expect(ok.ok).toBe(true);
      const { data: log } = await f.inst.clientAs("admin").from("timetable_changes").select("id, kind, reason, after").eq("institution_id", f.inst.institutionId);
      expect(log).toHaveLength(1);
      expect(log![0]).toMatchObject({ kind: "rules", reason: "Teachers asked for lighter days" });

      const teacherReads = await f.inst.clientAs("teacher").from("timetable_rules").select("rules");
      expect(teacherReads.data).toEqual([]);

      const rollback = await callAs(f.inst, "teacher", rollbackTimetableChange, { changeId: log![0].id });
      expect(rollback.ok).toBe(false);
      if (!rollback.ok) expect(rollback.error.code).toBe("forbidden");
      const directUndo = await f.inst.clientAs("teacher").rpc("apply_timetable_changes", {
        p_version_id: f.versionId,
        p_kind: "manual",
        p_changes: [{ sectionId: f.sectionA, weekday: 1, periodId: f.p1, after: { subjectId: f.subjectId, teacherId: f.iyer } }],
      });
      expect(directUndo.error?.message).toBe("code:forbidden");

      const undone = await callAs(f.inst, "admin", rollbackTimetableChange, { changeId: log![0].id });
      expect(undone.ok).toBe(true);
      const [row] = await sql`select rules from public.timetable_rules where institution_id = ${f.inst.institutionId}`;
      expect(row.rules).toEqual({});
    } finally {
      await f.inst.cleanup();
    }
  });

  it("change log rows cannot be updated or deleted by anyone through PostgREST", async () => {
    const f = await setup("ttc-immutable");
    try {
      const applied = await callAs(f.inst, "admin", applyTimetableChanges, { versionId: f.versionId, kind: "manual", changes: [cell(f, f.sectionA, f.p1, f.iyer)] });
      expect(applied.ok).toBe(true);
      const [change] = await sql`select id from public.timetable_changes where institution_id = ${f.inst.institutionId}`;

      for (const role of ["owner", "admin", "teacher"] as const) {
        const upd = await f.inst.clientAs(role).from("timetable_changes").update({ reason: "rewritten" }).eq("id", change.id).select("id");
        expect(upd.error, role).not.toBeNull();
        const del = await f.inst.clientAs(role).from("timetable_changes").delete().eq("id", change.id).select("id");
        expect(del.error, role).not.toBeNull();
      }
      await expect(sql`update public.timetable_changes set reason = 'rewritten' where id = ${change.id}`).rejects.toThrow(/code:invalid_state/);
      const [still] = await sql`select reason from public.timetable_changes where id = ${change.id}`;
      expect(still.reason).toBe("Edited on the draft (no note given)");
    } finally {
      await f.inst.cleanup();
    }
  });

  it("a manual edit to a published version without a note is refused; with a note it is logged before -> after", async () => {
    const f = await setup("ttc-note");
    try {
      await callAs(f.inst, "admin", applyTimetableChanges, { versionId: f.versionId, kind: "manual", changes: [cell(f, f.sectionA, f.p1, f.iyer)] });
      const published = await callAs(f.inst, "admin", publishVersion, { versionId: f.versionId });
      expect(published.ok).toBe(true);

      const noNote = await callAs(f.inst, "admin", applyTimetableChanges, { versionId: f.versionId, kind: "manual", changes: [cell(f, f.sectionA, f.p1, f.rao)] });
      expect(noNote.ok).toBe(false);
      if (!noNote.ok) {
        expect(noNote.error.code).toBe("validation_failed");
        expect(noNote.error.fieldErrors?.note).toBeDefined();
      }

      const withNote = await callAs(f.inst, "admin", applyTimetableChanges, {
        versionId: f.versionId,
        kind: "manual",
        changes: [cell(f, f.sectionA, f.p1, f.rao)],
        note: "Ms Iyer moved to senior classes",
      });
      expect(withNote.ok).toBe(true);
      const [row] = await sql`
        select kind, action, reason, before ->> 'teacher' as was, after ->> 'teacher' as now, actor_name
        from public.timetable_changes where institution_id = ${f.inst.institutionId} and action = 'change'
      `;
      expect(row).toMatchObject({ kind: "manual", action: "change", reason: "Ms Iyer moved to senior classes", was: "Ms Iyer", now: "Mr Rao" });
      expect(row.actor_name).toBeTruthy();
      const [slot] = await sql`select teacher_id from public.timetable_slots where version_id = ${f.versionId}`;
      expect(slot.teacher_id).toBe(f.rao);
    } finally {
      await f.inst.cleanup();
    }
  });

  it("rollback: a clash or a later change is refused with a clear message; a clean undo is logged once", async () => {
    const f = await setup("ttc-rollback");
    try {
      const add = await callAs(f.inst, "admin", applyTimetableChanges, { versionId: f.versionId, kind: "manual", changes: [cell(f, f.sectionA, f.p1, f.iyer)] });
      const move = await callAs(f.inst, "admin", applyTimetableChanges, { versionId: f.versionId, kind: "manual", changes: [cell(f, f.sectionA, f.p1, f.rao)] });
      const takeIyer = await callAs(f.inst, "admin", applyTimetableChanges, { versionId: f.versionId, kind: "manual", changes: [cell(f, f.sectionB, f.p1, f.iyer)] });
      if (!add.ok || !move.ok || !takeIyer.ok) throw new Error("setup failed");

      const clash = await callAs(f.inst, "admin", rollbackTimetableChange, { changeId: move.data.changes[0].id });
      expect(clash.ok).toBe(false);
      if (!clash.ok) {
        expect(clash.error.code).toBe("conflict");
        expect(clash.error.message).toMatch(/^Can't undo: it would cause a clash — Ms Iyer already teaches/);
      }

      const stale = await callAs(f.inst, "admin", rollbackTimetableChange, { changeId: add.data.changes[0].id });
      expect(stale.ok).toBe(false);
      if (!stale.ok) expect(stale.error.message).toMatch(/was changed again after this change/);

      const undo = await callAs(f.inst, "admin", rollbackTimetableChange, { changeId: takeIyer.data.changes[0].id, note: "wrong section" });
      expect(undo.ok).toBe(true);
      const [log] = await sql`select kind, action, reason, reverts_change_id from public.timetable_changes where reverts_change_id = ${takeIyer.data.changes[0].id}`;
      expect(log).toMatchObject({ kind: "rollback", action: "remove" });
      expect(log.reason).toMatch(/^Rollback of: Edited on the draft/);
      expect(log.reason).toContain("Note: wrong section");
      const [{ n }] = await sql`select count(*)::int as n from public.timetable_slots where version_id = ${f.versionId} and class_section_id = ${f.sectionB}`;
      expect(n).toBe(0);

      const again = await callAs(f.inst, "admin", rollbackTimetableChange, { changeId: takeIyer.data.changes[0].id });
      expect(again.ok).toBe(false);
      if (!again.ok) expect(again.error.code).toBe("conflict");
    } finally {
      await f.inst.cleanup();
    }
  });

  it("restoring an archived version archives the current one and keeps exactly one published", async () => {
    const f = await setup("ttc-restore");
    try {
      await callAs(f.inst, "admin", applyTimetableChanges, { versionId: f.versionId, kind: "manual", changes: [cell(f, f.sectionA, f.p1, f.iyer)] });
      expect((await callAs(f.inst, "admin", publishVersion, { versionId: f.versionId })).ok).toBe(true);
      const [v2] = await sql`
        insert into public.timetable_versions (institution_id, academic_year_id, name, created_by)
        values (${f.inst.institutionId}, ${f.yearId}, 'Term 2', ${f.inst.users.admin.id}) returning id
      `;
      expect((await callAs(f.inst, "admin", publishVersion, { versionId: v2.id })).ok).toBe(true);

      const noNote = await callAs(f.inst, "admin", publishVersion, { versionId: f.versionId });
      expect(noNote.ok).toBe(false);
      if (!noNote.ok) expect(noNote.error.code).toBe("validation_failed");

      const restored = await callAs(f.inst, "admin", publishVersion, { versionId: f.versionId, note: "Term 2 draft had errors" });
      expect(restored.ok).toBe(true);
      const rows = await sql`select id, status from public.timetable_versions where institution_id = ${f.inst.institutionId} order by created_at`;
      expect(rows.map((r) => r.status)).toEqual(["published", "archived"]);
      const [log] = await sql`select kind, reason, after ->> 'name' as name from public.timetable_changes where institution_id = ${f.inst.institutionId} and kind = 'restore'`;
      expect(log).toMatchObject({ kind: "restore", reason: "Term 2 draft had errors", name: "Draft v1" });
    } finally {
      await f.inst.cleanup();
    }
  });

  it("school A cannot read school B's log, and a student sees only reasons for their own section", async () => {
    const f = await setup("ttc-scope-a");
    const other = await setup("ttc-scope-b");
    try {
      await callAs(other.inst, "admin", applyTimetableChanges, { versionId: other.versionId, kind: "manual", changes: [cell(other, other.sectionA, other.p1, other.iyer)] });
      const crossTenant = await f.inst.clientAs("admin").from("timetable_changes").select("id").eq("institution_id", other.inst.institutionId);
      expect(crossTenant.data).toEqual([]);

      await callAs(f.inst, "admin", applyTimetableChanges, {
        versionId: f.versionId,
        kind: "manual",
        changes: [cell(f, f.sectionA, f.p1, f.iyer), cell(f, f.sectionB, f.p1, f.rao)],
      });
      expect((await callAs(f.inst, "admin", publishVersion, { versionId: f.versionId })).ok).toBe(true);
      await callAs(f.inst, "admin", applyTimetableChanges, {
        versionId: f.versionId,
        kind: "manual",
        changes: [cell(f, f.sectionA, f.p2, f.rao), cell(f, f.sectionB, f.p2, f.iyer)],
        note: "Sports day swap",
      });

      const [{ student_id: studentId }] = await sql`select student_id from public.memberships where user_id = ${f.inst.users.student.id}`;
      await createEnrolment(f.inst.institutionId, studentId, f.sectionA, f.yearId);

      const seen = await f.inst.clientAs("student").from("timetable_changes").select("class_section_id, reason, kind");
      expect(seen.error).toBeNull();
      expect(seen.data!.length).toBeGreaterThan(0);
      expect(seen.data!.every((r) => r.class_section_id === f.sectionA)).toBe(true);
      expect(seen.data!.some((r) => r.reason === "Sports day swap")).toBe(true);

      const guardianSees = await f.inst.clientAs("guardian").from("timetable_changes").select("id");
      expect(guardianSees.data).toEqual([]);
      const accountantSees = await f.inst.clientAs("accountant").from("timetable_changes").select("id");
      expect(accountantSees.data).toEqual([]);
    } finally {
      await f.inst.cleanup();
      await other.inst.cleanup();
    }
  });

  it("a rollback restores exactly the old value even when the call carries a different after, with no note", async () => {
    const f = await setup("ttc-rb-forged");
    try {
      const third = await staffRow(f.inst.institutionId, "Ms Third");
      await callAs(f.inst, "admin", applyTimetableChanges, { versionId: f.versionId, kind: "manual", changes: [cell(f, f.sectionA, f.p1, f.iyer)] });
      expect((await callAs(f.inst, "admin", publishVersion, { versionId: f.versionId })).ok).toBe(true);
      const move = await callAs(f.inst, "admin", applyTimetableChanges, { versionId: f.versionId, kind: "manual", changes: [cell(f, f.sectionA, f.p1, f.rao)], note: "Iyer to seniors" });
      if (!move.ok) throw new Error("setup failed");

      const forged = await f.inst.clientAs("admin").rpc("apply_timetable_changes", {
        p_version_id: f.versionId,
        p_kind: "rollback",
        p_changes: [{ sectionId: f.sectionA, weekday: 1, periodId: f.p1, after: { subjectId: f.subjectId, teacherId: third } }],
        p_reverts_change_id: move.data.changes[0].id,
      });
      expect(forged.error).toBeNull();
      const [slot] = await sql`select teacher_id from public.timetable_slots where version_id = ${f.versionId} and class_section_id = ${f.sectionA}`;
      expect(slot.teacher_id).toBe(f.iyer);
      const [log] = await sql`select after ->> 'teacherId' as now from public.timetable_changes where reverts_change_id = ${move.data.changes[0].id}`;
      expect(log.now).toBe(f.iyer);
    } finally {
      await f.inst.cleanup();
    }
  });

  it("substitution detail stays with managers and the two teachers; students and guardians get only a fixed line for their own section", async () => {
    const f = await setup("ttc-sub");
    try {
      const id = f.inst.institutionId;
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 3);
      while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
      const date = d.toISOString().slice(0, 10);
      const weekday = d.getUTCDay();

      // Fixture logins: exam_controller's staff row teaches the period (covered), admissions' covers it,
      // and the teacher login teaches section A but is not involved.
      const staffOf = async (role: string) => (await sql`select staff_id from public.memberships where institution_id = ${id} and role = ${role}`)[0]!.staff_id as string;
      const covered = await staffOf("exam_controller");
      const covering = await staffOf("admissions");
      const uninvolved = await staffOf("teacher");
      await createSubjectAssignment(id, f.sectionA, f.subjectId, uninvolved);

      await callAs(f.inst, "admin", applyTimetableChanges, {
        versionId: f.versionId,
        kind: "manual",
        changes: [
          { classSectionId: f.sectionA, weekday, periodId: f.p1, after: { subjectId: f.subjectId, teacherId: covered } },
          { classSectionId: f.sectionB, weekday, periodId: f.p2, after: { subjectId: f.subjectId, teacherId: f.iyer } },
        ],
      });
      expect((await callAs(f.inst, "admin", publishVersion, { versionId: f.versionId })).ok).toBe(true);
      const [slotA] = await sql`select id from public.timetable_slots where version_id = ${f.versionId} and class_section_id = ${f.sectionA}`;
      const [slotB] = await sql`select id from public.timetable_slots where version_id = ${f.versionId} and class_section_id = ${f.sectionB}`;
      const note = "Family emergency at home, back Monday";
      const assigned = await f.inst.clientAs("admin").rpc("assign_substitution", { p_slot_id: slotA.id, p_date: date, p_substitute_id: covering, p_note: note });
      expect(assigned.error).toBeNull();
      expect((await f.inst.clientAs("admin").rpc("assign_substitution", { p_slot_id: slotB.id, p_date: date, p_substitute_id: f.rao, p_note: "B note" })).error).toBeNull();

      const [{ student_id: studentId }] = await sql`select student_id from public.memberships where user_id = ${f.inst.users.student.id}`;
      const [{ guardian_id: guardianId }] = await sql`select guardian_id from public.memberships where user_id = ${f.inst.users.guardian.id}`;
      await createEnrolment(id, studentId, f.sectionA, f.yearId);
      await sql`insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
        values (${id}, ${guardianId}, ${studentId}, 'mother', true, true)`;
      const [{ name: subjectName }] = await sql`select name from public.subjects where id = ${f.subjectId}`;
      const [{ full_name: coverName }] = await sql`select full_name from public.staff where id = ${covering}`;

      for (const role of ["student", "guardian"] as const) {
        const rows = await f.inst.clientAs(role).from("timetable_changes").select("reason").not("substitution_id", "is", null);
        expect(rows.error, role).toBeNull();
        expect(rows.data, role).toEqual([]);
        const covers = await f.inst.clientAs(role).rpc("my_section_covers", { p_institution_id: id, p_date: date });
        expect(covers.error, role).toBeNull();
        expect(covers.data, role).toEqual([{ class_section_id: f.sectionA, period_id: f.p1, on_date: date, subject: subjectName, cover_teacher: coverName }]);
      }
      // The covers line is only for the caller's own sections: the uninvolved teacher (no enrolment) gets nothing.
      expect((await f.inst.clientAs("teacher").rpc("my_section_covers", { p_institution_id: id, p_date: date })).data).toEqual([]);

      const uninvolvedRows = await f.inst.clientAs("teacher").from("timetable_changes").select("reason").not("substitution_id", "is", null);
      expect(uninvolvedRows.data).toEqual([]);
      for (const role of ["admissions", "exam_controller", "admin"] as const) {
        const rows = await f.inst.clientAs(role).from("timetable_changes").select("kind, action, reason, after").eq("substitution_id", assigned.data!.id);
        expect(rows.data, role).toHaveLength(1);
        expect(rows.data![0], role).toMatchObject({ kind: "substitution", action: "cover", reason: note });
        expect((rows.data![0].after as { teacher: string }).teacher).toBe(coverName);
      }

      const [cover] = await sql`select id from public.timetable_changes where action = 'cover' and substitution_id = ${assigned.data!.id}`;
      const undo = await callAs(f.inst, "admin", rollbackTimetableChange, { changeId: cover.id });
      expect(undo.ok).toBe(true);
      const [sub] = await sql`select status from public.substitutions where id = ${assigned.data!.id}`;
      expect(sub.status).toBe("cancelled");
      const [log] = await sql`select kind, action, reason from public.timetable_changes where reverts_change_id = ${cover.id}`;
      expect(log).toMatchObject({ kind: "rollback", action: "uncover", reason: `Rollback of: ${note}` });
      expect((await f.inst.clientAs("student").rpc("my_section_covers", { p_institution_id: id, p_date: date })).data).toEqual([]);
      expect((await f.inst.clientAs("student").from("timetable_changes").select("id").not("substitution_id", "is", null)).data).toEqual([]);
    } finally {
      await f.inst.cleanup();
    }
  });
});
