// Curveball sweep (school-labs): action-level coverage for all 9 actions — role gates, cross-tenant ids,
// Zod fieldErrors, parallel double booking, cancel twice, experiments on cancelled bookings.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import {
  bookLab,
  cancelBooking,
  completeExperiment,
  createEquipment,
  createLab,
  logExperiment,
  recordIncident,
  updateEquipment,
  updateLab,
} from "@/modules/school-labs/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const dayOffset = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

let a: TestInstitution;
let b: TestInstitution;
type F = Awaited<ReturnType<typeof fixture>>;
let fa: F;
let fb: F;

async function fixture(inst: TestInstitution) {
  const id = inst.institutionId;
  const [year] = await sql`insert into public.academic_years (institution_id, name, starts_on, ends_on, is_current) values (${id}, 'AY', '2026-04-01', '2027-03-31', true) returning id`;
  const [grade] = await sql`insert into public.grades (institution_id, code, display_name, sort_key, grade_group) values (${id}, 'VI', 'Grade VI', 6, 'middle') returning id`;
  const [section] = await sql`insert into public.class_sections (institution_id, grade_id, academic_year_id, name) values (${id}, ${grade.id}, ${year.id}, 'A') returning id`;
  const [subject] = await sql`insert into public.subjects (institution_id, code, name, kind) values (${id}, 'SCI', 'Science', 'scholastic') returning id`;
  const periods = await sql`
    insert into public.periods (institution_id, seq, name, starts_at, ends_at)
    values (${id}, 1, 'P1', '08:00', '08:45'), (${id}, 2, 'P2', '08:45', '09:30'), (${id}, 3, 'P3', '09:30', '10:15') returning id`;
  const [lab] = await sql`insert into public.school_labs (institution_id, name, kind, capacity) values (${id}, 'Physics', 'science', 30) returning id`;
  return { section: section.id as string, subject: subject.id as string, periods: periods.map((p) => p.id as string), lab: lab.id as string };
}

const booking = (f: F, o: { day?: number; period?: number; lab?: string } = {}) => ({
  labId: o.lab ?? f.lab,
  classSectionId: f.section,
  subjectId: f.subject,
  date: dayOffset(o.day ?? 3),
  periodId: f.periods[o.period ?? 0],
  purpose: "Practical",
});
let dayCounter = 10;
const nextDay = () => dayCounter++;

beforeAll(async () => {
  a = await createTestInstitution("labs-cb");
  b = await createTestInstitution("labs-cb-x");
  fa = await fixture(a);
  fb = await fixture(b);
}, 60_000);

