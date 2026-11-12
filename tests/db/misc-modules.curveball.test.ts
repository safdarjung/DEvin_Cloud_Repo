import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { cancelClubEvent, createClub, createClubEvent, createHouse, awardHousePoints, updateClub } from "@/modules/clubs/actions";
import { promote, transfer, withdraw } from "@/modules/lifecycle/actions";
import { archiveQuestion, createQuestion, updateQuestion } from "@/modules/question-bank/actions";
import { logIncident } from "@/modules/behaviour/actions";
import { recordAchievement } from "@/modules/achievements/actions";
import { deleteDocument } from "@/modules/documents/actions";
import { updateAlumniProfile } from "@/modules/alumni/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createEnrolment, createGrade, createSubject } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

// Curveballs: clubs, lifecycle, question-bank, behaviour, achievements, documents, alumni.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

const one = async (q: Promise<postgres.RowList<postgres.Row[]>>) => (await q)[0]!;
const studentOf = async (id: string) => (await one(sql`select student_id from public.memberships where institution_id=${id} and role='student'`)).student_id as string;
const future = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

describe("clubs", () => {
  it("cancel event: unknown and other-school ids are not_found, nothing changes", async () => {
    const inst = await createTestInstitution("cb-club-cancel");
    const other = await createTestInstitution("cb-club-cancelx");
    try {
      const club = await callAs(inst, "admin", createClub, { name: "Chess" });
      if (!club.ok) throw new Error("club");
      const ev = await callAs(inst, "admin", createClubEvent, { clubId: club.data.id, title: "Match", startsAt: future(48) });
      if (!ev.ok) throw new Error("event");
      expect((await callAs(inst, "admin", cancelClubEvent, { id: ev.data.id })).ok).toBe(true);
      const oclub = await callAs(other, "admin", createClub, { name: "Theirs" });
      if (!oclub.ok) throw new Error("oclub");
      const oev = await callAs(other, "admin", createClubEvent, { clubId: oclub.data.id, title: "T", startsAt: future(48) });
      if (!oev.ok) throw new Error("oev");
      const cross = await callAs(inst, "admin", cancelClubEvent, { id: oev.data.id });
      expect(!cross.ok && cross.error.code).toBe("not_found");
      const rnd = await callAs(inst, "admin", cancelClubEvent, { id: crypto.randomUUID() });
      expect(!rnd.ok && rnd.error.code).toBe("not_found");
    } finally { await inst.cleanup(); await other.cleanup(); }
  }, 60_000);

  it("event validation: end<=start, signup closing after start, past start; club in another school; blank name; empty update", async () => {
    const inst = await createTestInstitution("cb-club-val");
    const other = await createTestInstitution("cb-club-valx");
    try {
      const club = await callAs(inst, "admin", createClub, { name: "Art" });
      const oclub = await callAs(other, "admin", createClub, { name: "Art" });
      if (!club.ok || !oclub.ok) throw new Error("setup");
      const base = { clubId: club.data.id, title: "E", startsAt: future(48) };
      for (const [name, o] of Object.entries({ endBefore: { endsAt: future(24) }, signupLate: { signupClosesAt: future(72) } })) {
        const r = await callAs(inst, "admin", createClubEvent, { ...base, ...o });
        expect(r.ok, name).toBe(false);
      }
      const foreign = await callAs(inst, "admin", createClubEvent, { ...base, clubId: oclub.data.id });
      expect(!foreign.ok && foreign.error.code).toBe("not_found");
      const blank = await callAs(inst, "admin", createClub, { name: "  " });
      expect(!blank.ok && blank.error.code).toBe("validation_failed");
      const empty = await callAs(inst, "admin", updateClub, { id: club.data.id });
      expect(!empty.ok && empty.error.code).toBe("validation_failed");
      const dup = await callAs(inst, "admin", createClub, { name: "Art" });
      expect(!dup.ok && dup.error.code).toBe("conflict");
      expect((await sql`select 1 from public.club_events where institution_id=${inst.institutionId}`).length).toBe(0);
    } finally { await inst.cleanup(); await other.cleanup(); }
  }, 60_000);

  it("house points: 0 and 101 invalid; foreign house refused; student not in the house is refused", async () => {
    const inst = await createTestInstitution("cb-house");
    const other = await createTestInstitution("cb-housex");
    try {
      const house = await callAs(inst, "admin", createHouse, { name: "Red", colour: "#FF0000" });
      const ohouse = await callAs(other, "admin", createHouse, { name: "Red" });
      if (!house.ok || !ohouse.ok) throw new Error("setup");
      for (const points of [0, 101, -101, 1.5]) {
        const r = await callAs(inst, "admin", awardHousePoints, { houseId: house.data.id, points, reason: "x" });
        expect(!r.ok && r.error.code, String(points)).toBe("validation_failed");
      }
      const bad = await callAs(inst, "admin", createHouse, { name: "Blue", colour: "blue" });
      expect(!bad.ok && bad.error.code).toBe("validation_failed");
      const foreign = await callAs(inst, "admin", awardHousePoints, { houseId: ohouse.data.id, points: 5, reason: "x" });
      expect(foreign.ok).toBe(false);
      const stray = await callAs(inst, "admin", awardHousePoints, { houseId: house.data.id, points: 5, reason: "x", studentId: await studentOf(inst.institutionId) });
      expect(stray.ok).toBe(false);
      expect((await sql`select 1 from public.house_points where institution_id in (${inst.institutionId}, ${other.institutionId})`).length).toBe(0);
    } finally { await inst.cleanup(); await other.cleanup(); }
  }, 60_000);
});

