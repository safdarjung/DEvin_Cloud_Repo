import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

const dayOffset = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const FUTURE = dayOffset(3);
const FUTURE2 = dayOffset(4);
const PAST = dayOffset(-3);

async function fixture(inst: TestInstitution) {
  const id = inst.institutionId;
  const [year] = await sql`insert into public.academic_years (institution_id, name, starts_on, ends_on, is_current) values (${id}, 'AY', '2026-04-01', '2027-03-31', true) returning id`;
  const [grade] = await sql`insert into public.grades (institution_id, code, display_name, sort_key, grade_group) values (${id}, 'VI', 'Grade VI', 6, 'middle') returning id`;
  const [section] = await sql`insert into public.class_sections (institution_id, grade_id, academic_year_id, name) values (${id}, ${grade.id}, ${year.id}, 'A') returning id`;
  const [subject] = await sql`insert into public.subjects (institution_id, code, name, kind) values (${id}, 'SCI', 'Science', 'scholastic') returning id`;
  const periods = await sql`
    insert into public.periods (institution_id, seq, name, starts_at, ends_at)
    values (${id}, 1, 'P1', '08:00', '08:45'), (${id}, 2, 'P2', '08:45', '09:30') returning id`;
  const labs = await sql`
    insert into public.school_labs (institution_id, name, kind, capacity)
    values (${id}, 'Physics', 'science', 30), (${id}, 'Chemistry', 'science', 30) returning id, name`;
  const [otherStaff] = await sql`insert into public.staff (institution_id, employee_no, full_name, designation) values (${id}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, 'Other Teacher', 'teacher') returning id`;
  const [me] = await sql`select staff_id from public.memberships where institution_id = ${id} and user_id = ${inst.users.teacher.id}`;
  return {
    section: section.id as string,
    subject: subject.id as string,
    p1: periods[0].id as string,
    p2: periods[1].id as string,
    physics: labs.find((l) => l.name === "Physics")!.id as string,
    chem: labs.find((l) => l.name === "Chemistry")!.id as string,
    otherStaff: otherStaff.id as string,
    teacherStaff: me.staff_id as string,
  };
}

type F = Awaited<ReturnType<typeof fixture>>;
const book = (c: ReturnType<TestInstitution["clientAs"]>, f: F, o: { lab?: string; date?: string; period?: string; staff?: string } = {}) =>
  c.rpc("book_school_lab", {
    p_lab_id: o.lab ?? f.physics,
    p_class_section_id: f.section,
    p_subject_id: f.subject,
    p_date: o.date ?? FUTURE,
    p_period_id: o.period ?? f.p1,
    p_purpose: "Practical",
    p_staff_id: o.staff ?? null,
  });

