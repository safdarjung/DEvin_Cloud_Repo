import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { postDiaryEntry, deleteDiaryEntry, acknowledgeDiaryEntry } from "@/modules/diary/actions";
import { addPtmSlots, bookPtmSlot, cancelPtmBooking, createPtmEvent, publishPtmEvent, removePtmSlot } from "@/modules/ptm/actions";
import { approveStudentLeave, cancelStudentLeave, rejectStudentLeave, requestStudentLeave } from "@/modules/student-leave/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createEnrolment, createGrade } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, ROLES, type TestInstitution } from "../helpers/roles";

// Curveballs: ptm, student-leave, diary state machines / cross-tenant / validation.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const one = async (q: Promise<postgres.RowList<postgres.Row[]>>) => (await q)[0]!;

async function base(inst: TestInstitution) {
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId, { code: "VI" });
  const teacherStaffId = (await one(sql`select staff_id from public.memberships where institution_id=${inst.institutionId} and role='teacher'`)).staff_id as string;
  const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A", classTeacherId: teacherStaffId });
  const studentId = (await one(sql`select student_id from public.memberships where institution_id=${inst.institutionId} and role='student'`)).student_id as string;
  const guardianId = (await one(sql`select guardian_id from public.memberships where institution_id=${inst.institutionId} and role='guardian'`)).guardian_id as string;
  await createEnrolment(inst.institutionId, studentId, sectionId, yearId, { status: "active" });
  await sql`insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${inst.institutionId}, ${guardianId}, ${studentId}, 'father', true, true)`;
  return { yearId, gradeId, teacherStaffId, sectionId, studentId, guardianId };
}

const eventInput = (sectionId: string, o: Record<string, unknown> = {}) => ({
  title: "PTM", eventDate: day(14), dayStartsAt: "10:00", dayEndsAt: "11:00", slotMinutes: 10,
  bookingClosesAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), classSectionIds: [sectionId], ...o,
});

