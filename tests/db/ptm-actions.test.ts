// X08-T5 — ptm.event.create / ptm.event.publish / ptm.slots.add /
// ptm.slot.remove / ptm.booking.create / ptm.booking.cancel. Fixture shape
// mirrors tests/db/leave-actions.test.ts (callAs) + tests/db/ptm-rls.test.ts
// (makeBase: grade VI / section A with the fixture teacher + student).
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mock (leave-actions.test.ts pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { addPtmSlots, bookPtmSlot, cancelPtmBooking, createPtmEvent, publishPtmEvent, removePtmSlot } from "@/modules/ptm/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createEnrolment, createGrade } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

function isoFuture(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function staffIdFor(institutionId: string, role: string): Promise<string> {
  const [row] = await sql`select staff_id from public.memberships where institution_id = ${institutionId} and role = ${role}`;
  return row.staff_id as string;
}

async function studentIdFor(institutionId: string): Promise<string> {
  const [row] = await sql`select student_id from public.memberships where institution_id = ${institutionId} and role = 'student'`;
  return row.student_id as string;
}

async function guardianIdFor(institutionId: string): Promise<string> {
  const [row] = await sql`select guardian_id from public.memberships where institution_id = ${institutionId} and role = 'guardian'`;
  return row.guardian_id as string;
}

/** Academic year + grade VI + section A (class teacher = fixture teacher), fixture student enrolled. */
async function makeBase(inst: TestInstitution) {
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId, { code: "VI" });
  const teacherStaffId = await staffIdFor(inst.institutionId, "teacher");
  const sectionA = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A", classTeacherId: teacherStaffId });
  const studentId = await studentIdFor(inst.institutionId);
  const guardianId = await guardianIdFor(inst.institutionId);
  await createEnrolment(inst.institutionId, studentId, sectionA, yearId, { status: "active" });
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${inst.institutionId}, ${guardianId}, ${studentId}, 'father', true, true)
  `;
  return { yearId, gradeId, sectionA, teacherStaffId, studentId, guardianId };
}

async function createPublishedEvent(
  inst: TestInstitution,
  base: Awaited<ReturnType<typeof makeBase>>,
  overrides: Partial<{ dayStartsAt: string; dayEndsAt: string; slotMinutes: number; bookingClosesAt: string }> = {},
): Promise<string> {
  const created = await callAs(inst, "admin", createPtmEvent, {
    title: "Term PTM",
    eventDate: isoFuture(14),
    dayStartsAt: overrides.dayStartsAt ?? "10:00",
    dayEndsAt: overrides.dayEndsAt ?? "11:00",
    slotMinutes: overrides.slotMinutes ?? 10,
    bookingClosesAt: overrides.bookingClosesAt ?? new Date(Date.now() + 7 * 86_400_000).toISOString(),
    classSectionIds: [base.sectionA],
  });
  if (!created.ok) throw new Error(`fixture: createPtmEvent failed: ${created.error.code} ${created.error.message}`);
  const published = await callAs(inst, "admin", publishPtmEvent, { eventId: created.data.id });
  if (!published.ok) throw new Error(`fixture: publishPtmEvent failed: ${published.error.code} ${published.error.message}`);
  return created.data.id;
}

describe("ptm.* actions (X08-T5)", () => {
  it("admin creates a draft event with 2 sections and publishes", async () => {
    const inst = await createTestInstitution("ptm-act-create-publish");
    try {
      const base = await makeBase(inst);
      const sectionB = await createClassSection(inst.institutionId, base.gradeId, base.yearId, { name: "B" });

      const created = await callAs(inst, "admin", createPtmEvent, {
        title: "Term PTM",
        eventDate: isoFuture(14),
        dayStartsAt: "10:00",
        dayEndsAt: "11:00",
        slotMinutes: 10,
        bookingClosesAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        classSectionIds: [base.sectionA, sectionB],
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const published = await callAs(inst, "admin", publishPtmEvent, { eventId: created.data.id });
      expect(published.ok).toBe(true);
      if (!published.ok) return;
      expect(published.data.id).toBe(created.data.id);

      const [row] = await sql`select status from public.ptm_events where id = ${created.data.id}`;
      expect(row.status).toBe("published");
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("a section of another institution -> forbidden and no draft left behind", async () => {
    const inst = await createTestInstitution("ptm-act-cross-tenant");
    const other = await createTestInstitution("ptm-act-cross-tenant-other");
    try {
      const base = await makeBase(inst);
      const otherBase = await makeBase(other);

      const result = await callAs(inst, "admin", createPtmEvent, {
        title: "Term PTM",
        eventDate: isoFuture(14),
        dayStartsAt: "10:00",
        dayEndsAt: "11:00",
        slotMinutes: 10,
        bookingClosesAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        classSectionIds: [base.sectionA, otherBase.sectionA],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");

      const rows = await sql`select id from public.ptm_events where institution_id = ${inst.institutionId}`;
      expect(rows).toHaveLength(0);
    } finally {
      await inst.cleanup();
      await other.cleanup();
    }
  }, 30_000);

  it("teacher adds 10:00-10:30 on 10-min slots -> added 3, again -> added 0", async () => {
    const inst = await createTestInstitution("ptm-act-slots-add");
    try {
      const base = await makeBase(inst);
      const eventId = await createPublishedEvent(inst, base, { dayStartsAt: "10:00", dayEndsAt: "11:00", slotMinutes: 10 });

      const first = await callAs(inst, "teacher", addPtmSlots, { eventId, from: "10:00", to: "10:30" });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.data.added).toBe(3);

      const again = await callAs(inst, "teacher", addPtmSlots, { eventId, from: "10:00", to: "10:30" });
      expect(again.ok).toBe(true);
      if (!again.ok) return;
      expect(again.data.added).toBe(0);
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("teacher adds for another teacher -> forbidden", async () => {
    const inst = await createTestInstitution("ptm-act-slots-other-teacher");
    try {
      const base = await makeBase(inst);
      const eventId = await createPublishedEvent(inst, base);

      const result = await callAs(inst, "teacher", addPtmSlots, { eventId, staffId: crypto.randomUUID(), from: "10:00", to: "10:30" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("removing a slot that does not exist -> not_found", async () => {
    const inst = await createTestInstitution("ptm-act-slot-remove-missing");
    try {
      await makeBase(inst);
      const result = await callAs(inst, "admin", removePtmSlot, { slotId: crypto.randomUUID() });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("not_found");
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("guardian books then cancels", async () => {
    const inst = await createTestInstitution("ptm-act-book-cancel");
    try {
      const base = await makeBase(inst);
      const eventId = await createPublishedEvent(inst, base, {
        dayStartsAt: "10:00",
        dayEndsAt: "10:30",
        slotMinutes: 10,
        bookingClosesAt: new Date(Date.now() + 3_600_000).toISOString(),
      });
      const added = await callAs(inst, "admin", addPtmSlots, { eventId, staffId: base.teacherStaffId, from: "10:00", to: "10:10" });
      expect(added.ok).toBe(true);

      const [slot] = await sql`select id from public.ptm_slots where event_id = ${eventId} and staff_id = ${base.teacherStaffId} and seq = 0`;
      const slotId = slot.id as string;

      const booked = await callAs(inst, "guardian", bookPtmSlot, { slotId, studentId: base.studentId });
      expect(booked.ok).toBe(true);
      if (!booked.ok) return;

      const cancelled = await callAs(inst, "guardian", cancelPtmBooking, { bookingId: booked.data.bookingId });
      expect(cancelled.ok).toBe(true);
      if (!cancelled.ok) return;
      expect(cancelled.data.bookingId).toBe(booked.data.bookingId);

      const [row] = await sql`select status from public.ptm_bookings where id = ${booked.data.bookingId}`;
      expect(row.status).toBe("cancelled");
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("double booking (same child, same teacher, a second slot) -> conflict", async () => {
    const inst = await createTestInstitution("ptm-act-double-book");
    try {
      const base = await makeBase(inst);
      const eventId = await createPublishedEvent(inst, base, {
        dayStartsAt: "10:00",
        dayEndsAt: "10:30",
        slotMinutes: 10,
        bookingClosesAt: new Date(Date.now() + 3_600_000).toISOString(),
      });
      const added = await callAs(inst, "admin", addPtmSlots, { eventId, staffId: base.teacherStaffId, from: "10:00", to: "10:30" });
      expect(added.ok).toBe(true);
      if (!added.ok) return;
      expect(added.data.added).toBe(3);

      const slots = await sql`select id, seq from public.ptm_slots where event_id = ${eventId} order by seq`;
      const slot0 = slots[0].id as string;
      const slot1 = slots[1].id as string;

      const first = await callAs(inst, "guardian", bookPtmSlot, { slotId: slot0, studentId: base.studentId });
      expect(first.ok).toBe(true);

      const again = await callAs(inst, "guardian", bookPtmSlot, { slotId: slot1, studentId: base.studentId });
      expect(again.ok).toBe(false);
      if (again.ok) return;
      expect(again.error.code).toBe("conflict");
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("teacher calls ptm.event.create -> forbidden", async () => {
    const inst = await createTestInstitution("ptm-act-teacher-create-forbidden");
    try {
      const base = await makeBase(inst);
      const result = await callAs(inst, "teacher", createPtmEvent, {
        title: "Term PTM",
        eventDate: isoFuture(14),
        dayStartsAt: "10:00",
        dayEndsAt: "11:00",
        slotMinutes: 10,
        bookingClosesAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        classSectionIds: [base.sectionA],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  }, 30_000);
});
