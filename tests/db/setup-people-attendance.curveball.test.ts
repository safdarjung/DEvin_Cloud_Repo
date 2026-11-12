import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { setSubjectAssignment, upsertGrade, upsertSection, upsertSubject } from "@/modules/academics/setup.actions";
import { markPeriodAttendance } from "@/modules/attendance/actions";
import { issueCertificate } from "@/modules/certificates/actions";
import { updateStudent } from "@/modules/people/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createEnrolment, createGrade, createSubject } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

// Curveballs: academics setup, people.updateStudent, attendance.markPeriod, certificate.issue.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

const one = async (q: Promise<postgres.RowList<postgres.Row[]>>) => (await q)[0]!;
const studentOf = async (id: string) => (await one(sql`select student_id from public.memberships where institution_id=${id} and role='student'`)).student_id as string;

describe("academics setup", () => {
  it("update by foreign/random id is not_found for grade, section, subject and changes nothing", async () => {
    const inst = await createTestInstitution("cb-setup");
    const other = await createTestInstitution("cb-setupx");
    try {
      const og = await createGrade(other.institutionId, { code: "IX" });
      const oy = await createAcademicYear(other.institutionId);
      const os = await createClassSection(other.institutionId, og, oy, { name: "A" });
      const osub = await createSubject(other.institutionId, { code: "PHY", name: "Physics" });
      const g = await callAs(inst, "admin", upsertGrade, { id: og, code: "HACK", displayName: "Hack", sortKey: 1, gradeGroup: "x" });
      expect(!g.ok && g.error.code).toBe("not_found");
      const y = await createAcademicYear(inst.institutionId);
      const ig = await createGrade(inst.institutionId);
      const s = await callAs(inst, "admin", upsertSection, { id: os, gradeId: ig, academicYearId: y, name: "Hack" });
      expect(!s.ok && s.error.code).toBe("not_found");
      const sub = await callAs(inst, "admin", upsertSubject, { id: osub, code: "HACK", name: "Hack", kind: "scholastic" });
      expect(!sub.ok && sub.error.code).toBe("not_found");
      expect((await one(sql`select code from public.grades where id=${og}`)).code).toBe("IX");
      expect((await one(sql`select name from public.class_sections where id=${os}`)).name).toBe("A");
      expect((await one(sql`select code from public.subjects where id=${osub}`)).code).toBe("PHY");
    } finally { await inst.cleanup(); await other.cleanup(); }
  }, 60_000);

  it("validation: bad subject kind, blank code, fractional sortKey, capacity 0/-1, unknown key; duplicate grade code conflict", async () => {
    const inst = await createTestInstitution("cb-setup2");
    try {
      const y = await createAcademicYear(inst.institutionId);
      const g = await createGrade(inst.institutionId, { code: "V" });
      const k = await callAs(inst, "admin", upsertSubject, { code: "X", name: "X", kind: "optional" } as never);
      expect(!k.ok && k.error.code).toBe("validation_failed");
      const blank = await callAs(inst, "admin", upsertGrade, { code: " ", displayName: "x", sortKey: 1, gradeGroup: "g" });
      expect(!blank.ok && blank.error.code).toBe("validation_failed");
      const frac = await callAs(inst, "admin", upsertGrade, { code: "Q", displayName: "x", sortKey: 1.5, gradeGroup: "g" });
      expect(!frac.ok && frac.error.code).toBe("validation_failed");
      for (const capacity of [0, -1]) {
        const r = await callAs(inst, "admin", upsertSection, { gradeId: g, academicYearId: y, name: "A", capacity });
        expect(!r.ok && r.error.code, String(capacity)).toBe("validation_failed");
      }
      const extra = await callAs(inst, "admin", upsertGrade, { code: "Q", displayName: "x", sortKey: 1, gradeGroup: "g", institutionId: crypto.randomUUID() } as never);
      expect(!extra.ok && extra.error.code).toBe("validation_failed");
      const dup = await callAs(inst, "admin", upsertGrade, { code: "V", displayName: "Five", sortKey: 5, gradeGroup: "g" });
      expect(!dup.ok && dup.error.code).toBe("conflict");
      if (!dup.ok) expect(dup.error.fieldErrors?.code).toBeDefined();
    } finally { await inst.cleanup(); }
  }, 60_000);

  it("section: foreign grade / year / class teacher are refused and no row is created", async () => {
    const inst = await createTestInstitution("cb-setup3");
    const other = await createTestInstitution("cb-setup3x");
    try {
      const y = await createAcademicYear(inst.institutionId);
      const g = await createGrade(inst.institutionId);
      const og = await createGrade(other.institutionId);
      const oy = await createAcademicYear(other.institutionId);
      const oStaff = (await one(sql`select staff_id from public.memberships where institution_id=${other.institutionId} and role='teacher'`)).staff_id as string;
      for (const [name, body] of Object.entries({
        grade: { gradeId: og, academicYearId: y },
        year: { gradeId: g, academicYearId: oy },
        teacher: { gradeId: g, academicYearId: y, classTeacherId: oStaff },
      })) {
        const r = await callAs(inst, "admin", upsertSection, { name: "A", ...body });
        expect(r.ok, name).toBe(false);
      }
      expect((await sql`select 1 from public.class_sections where institution_id=${inst.institutionId}`).length).toBe(0);
    } finally { await inst.cleanup(); await other.cleanup(); }
  }, 60_000);

  it("shrinking a section's capacity below its enrolled count is refused", async () => {
    const inst = await createTestInstitution("cb-setup4");
    try {
      const y = await createAcademicYear(inst.institutionId);
      const g = await createGrade(inst.institutionId);
      const sec = await createClassSection(inst.institutionId, g, y, { name: "A" });
      await sql`update public.class_sections set capacity = 40 where id=${sec}`;
      await createEnrolment(inst.institutionId, await studentOf(inst.institutionId), sec, y, { rollNo: 1 });
      const extra = (await one(sql`insert into public.students (institution_id, admission_no, first_name, dob, gender) values (${inst.institutionId}, 'ADM-CAP2', 'B', '2014-01-01', 'other') returning id`)).id as string;
      await createEnrolment(inst.institutionId, extra, sec, y, { rollNo: 2 });
      const r = await callAs(inst, "admin", upsertSection, { id: sec, gradeId: g, academicYearId: y, name: "A", capacity: 1 });
      expect(r.ok).toBe(false);
    } finally { await inst.cleanup(); }
  }, 60_000);

  it("setSubjectAssignment: foreign section/subject/teacher not_found; duplicate is conflict; teacher forbidden", async () => {
    const inst = await createTestInstitution("cb-setup5");
    const other = await createTestInstitution("cb-setup5x");
    try {
      const y = await createAcademicYear(inst.institutionId);
      const g = await createGrade(inst.institutionId);
      const sec = await createClassSection(inst.institutionId, g, y, { name: "A" });
      const sub = await createSubject(inst.institutionId);
      const t = (await one(sql`select staff_id from public.memberships where institution_id=${inst.institutionId} and role='teacher'`)).staff_id as string;
      const oy = await createAcademicYear(other.institutionId);
      const og = await createGrade(other.institutionId);
      const osec = await createClassSection(other.institutionId, og, oy, { name: "A" });
      const osub = await createSubject(other.institutionId);
      const ot = (await one(sql`select staff_id from public.memberships where institution_id=${other.institutionId} and role='teacher'`)).staff_id as string;
      for (const [name, body] of Object.entries({
        sec: { classSectionId: osec, subjectId: sub, teacherId: t },
        sub: { classSectionId: sec, subjectId: osub, teacherId: t },
        t: { classSectionId: sec, subjectId: sub, teacherId: ot },
      })) {
        const r = await callAs(inst, "admin", setSubjectAssignment, body);
        expect(!r.ok && r.error.code, name).toBe("not_found");
      }
      expect((await callAs(inst, "admin", setSubjectAssignment, { classSectionId: sec, subjectId: sub, teacherId: t })).ok).toBe(true);
      const dup = await callAs(inst, "admin", setSubjectAssignment, { classSectionId: sec, subjectId: sub, teacherId: t });
      expect(!dup.ok && dup.error.code).toBe("conflict");
      const tr = await callAs(inst, "teacher", setSubjectAssignment, { classSectionId: sec, subjectId: sub, teacherId: t });
      expect(!tr.ok && tr.error.code).toBe("forbidden");
      expect((await sql`select 1 from public.subject_assignments where institution_id=${other.institutionId}`).length).toBe(0);
    } finally { await inst.cleanup(); await other.cleanup(); }
  }, 60_000);
});