describe("ptm curveballs", () => {
  it("event validation: slotMinutes 7, end<=start, closes after event, past date, empty sections all fail with validation_failed", async () => {
    const inst = await createTestInstitution("cb-ptm-val");
    try {
      const b = await base(inst);
      const cases: Record<string, Record<string, unknown>> = {
        slot7: { slotMinutes: 7 },
        endBeforeStart: { dayStartsAt: "11:00", dayEndsAt: "10:00" },
        closesAfter: { bookingClosesAt: new Date(Date.now() + 30 * 86_400_000).toISOString() },
        past: { eventDate: day(-3) },
        noSections: { classSectionIds: [] },
        extraKey: { status: "published" },
      };
      for (const [name, o] of Object.entries(cases)) {
        const r = await callAs(inst, "admin", createPtmEvent, eventInput(b.sectionId, o) as never);
        expect(r.ok, name).toBe(false);
        if (!r.ok) expect(r.error.code, name).toBe("validation_failed");
      }
      expect((await sql`select 1 from public.ptm_events where institution_id=${inst.institutionId}`).length).toBe(0);
    } finally { await inst.cleanup(); }
  }, 60_000);

  it("publish: unknown/other-school event is not_found; teacher/guardian forbidden; publishing twice is invalid_state and audits once", async () => {
    const inst = await createTestInstitution("cb-ptm-pub");
    const other = await createTestInstitution("cb-ptm-pub-x");
    try {
      const b = await base(inst);
      const ob = await base(other);
      const foreign = await callAs(other, "admin", createPtmEvent, eventInput(ob.sectionId));
      if (!foreign.ok) throw new Error("setup");
      const cross = await callAs(inst, "admin", publishPtmEvent, { eventId: foreign.data.id });
      expect(!cross.ok && cross.error.code).toBe("not_found");
      const none = await callAs(inst, "admin", publishPtmEvent, { eventId: crypto.randomUUID() });
      expect(!none.ok && none.error.code).toBe("not_found");
      const ev = await callAs(inst, "admin", createPtmEvent, eventInput(b.sectionId));
      if (!ev.ok) throw new Error("setup");
      for (const role of ["teacher", "guardian", "student"] as const) {
        const r = await callAs(inst, role, publishPtmEvent, { eventId: ev.data.id });
        expect(!r.ok && r.error.code, role).toBe("forbidden");
      }
      expect((await callAs(inst, "admin", publishPtmEvent, { eventId: ev.data.id })).ok).toBe(true);
      const again = await callAs(inst, "admin", publishPtmEvent, { eventId: ev.data.id });
      expect(!again.ok && again.error.code).toBe("invalid_state");
      const audits = await sql`select 1 from public.audit_events where institution_id=${inst.institutionId} and action='ptm.event.publish' and entity_id=${ev.data.id}`;
      // BUG candidate if 2: re-publish writes a duplicate audit row (no invalid_state guard). Assert at-most-once instead of leniently passing.
      expect(audits.length).toBe(1);
    } finally { await inst.cleanup(); await other.cleanup(); }
  }, 60_000);

  it("booking: draft event slot is not bookable; unknown slot not_found; teacher/student cannot book; cancel twice is invalid_state", async () => {
    const inst = await createTestInstitution("cb-ptm-book");
    try {
      const b = await base(inst);
      const ev = await callAs(inst, "admin", createPtmEvent, eventInput(b.sectionId));
      if (!ev.ok) throw new Error("setup");
      const added = await callAs(inst, "teacher", addPtmSlots, { eventId: ev.data.id, from: "10:00", to: "10:30" });
      expect(added.ok).toBe(true);
      const [slot] = await sql`select id from public.ptm_slots where event_id=${ev.data.id} limit 1`;
      const draftBook = await callAs(inst, "guardian", bookPtmSlot, { slotId: slot.id as string, studentId: b.studentId });
      expect(draftBook.ok).toBe(false);
      await callAs(inst, "admin", publishPtmEvent, { eventId: ev.data.id });
      const unknown = await callAs(inst, "guardian", bookPtmSlot, { slotId: crypto.randomUUID(), studentId: b.studentId });
      expect(!unknown.ok && unknown.error.code).toBe("not_found");
      for (const role of ["teacher", "student", "accountant"] as const) {
        const r = await callAs(inst, role, bookPtmSlot, { slotId: slot.id as string, studentId: b.studentId });
        expect(!r.ok && r.error.code, role).toBe("forbidden");
      }
      const booked = await callAs(inst, "guardian", bookPtmSlot, { slotId: slot.id as string, studentId: b.studentId });
      expect(booked.ok).toBe(true);
      if (!booked.ok) return;
      const rebook = await callAs(inst, "guardian", bookPtmSlot, { slotId: slot.id as string, studentId: b.studentId });
      expect(!rebook.ok && rebook.error.code).toBe("conflict");
      const c1 = await callAs(inst, "guardian", cancelPtmBooking, { bookingId: booked.data.bookingId });
      expect(c1.ok).toBe(true);
      const c2 = await callAs(inst, "guardian", cancelPtmBooking, { bookingId: booked.data.bookingId });
      expect(!c2.ok && c2.error.code).toBe("invalid_state");
      const rebookAfterCancel = await callAs(inst, "guardian", bookPtmSlot, { slotId: slot.id as string, studentId: b.studentId });
      expect(rebookAfterCancel.ok).toBe(true);
    } finally { await inst.cleanup(); }
  }, 60_000);

  it("booking after bookingClosesAt is invalid_state", async () => {
    const inst = await createTestInstitution("cb-ptm-closed");
    try {
      const b = await base(inst);
      const ev = await callAs(inst, "admin", createPtmEvent, eventInput(b.sectionId));
      if (!ev.ok) throw new Error("setup");
      await callAs(inst, "teacher", addPtmSlots, { eventId: ev.data.id, from: "10:00", to: "10:20" });
      await callAs(inst, "admin", publishPtmEvent, { eventId: ev.data.id });
      await sql`alter table public.ptm_events disable trigger user`;
      await sql`update public.ptm_events set booking_closes_at = now() - interval '1 hour' where id=${ev.data.id}`;
      await sql`alter table public.ptm_events enable trigger user`;
      const [slot] = await sql`select id from public.ptm_slots where event_id=${ev.data.id} limit 1`;
      const r = await callAs(inst, "guardian", bookPtmSlot, { slotId: slot.id as string, studentId: b.studentId });
      expect(!r.ok && r.error.code).toBe("invalid_state");
    } finally { await inst.cleanup(); }
  }, 60_000);

  it("removing a booked slot, and adding slots where to<=from / not-whole-slot, are refused", async () => {
    const inst = await createTestInstitution("cb-ptm-slots");
    try {
      const b = await base(inst);
      const ev = await callAs(inst, "admin", createPtmEvent, eventInput(b.sectionId));
      if (!ev.ok) throw new Error("setup");
      const rev = await callAs(inst, "teacher", addPtmSlots, { eventId: ev.data.id, from: "10:30", to: "10:00" });
      expect(!rev.ok && rev.error.code).toBe("validation_failed");
      const tiny = await callAs(inst, "teacher", addPtmSlots, { eventId: ev.data.id, from: "10:00", to: "10:05" });
      expect(!tiny.ok && tiny.error.code).toBe("validation_failed");
      const unknownEvent = await callAs(inst, "teacher", addPtmSlots, { eventId: crypto.randomUUID(), from: "10:00", to: "10:30" });
      expect(unknownEvent.ok).toBe(false);
      await callAs(inst, "teacher", addPtmSlots, { eventId: ev.data.id, from: "10:00", to: "10:10" });
      await callAs(inst, "admin", publishPtmEvent, { eventId: ev.data.id });
      const [slot] = await sql`select id from public.ptm_slots where event_id=${ev.data.id} limit 1`;
      const booked = await callAs(inst, "guardian", bookPtmSlot, { slotId: slot.id as string, studentId: b.studentId });
      expect(booked.ok).toBe(true);
      const rm = await callAs(inst, "teacher", removePtmSlot, { slotId: slot.id as string });
      // a slot with a live booking must not vanish silently with the parent's booking
      const [still] = await sql`select count(*)::int n from public.ptm_bookings where slot_id=${slot.id} and status='booked'`;
      expect(rm.ok ? still.n : 1).toBe(1);
    } finally { await inst.cleanup(); }
  }, 60_000);
});