describe("clubs BUG probes", () => {
  it("cancelling an already-cancelled event is invalid_state and writes no second audit row", async () => {
    const inst = await createTestInstitution("cb-club-cancel2");
    try {
      const club = await callAs(inst, "admin", createClub, { name: "Chess" });
      if (!club.ok) throw new Error("club");
      const ev = await callAs(inst, "admin", createClubEvent, { clubId: club.data.id, title: "Match", startsAt: future(48) });
      if (!ev.ok) throw new Error("event");
      expect((await callAs(inst, "admin", cancelClubEvent, { id: ev.data.id })).ok).toBe(true);
      const again = await callAs(inst, "admin", cancelClubEvent, { id: ev.data.id });
      expect(!again.ok && again.error.code).toBe("invalid_state");
      expect((await sql`select 1 from public.audit_events where institution_id=${inst.institutionId} and action='club.event.cancelled'`).length).toBe(1);
    } finally { await inst.cleanup(); }
  }, 60_000);
});

describe("lifecycle", () => {
  it("withdraw/transfer: foreign or random student not_found; transfer then withdraw is invalid_state; reason/destination too short -> fieldErrors", async () => {
    const inst = await createTestInstitution("cb-lc");
    const other = await createTestInstitution("cb-lcx");
    try {
      const s = await studentOf(inst.institutionId);
      const foreign = await studentOf(other.institutionId);
      const x = await callAs(inst, "admin", withdraw, { studentId: foreign, reason: "Relocating abroad" });
      expect(!x.ok && x.error.code).toMatch(/^(forbidden|not_found)$/);
      const rnd = await callAs(inst, "admin", withdraw, { studentId: crypto.randomUUID(), reason: "Relocating abroad" });
      expect(!rnd.ok && rnd.error.code).toBe("not_found");
      expect((await one(sql`select status from public.students where id=${foreign}`)).status).not.toBe("withdrawn");
      const short = await callAs(inst, "admin", transfer, { studentId: s, reason: "ab", destinationSchool: "X" });
      expect(!short.ok && short.error.code).toBe("validation_failed");
      if (!short.ok) expect(Object.keys(short.error.fieldErrors ?? {}).sort()).toEqual(["destinationSchool", "reason"]);
      expect((await callAs(inst, "admin", transfer, { studentId: s, reason: "Moving cities", destinationSchool: "Delhi Public" })).ok).toBe(true);
      const after = await callAs(inst, "admin", withdraw, { studentId: s, reason: "Moving cities" });
      expect(!after.ok && after.error.code).toBe("invalid_state");
      const t2 = await callAs(inst, "admin", transfer, { studentId: s, reason: "Moving cities", destinationSchool: "Delhi Public" });
      expect(!t2.ok && t2.error.code).toBe("invalid_state");
      const future = await callAs(inst, "admin", withdraw, { studentId: s, reason: "Moving cities", leftOn: "2999-01-01" });
      expect(future.ok).toBe(false);
    } finally { await inst.cleanup(); await other.cleanup(); }
  }, 60_000);

  it("promote: same from/to year, foreign sections, and a withdrawn student are not promoted; no enrolment rows change on refusal", async () => {
    const inst = await createTestInstitution("cb-promo");
    const other = await createTestInstitution("cb-promox");
    try {
      const y1 = await createAcademicYear(inst.institutionId, { name: "A", startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: false });
      const y2 = await createAcademicYear(inst.institutionId, { name: "B", startsOn: "2027-04-01", endsOn: "2028-03-31", isCurrent: true });
      const g = await createGrade(inst.institutionId);
      const from = await createClassSection(inst.institutionId, g, y1, { name: "A" });
      const to = await createClassSection(inst.institutionId, g, y2, { name: "A2" });
      const oy = await createAcademicYear(other.institutionId);
      const og = await createGrade(other.institutionId);
      const oSec = await createClassSection(other.institutionId, og, oy, { name: "Z" });
      const s = await studentOf(inst.institutionId);
      await createEnrolment(inst.institutionId, s, from, y1, { rollNo: 1 });
      const same = await callAs(inst, "admin", promote, { fromYearId: y1, toYearId: y1, mappings: [{ fromSectionId: from, toSectionId: to }] });
      expect(same.ok).toBe(false);
      const foreign = await callAs(inst, "admin", promote, { fromYearId: y1, toYearId: y2, mappings: [{ fromSectionId: from, toSectionId: oSec }] });
      expect(foreign.ok).toBe(false);
      const foreignFrom = await callAs(inst, "admin", promote, { fromYearId: y1, toYearId: y2, mappings: [{ fromSectionId: oSec, toSectionId: to }] });
      expect(foreignFrom.ok && foreignFrom.data.promoted).not.toBe(1);
      expect((await sql`select 1 from public.enrolments where institution_id=${inst.institutionId} and class_section_id=${to}`).length).toBe(0);
      await withdraw_(inst, s);
      const w = await callAs(inst, "admin", promote, { fromYearId: y1, toYearId: y2, mappings: [{ fromSectionId: from, toSectionId: to }] });
      expect(w.ok && w.data.promoted).toBe(0);
      expect((await sql`select 1 from public.enrolments where institution_id=${inst.institutionId} and class_section_id=${to}`).length).toBe(0);
    } finally { await inst.cleanup(); await other.cleanup(); }
  }, 60_000);
});
async function withdraw_(inst: Parameters<typeof callAs>[0], studentId: string) {
  const r = await callAs(inst, "admin", withdraw, { studentId, reason: "Relocating abroad" });
  if (!r.ok) throw new Error(`withdraw ${r.error.code}`);
}

