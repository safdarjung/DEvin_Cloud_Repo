import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { applyTimetableChanges, createTimetableSnapshot, restoreTimetableSnapshot } from "@/modules/timetable/control.actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createGrade, createSubject } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

// Curveballs: timetable snapshot create/restore (no prior action-level tests).
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function staffRow(institutionId: string, name: string): Promise<string> {
  const [row] = await sql`insert into public.staff (institution_id, employee_no, full_name, designation, is_teaching)
    values (${institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, ${name}, 'Teacher', true) returning id`;
  return row.id as string;
}

async function setup(name: string) {
  const inst = await createTestInstitution(name);
  const id = inst.institutionId;
  const yearId = await createAcademicYear(id);
  const gradeId = await createGrade(id);
  const sectionId = await createClassSection(id, gradeId, yearId, { name: "A" });
  const subjectId = await createSubject(id);
  const iyer = await staffRow(id, "Ms Iyer");
  const [p1] = await sql`insert into public.periods (institution_id, seq, name, starts_at, ends_at) values (${id}, 1, 'P1', '08:00', '08:45') returning id`;
  const [v] = await sql`insert into public.timetable_versions (institution_id, academic_year_id, name, created_by) values (${id}, ${yearId}, 'Draft', ${inst.users.admin.id}) returning id`;
  return { inst, sectionId, subjectId, iyer, periodId: p1.id as string, versionId: v.id as string };
}
type F = Awaited<ReturnType<typeof setup>>;
const put = (f: F, teacherId: string | null) => ({
  classSectionId: f.sectionId, weekday: 1, periodId: f.periodId,
  after: teacherId ? { subjectId: f.subjectId, teacherId } : null,
});
const slotCount = async (versionId: string) => (await sql`select 1 from public.timetable_slots where version_id=${versionId}`).length;

describe("timetable snapshots", () => {
  it("snapshot of an empty draft has 0 slots; name validation: blank, 61 chars, unknown key", async () => {
    const f = await setup("cb-tt-snap0");
    try {
      const empty = await callAs(f.inst, "admin", createTimetableSnapshot, { versionId: f.versionId, name: "Empty" });
      expect(empty.ok && empty.data.slotCount).toBe(0);
      for (const body of [{ name: "  " }, { name: "x".repeat(61) }, { name: "ok", extra: 1 }]) {
        const r = await callAs(f.inst, "admin", createTimetableSnapshot, { versionId: f.versionId, ...body } as never);
        expect(!r.ok && r.error.code).toBe("validation_failed");
      }
    } finally { await f.inst.cleanup(); }
  }, 60_000);

  it("restore brings back the snapshotted cells after later edits; restoring again is a no-op (applied 0)", async () => {
    const f = await setup("cb-tt-restore");
    try {
      expect((await callAs(f.inst, "admin", applyTimetableChanges, { versionId: f.versionId, kind: "manual", changes: [put(f, f.iyer)] })).ok).toBe(true);
      const snap = await callAs(f.inst, "admin", createTimetableSnapshot, { versionId: f.versionId, name: "With Iyer" });
      expect(snap.ok && snap.data.slotCount).toBe(1);
      if (!snap.ok) return;
      expect((await callAs(f.inst, "admin", applyTimetableChanges, { versionId: f.versionId, kind: "manual", changes: [put(f, null)] })).ok).toBe(true);
      expect(await slotCount(f.versionId)).toBe(0);
      const restored = await callAs(f.inst, "admin", restoreTimetableSnapshot, { snapshotId: snap.data.id });
      expect(restored.ok && restored.data.applied).toBe(1);
      expect(await slotCount(f.versionId)).toBe(1);
      const again = await callAs(f.inst, "admin", restoreTimetableSnapshot, { snapshotId: snap.data.id });
      expect(again.ok && again.data.applied).toBe(0);
    } finally { await f.inst.cleanup(); }
  }, 60_000);

  it("permissions and tenancy: teacher/guardian forbidden; another school's version/snapshot and random ids refused", async () => {
    const f = await setup("cb-tt-perm");
    const o = await setup("cb-tt-perm-x");
    try {
      for (const role of ["teacher", "guardian", "student", "accountant"] as const) {
        const r = await callAs(f.inst, role, createTimetableSnapshot, { versionId: f.versionId, name: "x" });
        expect(!r.ok && r.error.code, role).toBe("forbidden");
      }
      const foreignSnap = await callAs(o.inst, "admin", createTimetableSnapshot, { versionId: o.versionId, name: "theirs" });
      if (!foreignSnap.ok) throw new Error("setup");
      const cross = await callAs(f.inst, "admin", restoreTimetableSnapshot, { snapshotId: foreignSnap.data.id });
      expect(!cross.ok && cross.error.code).toBe("not_found");
      const rnd = await callAs(f.inst, "admin", restoreTimetableSnapshot, { snapshotId: crypto.randomUUID() });
      expect(!rnd.ok && rnd.error.code).toBe("not_found");
      const tr = await callAs(f.inst, "teacher", restoreTimetableSnapshot, { snapshotId: foreignSnap.data.id });
      expect(!tr.ok && tr.error.code).toBe("forbidden");
      const xv = await callAs(f.inst, "admin", createTimetableSnapshot, { versionId: o.versionId, name: "steal" });
      expect(xv.ok).toBe(false);
      expect((await sql`select 1 from public.timetable_snapshots where institution_id=${f.inst.institutionId}`).length).toBe(0);
    } finally { await f.inst.cleanup(); await o.inst.cleanup(); }
  }, 60_000);
});