describe("student-leave curveballs", () => {
  const req = (studentId: string, o: Record<string, unknown> = {}) => ({ studentId, startDate: day(5), endDate: day(6), reason: "Trip", ...o });

  it("validation: end before start, >31 days, blank reason, unknown key", async () => {
    const inst = await createTestInstitution("cb-sl-val");
    try {
      const b = await base(inst);
      for (const [name, o] of Object.entries({
        reversed: { startDate: day(6), endDate: day(5) },
        tooLong: { startDate: day(5), endDate: day(40) },
        blank: { reason: "  " },
        extra: { status: "approved" },
      })) {
        const r = await callAs(inst, "guardian", requestStudentLeave, req(b.studentId, o) as never);
        expect(!r.ok && r.error.code, name).toBe("validation_failed");
      }
      const exactly31 = await callAs(inst, "guardian", requestStudentLeave, req(b.studentId, { startDate: day(5), endDate: day(35) }));
      expect(exactly31.ok).toBe(true);
    } finally { await inst.cleanup(); }
  }, 60_000);

  it("state machine: approve twice, reject after approve, cancel after reject, cancel twice are invalid_state", async () => {
    const inst = await createTestInstitution("cb-sl-sm");
    try {
      const b = await base(inst);
      const mk = async (s: number) => {
        const r = await callAs(inst, "guardian", requestStudentLeave, req(b.studentId, { startDate: day(s), endDate: day(s) }));
        if (!r.ok) throw new Error(`setup ${r.error.code}`);
        return r.data.id as string;
      };
      const a = await mk(10);
      expect((await callAs(inst, "teacher", approveStudentLeave, { leaveId: a })).ok).toBe(true);
      const a2 = await callAs(inst, "teacher", approveStudentLeave, { leaveId: a });
      expect(!a2.ok && a2.error.code).toBe("invalid_state");
      const rj = await callAs(inst, "teacher", rejectStudentLeave, { leaveId: a });
      expect(!rj.ok && rj.error.code).toBe("invalid_state");
      const c = await mk(12);
      expect((await callAs(inst, "teacher", rejectStudentLeave, { leaveId: c })).ok).toBe(true);
      const cc = await callAs(inst, "guardian", cancelStudentLeave, { leaveId: c });
      expect(!cc.ok && cc.error.code).toBe("invalid_state");
      const d = await mk(14);
      expect((await callAs(inst, "guardian", cancelStudentLeave, { leaveId: d })).ok).toBe(true);
      const d2 = await callAs(inst, "guardian", cancelStudentLeave, { leaveId: d });
      expect(!d2.ok && d2.error.code).toBe("invalid_state");
      const ap = await callAs(inst, "teacher", approveStudentLeave, { leaveId: d });
      expect(!ap.ok && ap.error.code).toBe("invalid_state");
    } finally { await inst.cleanup(); }
  }, 60_000);

  it("another school's leave id and random ids are not_found for decide/cancel; student/accountant cannot request", async () => {
    const inst = await createTestInstitution("cb-sl-x");
    const other = await createTestInstitution("cb-sl-x2");
    try {
      const b = await base(inst);
      const ob = await base(other);
      const foreign = await callAs(other, "guardian", requestStudentLeave, req(ob.studentId));
      if (!foreign.ok) throw new Error("setup");
      for (const act of [approveStudentLeave, rejectStudentLeave]) {
        const r = await callAs(inst, "admin", act, { leaveId: foreign.data.id });
        expect(!r.ok && r.error.code).toBe("not_found");
      }
      const c = await callAs(inst, "guardian", cancelStudentLeave, { leaveId: foreign.data.id });
      expect(!c.ok && c.error.code).toBe("not_found");
      const rnd = await callAs(inst, "admin", approveStudentLeave, { leaveId: crypto.randomUUID() });
      expect(!rnd.ok && rnd.error.code).toBe("not_found");
      const xs = await callAs(inst, "guardian", requestStudentLeave, req(ob.studentId));
      expect(xs.ok).toBe(false);
      for (const role of ["accountant", "exam_controller"] as const) {
        const r = await callAs(inst, role, requestStudentLeave, req(b.studentId));
        expect(!r.ok && r.error.code, role).toBe("forbidden");
      }
      const [still] = await sql`select status from public.student_leave_requests where id=${foreign.data.id}`;
      expect(still.status).toBe("pending");
    } finally { await inst.cleanup(); await other.cleanup(); }
  }, 60_000);
});