describe("question bank", () => {
  async function ctx(name: string) {
    const inst = await createTestInstitution(name);
    const g = await createGrade(inst.institutionId);
    const sub = await createSubject(inst.institutionId);
    return { inst, g, sub };
  }
  const q = (c: { g: string; sub: string }, o: Record<string, unknown> = {}) => ({
    subjectId: c.sub, gradeId: c.g, type: "mcq", difficulty: "easy", body: "2+2?", options: ["3", "4"], answer: "4", marks: 1, ...o,
  });

  it("validation: answer outside options, 1 option, 7 options, duplicates, options on short type, true_false answer, marks 0/100.01/0.001", async () => {
    const c = await ctx("cb-qb-val");
    try {
      const cases: Record<string, Record<string, unknown>> = {
        answerOut: { answer: "5" }, oneOpt: { options: ["4"] }, sevenOpts: { options: ["1", "2", "3", "4", "5", "6", "7"], answer: "1" },
        dup: { options: ["4", "4"] }, shortWithOpts: { type: "short" }, tf: { type: "true_false", options: undefined, answer: "maybe" },
        zero: { marks: 0 }, big: { marks: 100.01 }, frac: { marks: 0.001 }, extra: { isActive: true },
      };
      for (const [name, o] of Object.entries(cases)) {
        const r = await callAs(c.inst, "exam_controller", createQuestion, q(c, o) as never);
        expect(!r.ok && r.error.code, name).toBe("validation_failed");
      }
      expect((await sql`select 1 from public.question_bank where institution_id=${c.inst.institutionId}`).length).toBe(0);
    } finally { await c.inst.cleanup(); }
  }, 60_000);

  it("cross-tenant subject/grade refused; archive twice is idempotent; update/archive of foreign or random ids not_found", async () => {
    const c = await ctx("cb-qb-x");
    const o = await ctx("cb-qb-xx");
    try {
      const foreignSubject = await callAs(c.inst, "exam_controller", createQuestion, q({ g: c.g, sub: o.sub }) as never);
      expect(foreignSubject.ok).toBe(false);
      const foreignGrade = await callAs(c.inst, "exam_controller", createQuestion, q({ g: o.g, sub: c.sub }) as never);
      expect(foreignGrade.ok).toBe(false);
      const mine = await callAs(c.inst, "exam_controller", createQuestion, q(c) as never);
      const theirs = await callAs(o.inst, "exam_controller", createQuestion, q(o) as never);
      if (!mine.ok || !theirs.ok) throw new Error("setup");
      const id = (mine.data as { id: string }).id;
      const tid = (theirs.data as { id: string }).id;
      expect((await callAs(c.inst, "exam_controller", archiveQuestion, { id, isActive: false })).ok).toBe(true);
      expect((await callAs(c.inst, "exam_controller", archiveQuestion, { id, isActive: false })).ok).toBe(true);
      expect((await one(sql`select is_active from public.question_bank where id=${id}`)).is_active).toBe(false);
      const xa = await callAs(c.inst, "exam_controller", archiveQuestion, { id: tid, isActive: false });
      expect(!xa.ok && xa.error.code).toBe("not_found");
      const xu = await callAs(c.inst, "exam_controller", updateQuestion, { id: tid, ...q(c) } as never);
      expect(!xu.ok && xu.error.code).toBe("not_found");
      const ru = await callAs(c.inst, "exam_controller", archiveQuestion, { id: crypto.randomUUID(), isActive: false });
      expect(!ru.ok && ru.error.code).toBe("not_found");
      expect((await one(sql`select is_active from public.question_bank where id=${tid}`)).is_active).toBe(true);
    } finally { await c.inst.cleanup(); await o.inst.cleanup(); }
  }, 60_000);
});