afterAll(async () => {
  await a?.cleanup();
  await b?.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

describe("labs + equipment", () => {
  it("create/update lab validation edges → validation_failed with fieldErrors", async () => {
    const r1 = await callAs(a, "admin", createLab, { name: "Bio", kind: "biology", capacity: 10 });
    expect(r1.ok ? null : r1.error.fieldErrors?.kind).toBeTruthy();
    const r2 = await callAs(a, "admin", createLab, { name: "Bio", kind: "science", capacity: 0 });
    expect(r2.ok ? null : r2.error.fieldErrors?.capacity).toBeTruthy();
    const r3 = await callAs(a, "admin", updateLab, { id: fa.lab, name: "", kind: "science", capacity: 10, isActive: true });
    expect(r3.ok ? null : r3.error.fieldErrors?.name).toBeTruthy();
  });

  it("teacher and accountant cannot manage labs or equipment; guardian cannot book", async () => {
    for (const role of ["teacher", "accountant"] as const) {
      const rs = [
        await callAs(a, role, createLab, { name: "Hack", kind: "science", capacity: 5 }),
        await callAs(a, role, updateLab, { id: fa.lab, name: "Hack", kind: "science", capacity: 5, isActive: true }),
        await callAs(a, role, createEquipment, { labId: fa.lab, name: "Beaker", kind: "equipment", quantity: 1, unit: "pc", hazardClass: null, expiryOn: null, condition: "good" }),
      ];
      expect(rs.map((r) => (r.ok ? "ok" : r.error.code))).toEqual(["forbidden", "forbidden", "forbidden"]);
    }
    const g = await callAs(a, "guardian", bookLab, booking(fa, { day: nextDay() }));
    expect(g.ok ? null : g.error.code).toBe("forbidden");
  });

  it("another school's lab: update → not_found; equipment into it → refused, not internal", async () => {
    const u = await callAs(a, "admin", updateLab, { id: fb.lab, name: "Mine now", kind: "science", capacity: 5, isActive: true });
    expect(u.ok ? null : u.error.code).toBe("not_found");
    const e = await callAs(a, "admin", createEquipment, { labId: fb.lab, name: "Beaker", kind: "equipment", quantity: 1, unit: "pc", hazardClass: null, expiryOn: null, condition: "good" });
    expect(e.ok).toBe(false);
    expect(e.ok ? null : e.error.code).not.toBe("internal");
    const [c] = await sql`select count(*)::int as n from public.school_lab_equipment where lab_id = ${fb.lab}`;
    expect(c.n).toBe(0);
  });

  it("equipment quantity edges: negative and 4 decimals refused", async () => {
    const base = { labId: fa.lab, name: "HCl", kind: "chemical", unit: "L", hazardClass: "corrosive", expiryOn: null, condition: "good" };
    const neg = await callAs(a, "admin", createEquipment, { ...base, quantity: -1 });
    expect(neg.ok ? null : neg.error.fieldErrors?.quantity).toBeTruthy();
    const fine = await callAs(a, "admin", createEquipment, { ...base, quantity: 1.2345 });
    expect(fine.ok ? null : fine.error.fieldErrors?.quantity).toBeTruthy();
  });

  // Regression (fixed): Audit action names are camelCase ("schoolLabs.*"); app.audit_event requires ^[a-z_]+(\.[a-z_]+)+$, so every
  // audited labs action fails AFTER its write has committed: the caller sees validation_failed but the row exists.
  it("every audited labs write (lab, equipment, experiment, incident) returns ok", async () => {
    const lab = await callAs(a, "admin", createLab, { name: "Bio", kind: "science", capacity: 20 });
    const labUpd = await callAs(a, "admin", updateLab, { id: fa.lab, name: "Physics", kind: "science", capacity: 31, isActive: true });
    const eq = await callAs(a, "admin", createEquipment, { labId: fa.lab, name: "HCl", kind: "chemical", quantity: 0.125, unit: "L", hazardClass: "corrosive", expiryOn: null, condition: "good" });
    const bk = await callAs(a, "admin", bookLab, booking(fa, { day: nextDay() }));
    if (!bk.ok) throw new Error(bk.error.code);
    const exp = await callAs(a, "admin", logExperiment, { bookingId: bk.data.bookingId, title: "Ohm's law" });
    const inc = await callAs(a, "admin", recordIncident, { labId: fa.lab, kind: "breakage", severity: "low", description: "Beaker broke", cost: "250.5" });
    expect([lab, labUpd, eq, exp, inc].map((r) => (r.ok ? "ok" : r.error.code))).toEqual(["ok", "ok", "ok", "ok", "ok"]);
  });

  it("a write reported as failed must not be left behind (no orphan row after a non-ok result)", async () => {
    const name = `Orphan ${crypto.randomUUID().slice(0, 8)}`;
    const r = await callAs(a, "admin", createLab, { name, kind: "other", capacity: 5 });
    const [c] = await sql`select count(*)::int as n from public.school_labs where institution_id = ${a.institutionId} and name = ${name}`;
    expect(r.ok || c.n === 0).toBe(true);
  });

  it("updating equipment: unknown id → not_found; moving it into another school's lab → refused", async () => {
    const base = { name: "Scale", kind: "equipment", quantity: 1, unit: "pc", hazardClass: null, expiryOn: null, condition: "good" };
    const unknown = await callAs(a, "admin", updateEquipment, { id: crypto.randomUUID(), labId: fa.lab, ...base });
    expect(unknown.ok ? null : unknown.error.code).toBe("not_found");
    const [made] = await sql`
      insert into public.school_lab_equipment (institution_id, lab_id, name, kind, quantity, unit)
      values (${a.institutionId}, ${fa.lab}, 'Scale', 'equipment', 1, 'pc') returning id
    `;
    const moved = await callAs(a, "admin", updateEquipment, { id: made.id as string, labId: fb.lab, ...base });
    expect(moved.ok).toBe(false);
    const [row] = await sql`select lab_id from public.school_lab_equipment where id = ${made.id}`;
    expect(row.lab_id).toBe(fa.lab);
  });
});

describe("bookings + experiments + incidents", () => {
  it("two parallel bookings of one lab/period: exactly one wins, the other is conflict", async () => {
    const day = nextDay();
    const rs = await Promise.all([callAs(a, "admin", bookLab, booking(fa, { day })), callAs(a, "principal", bookLab, booking(fa, { day }))]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    const loser = rs.find((r) => !r.ok);
    expect(loser && !loser.ok ? loser.error.code : null).toBe("conflict");
  });

  it("booking with another school's section/period/lab is refused, not internal", async () => {
    const r = await callAs(a, "admin", bookLab, { ...booking(fa, { day: nextDay() }), labId: fb.lab });
    expect(r.ok).toBe(false);
    expect(r.ok ? null : r.error.code).not.toBe("internal");
    const s = await callAs(a, "admin", bookLab, { ...booking(fa, { day: nextDay() }), classSectionId: fb.section });
    expect(s.ok).toBe(false);
    expect(s.ok ? null : s.error.code).not.toBe("internal");
  });

  it("bad date → validation_failed on date", async () => {
    const r = await callAs(a, "admin", bookLab, { ...booking(fa), date: "2026-02-30" });
    expect(r.ok ? null : r.error.fieldErrors?.date).toBeTruthy();
  });

  it("cancel twice → second refused (invalid_state); unknown → not_found; another school's booking → not_found", async () => {
    const bk = await callAs(a, "teacher", bookLab, booking(fa, { day: nextDay() }));
    if (!bk.ok) throw new Error(bk.error.code);
    expect((await callAs(a, "teacher", cancelBooking, { bookingId: bk.data.bookingId })).ok).toBe(true);
    const again = await callAs(a, "teacher", cancelBooking, { bookingId: bk.data.bookingId });
    expect(again.ok ? null : again.error.code).toBe("invalid_state");
    const unknown = await callAs(a, "admin", cancelBooking, { bookingId: crypto.randomUUID() });
    expect(unknown.ok ? null : unknown.error.code).toBe("not_found");
    const theirs = await callAs(b, "admin", bookLab, booking(fb, { day: nextDay() }));
    if (!theirs.ok) throw new Error(theirs.error.code);
    const cross = await callAs(a, "admin", cancelBooking, { bookingId: theirs.data.bookingId });
    expect(cross.ok ? null : cross.error.code).toBe("not_found");
  });

  it("teacher cannot log an experiment on a cancelled booking or another school's booking", async () => {
    const bk = await callAs(a, "teacher", bookLab, booking(fa, { day: nextDay() }));
    if (!bk.ok) throw new Error(bk.error.code);
    expect((await callAs(a, "teacher", cancelBooking, { bookingId: bk.data.bookingId })).ok).toBe(true);
    const onCancelled = await callAs(a, "teacher", logExperiment, { bookingId: bk.data.bookingId, title: "Ohm's law" });
    expect(onCancelled.ok).toBe(false);
    expect(onCancelled.ok ? null : onCancelled.error.code).not.toBe("internal");
    const theirs = await callAs(b, "admin", bookLab, booking(fb, { day: nextDay() }));
    if (!theirs.ok) throw new Error(theirs.error.code);
    const cross = await callAs(a, "admin", logExperiment, { bookingId: theirs.data.bookingId, title: "Ohm's law" });
    expect(cross.ok).toBe(false);
    expect(cross.ok ? null : cross.error.code).not.toBe("internal");
    const [c] = await sql`select count(*)::int as n from public.school_lab_experiments where booking_id in (${bk.data.bookingId}, ${theirs.data.bookingId})`;
    expect(c.n).toBe(0);
  });

  it("complete an unknown or another school's experiment → not_found", async () => {
    const unknown = await callAs(a, "admin", completeExperiment, { id: crypto.randomUUID(), completed: true });
    expect(unknown.ok ? null : unknown.error.code).toBe("not_found");
    const theirs = await callAs(b, "admin", bookLab, booking(fb, { day: nextDay() }));
    if (!theirs.ok) throw new Error(theirs.error.code);
    const [exp] = await sql`
      insert into public.school_lab_experiments (institution_id, booking_id, title, recorded_by)
      values (${b.institutionId}, ${theirs.data.bookingId}, 'Titration', ${b.users.admin.id}) returning id
    `;
    const cross = await callAs(a, "admin", completeExperiment, { id: exp.id as string, completed: true });
    expect(cross.ok ? null : cross.error.code).toBe("not_found");
  });

  it.each([["-5"], ["10.001"], ["1,000"], ["abc"]])("incident cost %j → validation_failed on cost", async (cost) => {
    const r = await callAs(a, "admin", recordIncident, { labId: fa.lab, kind: "breakage", severity: "low", description: "Beaker broke", cost });
    expect(r.ok ? null : r.error.fieldErrors?.cost).toBeTruthy();
  });

  it("incident on another school's lab is refused, not internal; cost '250.5' lands as 25050 paise", async () => {
    await callAs(a, "admin", recordIncident, { labId: fa.lab, kind: "breakage", severity: "low", description: "Cost probe 25050", cost: "250.5" });
    const [row] = await sql`select cost_paise from public.school_lab_incidents where institution_id = ${a.institutionId} and description = 'Cost probe 25050'`;
    expect(Number(row.cost_paise)).toBe(25050);
    const cross = await callAs(a, "admin", recordIncident, { labId: fb.lab, kind: "safety", severity: "high", description: "Spill" });
    expect(cross.ok).toBe(false);
    expect(cross.ok ? null : cross.error.code).not.toBe("internal");
  });
});