describe("diary curveballs", () => {
  it("delete twice -> second not_found; acknowledge for a student the guardian does not own is refused; entry for another school's section refused", async () => {
    const inst = await createTestInstitution("cb-diary");
    const other = await createTestInstitution("cb-diary-x");
    try {
      const b = await base(inst);
      const ob = await base(other);
      const post = await callAs(inst, "teacher", postDiaryEntry, { classSectionId: b.sectionId, entryDate: day(0), body: "HW", requiresAck: true });
      expect(post.ok).toBe(true);
      if (!post.ok) return;
      const id = (post.data as { id: string }).id;
      const ack = await callAs(inst, "guardian", acknowledgeDiaryEntry, { entryId: id, studentId: ob.studentId });
      expect(ack.ok).toBe(false);
      const d1 = await callAs(inst, "teacher", deleteDiaryEntry, { entryId: id });
      expect(d1.ok).toBe(true);
      const d2 = await callAs(inst, "teacher", deleteDiaryEntry, { entryId: id });
      expect(!d2.ok && d2.error.code).toBe("not_found");
      const gone = await callAs(inst, "guardian", acknowledgeDiaryEntry, { entryId: id, studentId: b.studentId });
      expect(!gone.ok && gone.error.code).toBe("not_found");
      const foreign = await callAs(inst, "teacher", postDiaryEntry, { classSectionId: ob.sectionId, entryDate: day(0), body: "HW" });
      expect(!foreign.ok && foreign.error.code).toMatch(/forbidden|not_found/);
    } finally { await inst.cleanup(); await other.cleanup(); }
  }, 60_000);

  it("validation: empty body, body 2001 chars, bad date, unknown key; all non-teaching roles forbidden", async () => {
    const inst = await createTestInstitution("cb-diary-val");
    try {
      const b = await base(inst);
      const ok = { classSectionId: b.sectionId, entryDate: day(0), body: "x" };
      for (const [name, o] of Object.entries({ empty: { body: " " }, long: { body: "x".repeat(2001) }, date: { entryDate: "2026-13-45" }, extra: { id: crypto.randomUUID() } })) {
        const r = await callAs(inst, "teacher", postDiaryEntry, { ...ok, ...o } as never);
        expect(!r.ok && r.error.code, name).toBe("validation_failed");
      }
      for (const role of ROLES.filter((r) => ["guardian", "student", "accountant", "exam_controller"].includes(r))) {
        const r = await callAs(inst, role, postDiaryEntry, ok);
        expect(!r.ok && r.error.code, role).toBe("forbidden");
      }
    } finally { await inst.cleanup(); }
  }, 60_000);
});