describe("future-date BUG probes", () => {
  it("behaviour.incident.log refuses a future occurredOn", async () => {
    const inst = await createTestInstitution("cb-beh-fut");
    try {
      const r = await callAs(inst, "admin", logIncident, { studentId: await studentOf(inst.institutionId), category: "Punctuality", severity: "low", points: 1, occurredOn: "2999-01-01" });
      expect(r.ok).toBe(false);
    } finally { await inst.cleanup(); }
  }, 60_000);

  it("achievement.record refuses a future eventDate", async () => {
    const inst = await createTestInstitution("cb-ach-fut");
    try {
      const r = await callAs(inst, "admin", recordAchievement, { studentId: await studentOf(inst.institutionId), title: "Gold", category: "sports", level: "state", eventDate: "2999-01-01" });
      expect(r.ok).toBe(false);
    } finally { await inst.cleanup(); }
  }, 60_000);
});

describe("behaviour / achievements / documents / alumni", () => {
  it("behaviour: points beyond +-100, bad severity, blank category, long note, future date; foreign student refused", async () => {
    const inst = await createTestInstitution("cb-beh");
    const other = await createTestInstitution("cb-behx");
    try {
      const s = await studentOf(inst.institutionId);
      const ok = { studentId: s, category: "Punctuality", severity: "low", points: 1 };
      for (const [name, o] of Object.entries({ hi: { points: 101 }, lo: { points: -101 }, frac: { points: 1.5 }, sev: { severity: "critical" }, cat: { category: " " }, note: { note: "x".repeat(501) }, extra: { reportedBy: "x" } })) {
        const r = await callAs(inst, "admin", logIncident, { ...ok, ...o } as never);
        expect(!r.ok && r.error.code, name).toBe("validation_failed");
      }
      const foreign = await callAs(inst, "admin", logIncident, { ...ok, studentId: await studentOf(other.institutionId) });
      expect(foreign.ok).toBe(false);
      expect((await sql`select 1 from public.behaviour_incidents where institution_id in (${inst.institutionId}, ${other.institutionId})`).length).toBe(0);
    } finally { await inst.cleanup(); await other.cleanup(); }
  }, 60_000);

  it("achievements: unknown category/level, blank title, future event date; foreign student refused", async () => {
    const inst = await createTestInstitution("cb-ach");
    const other = await createTestInstitution("cb-achx");
    try {
      const ok = { studentId: await studentOf(inst.institutionId), title: "Gold", category: "sports", level: "state", eventDate: "2026-01-10" };
      for (const [name, o] of Object.entries({ cat: { category: "chess" }, lvl: { level: "galactic" }, title: { title: "  " }, pos: { position: "x".repeat(61) } })) {
        const r = await callAs(inst, "admin", recordAchievement, { ...ok, ...o } as never);
        expect(!r.ok && r.error.code, name).toBe("validation_failed");
      }
      const foreign = await callAs(inst, "admin", recordAchievement, { ...ok, studentId: await studentOf(other.institutionId) });
      expect(foreign.ok).toBe(false);
    } finally { await inst.cleanup(); await other.cleanup(); }
  }, 60_000);

  it("documents.delete: random id not_found; teacher/guardian forbidden", async () => {
    const inst = await createTestInstitution("cb-doc");
    try {
      const rnd = await callAs(inst, "admin", deleteDocument, { documentId: crypto.randomUUID() });
      expect(!rnd.ok && rnd.error.code).toBe("not_found");
      for (const role of ["guardian", "student"] as const) {
        const r = await callAs(inst, role, deleteDocument, { documentId: crypto.randomUUID() });
        expect(r.ok, role).toBe(false);
      }
    } finally { await inst.cleanup(); }
  }, 60_000);

  it("alumni.update: bad phone/email -> validation_failed; random id not_found", async () => {
    const inst = await createTestInstitution("cb-alum");
    try {
      const bad = await callAs(inst, "admin", updateAlumniProfile, { id: crypto.randomUUID(), contactEmail: "nope", contactPhone: "123" } as never);
      expect(!bad.ok && bad.error.code).toBe("validation_failed");
      const rnd = await callAs(inst, "admin", updateAlumniProfile, { id: crypto.randomUUID(), contactEmail: "a@b.co", contactPhone: "9876543210", occupation: "", city: "" });
      expect(rnd.ok ? "ok" : JSON.stringify(rnd.error)).toMatch(/not_found/);
    } finally { await inst.cleanup(); }
  }, 60_000);
});