describe("school labs (0126)", () => {
  it("refuses a double booking of a lab and a teacher in two labs in one period", async () => {
    const inst = await createTestInstitution("labs-conflict");
    try {
      const f = await fixture(inst);
      expect((await book(inst.clientAs("teacher"), f)).error).toBeNull();
      const dupLab = await book(inst.clientAs("admin"), f, { staff: f.otherStaff });
      expect(dupLab.error?.message).toMatch(/code:conflict/);
      const twoLabs = await book(inst.clientAs("teacher"), f, { lab: f.chem });
      expect(twoLabs.error?.message).toMatch(/code:conflict/);
      expect((await book(inst.clientAs("teacher"), f, { lab: f.chem, period: f.p2 })).error).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("refuses a past date", async () => {
    const inst = await createTestInstitution("labs-past");
    try {
      const f = await fixture(inst);
      const res = await book(inst.clientAs("admin"), f, { date: PAST });
      expect(res.error?.message).toMatch(/code:validation_failed|code:invalid_state/);
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher cannot book for another teacher or cancel another's booking; manager can cancel any", async () => {
    const inst = await createTestInstitution("labs-own");
    try {
      const f = await fixture(inst);
      const forOther = await book(inst.clientAs("teacher"), f, { staff: f.otherStaff });
      expect(forOther.error?.message).toMatch(/code:forbidden/);

      const adminBooking = await book(inst.clientAs("admin"), f, { staff: f.otherStaff, date: FUTURE2 });
      expect(adminBooking.error).toBeNull();
      const otherId = (adminBooking.data as { booking_id: string }).booking_id;
      const cancel = await inst.clientAs("teacher").rpc("cancel_school_lab_booking", { p_booking_id: otherId });
      expect(cancel.error?.message).toMatch(/code:forbidden/);

      const mine = await book(inst.clientAs("teacher"), f, { period: f.p2 });
      const mineId = (mine.data as { booking_id: string }).booking_id;
      expect((await inst.clientAs("teacher").rpc("cancel_school_lab_booking", { p_booking_id: mineId })).error).toBeNull();
      expect((await inst.clientAs("teacher").rpc("cancel_school_lab_booking", { p_booking_id: mineId })).error?.message).toMatch(/code:invalid_state/);
      expect((await inst.clientAs("principal").rpc("cancel_school_lab_booking", { p_booking_id: otherId })).error).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("denies accountant, student and guardian: rpc refused, no rows, no writes", async () => {
    const inst = await createTestInstitution("labs-deny");
    try {
      const f = await fixture(inst);
      for (const role of ["accountant", "student", "guardian"] as const) {
        const c = inst.clientAs(role);
        expect((await book(c, f)).error?.message, role).toMatch(/code:forbidden/);
        for (const t of ["school_labs", "school_lab_bookings", "school_lab_equipment", "school_lab_experiments", "school_lab_incidents"]) {
          expect((await c.from(t).select("id")).data ?? [], `${role} ${t}`).toHaveLength(0);
        }
        const ins = await c.from("school_labs").insert({ institution_id: inst.institutionId, name: "X", kind: "other", capacity: 5 });
        expect(ins.error, role).not.toBeNull();
      }
      expect((await inst.clientAs("teacher").from("school_labs").select("id")).data).toHaveLength(2);
      const tIns = await inst.clientAs("teacher").from("school_labs").insert({ institution_id: inst.institutionId, name: "X", kind: "other", capacity: 5 });
      expect(tIns.error).not.toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("incidents are append-only; teachers log only on their own booking", async () => {
    const inst = await createTestInstitution("labs-incident");
    try {
      const f = await fixture(inst);
      const mine = (await book(inst.clientAs("teacher"), f)).data as { booking_id: string };
      const theirs = (await book(inst.clientAs("admin"), f, { staff: f.otherStaff, date: FUTURE2 })).data as { booking_id: string };
      const t = inst.clientAs("teacher");
      const base = { institution_id: inst.institutionId, lab_id: f.physics, kind: "breakage", severity: "low", description: "Beaker", cost_paise: 5000 };

      expect((await t.from("school_lab_incidents").insert({ ...base, booking_id: theirs.booking_id })).error).not.toBeNull();
      expect((await t.from("school_lab_incidents").insert(base)).error).not.toBeNull(); // teacher must name a booking
      const ok = await t.from("school_lab_incidents").insert({ ...base, booking_id: mine.booking_id }).select("id").single();
      expect(ok.error).toBeNull();

      const admin = inst.clientAs("admin");
      const upd = await admin.from("school_lab_incidents").update({ description: "Changed" }).eq("id", ok.data!.id).select("id");
      expect(upd.data ?? []).toHaveLength(0);
      const del = await admin.from("school_lab_incidents").delete().eq("id", ok.data!.id).select("id");
      expect(del.data ?? []).toHaveLength(0);
      await expect(sql`update public.school_lab_incidents set description = 'x' where id = ${ok.data!.id}`).rejects.toThrow();
      await expect(sql`delete from public.school_lab_incidents where id = ${ok.data!.id}`).rejects.toThrow();
    } finally {
      await inst.cleanup();
    }
  });

  it("utilisation counts bookings per lab, zero rows included", async () => {
    const inst = await createTestInstitution("labs-util");
    try {
      const f = await fixture(inst);
      await book(inst.clientAs("admin"), f);
      const res = await inst.clientAs("principal").rpc("school_lab_utilisation", { p_institution_id: inst.institutionId, p_from: dayOffset(0), p_to: dayOffset(10) });
      expect(res.error).toBeNull();
      const byLab = new Map((res.data as { lab_id: string; bookings: number }[]).map((r) => [r.lab_id, Number(r.bookings)]));
      expect(byLab.get(f.physics)).toBe(1);
      expect(byLab.get(f.chem)).toBe(0);
    } finally {
      await inst.cleanup();
    }
  });

  it("cross-tenant: other institution's admin cannot book, cancel or read", async () => {
    await withTwoInstitutions(async (a, b) => {
      const f = await fixture(a);
      const booked = (await book(a.clientAs("admin"), f)).data as { booking_id: string };
      expect((await book(b.clientAs("admin"), f, { date: FUTURE2 })).error?.message).toMatch(/code:not_found/);
      expect((await b.clientAs("admin").rpc("cancel_school_lab_booking", { p_booking_id: booked.booking_id })).error?.message).toMatch(/code:not_found/);
      expect((await b.clientAs("admin").from("school_labs").select("id")).data ?? []).toHaveLength(0);
    });
  });
});