describe("people.updateStudent", () => {
  it("empty patch, future dob, bad gender and blank names fail validation; ", async () => {
    const inst = await createTestInstitution("cb-ppl");
    try {
      const s = await studentOf(inst.institutionId);
      for (const [name, body] of Object.entries({ empty: {}, gender: { gender: "x" }, blank: { firstName: " " }, date: { dob: "2015-02-31" }, extra: { firstName: "A", status: "active" } })) {
        const r = await callAs(inst, "admissions", updateStudent, { studentId: s, ...body } as never);
        expect(!r.ok && r.error.code, name).toBe("validation_failed");
      }
    } finally { await inst.cleanup(); }
  }, 60_000);

  it("updateStudent refuses a date of birth in the future", async () => {
    const inst = await createTestInstitution("cb-ppl2");
    try {
      const r = await callAs(inst, "admissions", updateStudent, { studentId: await studentOf(inst.institutionId), dob: "2999-01-01" });
      expect(r.ok).toBe(false);
    } finally { await inst.cleanup(); }
  }, 60_000);
});

describe("attendance.markPeriod / certificate.issue", () => {
  async function base(name: string) {
    const inst = await createTestInstitution(name);
    await sql`update public.institutions set settings = settings || jsonb_build_object('attendance', jsonb_build_object('mode','daily','correction_window_days',3,
      'statuses', ${sql.json([{ code: "P", label: "Present", counts_present: 1, in_denominator: true }, { code: "A", label: "Absent", counts_present: 0, in_denominator: true, notify_guardian: true }])}::jsonb,
      'alert_thresholds', jsonb_build_object('warn',80,'critical',75))) where id=${inst.institutionId}`;
    const y = await createAcademicYear(inst.institutionId);
    const g = await createGrade(inst.institutionId);
    const t = (await one(sql`select staff_id from public.memberships where institution_id=${inst.institutionId} and role='teacher'`)).staff_id as string;
    const sec = await createClassSection(inst.institutionId, g, y, { name: "A", classTeacherId: t });
    const s = await studentOf(inst.institutionId);
    await createEnrolment(inst.institutionId, s, sec, y, { rollNo: 1 });
    const p = (await one(sql`insert into public.periods (institution_id, seq, name, starts_at, ends_at) values (${inst.institutionId}, 1, 'P1', '08:00', '08:45') returning id`)).id as string;
    return { inst, sec, s, p };
  }
  const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

  it("duplicate student rows, empty records, unknown status and a student outside the section are refused with nothing written", async () => {
    const b = await base("cb-att");
    try {
      const mk = (records: unknown[]) => callAs(b.inst, "teacher", markPeriodAttendance, { classSectionId: b.sec, periodId: b.p, date: today(), records } as never);
      const dup = await mk([{ studentId: b.s, status: "P" }, { studentId: b.s, status: "A" }]);
      expect(dup.ok).toBe(false);
      expect((await mk([])).ok).toBe(false);
      const unknown = await mk([{ studentId: b.s, status: "teleported" }]);
      expect(!unknown.ok && unknown.error.code).toBe("validation_failed");
      const stray = (await one(sql`insert into public.students (institution_id, admission_no, first_name, dob, gender) values (${b.inst.institutionId}, 'ADM-STRAY', 'S', '2014-01-01', 'other') returning id`)).id as string;
      const out = await mk([{ studentId: stray, status: "P" }]);
      expect(out.ok).toBe(false);
      expect((await sql`select 1 from public.attendance_records where institution_id=${b.inst.institutionId}`).length).toBe(0);
    } finally { await b.inst.cleanup(); }
  }, 60_000);

  it("period attendance for a foreign period / random section is refused", async () => {
    const b = await base("cb-att2");
    const o = await base("cb-att2x");
    try {
      const foreignPeriod = await callAs(b.inst, "teacher", markPeriodAttendance, { classSectionId: b.sec, periodId: o.p, date: today(), records: [{ studentId: b.s, status: "P" }] });
      expect(foreignPeriod.ok).toBe(false);
      const foreignSec = await callAs(b.inst, "admin", markPeriodAttendance, { classSectionId: o.sec, periodId: b.p, date: today(), records: [{ studentId: o.s, status: "P" }] });
      expect(foreignSec.ok).toBe(false);
    } finally { await b.inst.cleanup(); await o.inst.cleanup(); }
  }, 60_000);

  it("certificates: foreign / random student not_found; short purpose and unknown kind fail validation; no serial consumed on failure", async () => {
    const inst = await createTestInstitution("cb-cert");
    const other = await createTestInstitution("cb-certx");
    try {
      const yy = await createAcademicYear(inst.institutionId);
      const gg = await createGrade(inst.institutionId);
      const ss = await createClassSection(inst.institutionId, gg, yy, { name: "A" });
      await createEnrolment(inst.institutionId, await studentOf(inst.institutionId), ss, yy, { rollNo: 1 });
      const foreign = await callAs(inst, "admissions", issueCertificate, { kind: "bonafide", studentId: await studentOf(other.institutionId), purpose: "Bank account" });
      expect(!foreign.ok && foreign.error.code).toMatch(/^(not_found|forbidden)$/);
      const rnd = await callAs(inst, "admissions", issueCertificate, { kind: "bonafide", studentId: crypto.randomUUID(), purpose: "Bank account" });
      expect(!rnd.ok && rnd.error.code).toBe("not_found");
      for (const body of [{ kind: "bonafide", purpose: "ab" }, { kind: "diploma", purpose: "Bank account" }, { kind: "bonafide", purpose: "Bank account", conduct: "good" }]) {
        const r = await callAs(inst, "admissions", issueCertificate, { studentId: await studentOf(inst.institutionId), ...body } as never);
        expect(!r.ok && r.error.code).toBe("validation_failed");
      }
      expect((await sql`select 1 from public.certificates where institution_id in (${inst.institutionId}, ${other.institutionId})`).length).toBe(0);
      const first = await callAs(inst, "admissions", issueCertificate, { kind: "bonafide", studentId: await studentOf(inst.institutionId), purpose: "Bank account" });
      expect(first.ok ? first.data.serialNo : JSON.stringify(first.error)).toMatch(/00001$/);
    } finally { await inst.cleanup(); await other.cleanup(); }
  }, 60_000);
});
