// X08-T2 — migration 0099 part A: ptm_events/ptm_event_sections/ptm_slots/
// ptm_bookings RLS, guards (guard_ptm_events_update, guard_ptm_slots_write),
// and the three definers (ptm_slots_for_student, book_ptm_slot,
// cancel_ptm_booking). Mirrors tests/db/student-leave-rls.test.ts's fixture
// shape (createTestInstitution + raw-SQL second family for cross-tenant /
// cross-family checks).
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { createAcademicYear, createClassSection, createEnrolment, createGrade, closeFactoriesHelper } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });
const PASSWORD = "correct-horse-battery-staple";

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

function adminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SECRET_KEY as string,
  );
}

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

async function signedInClient(email: string): Promise<SupabaseClient> {
  const client = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
  );
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return client;
}

/** A second teacher outside the fixture's one-per-role roster, with a real signed-in client. */
async function newTeacher(institutionId: string, fullName: string): Promise<{ staffId: string; userId: string; client: SupabaseClient }> {
  const email = `ptm-rls-${crypto.randomUUID()}@test.coolskool.test`;
  const { data, error } = await adminClient().auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("test user was not created");

  const [staff] = await sql`
    insert into public.staff (institution_id, employee_no, full_name, designation, is_teaching)
    values (${institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, ${fullName}, 'teacher', true)
    returning id
  `;
  await sql`
    insert into public.memberships (institution_id, user_id, role, staff_id)
    values (${institutionId}, ${data.user.id}, 'teacher', ${staff.id})
  `;

  return { staffId: staff.id as string, userId: data.user.id, client: await signedInClient(email) };
}

/** A second guardian+child family outside the fixture's one-per-role roster, with a real signed-in client. */
async function newFamily(
  institutionId: string,
  sectionId: string,
  academicYearId: string,
  fullName: string,
): Promise<{ guardianId: string; studentId: string; client: SupabaseClient }> {
  const email = `ptm-rls-${crypto.randomUUID()}@test.coolskool.test`;
  const { data, error } = await adminClient().auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("test user was not created");

  const [guardian] = await sql`
    insert into public.guardians (institution_id, full_name, phone)
    values (${institutionId}, ${fullName}, ${`9${String(Math.floor(100000000 + Math.random() * 900000000))}`})
    returning id
  `;
  await sql`
    insert into public.memberships (institution_id, user_id, role, guardian_id)
    values (${institutionId}, ${data.user.id}, 'guardian', ${guardian.id})
  `;
  const [student] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, ${fullName}, '2015-06-01', 'other')
    returning id
  `;
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${institutionId}, ${guardian.id}, ${student.id}, 'father', true, true)
  `;
  await createEnrolment(institutionId, student.id as string, sectionId, academicYearId, { status: "active" });

  return { guardianId: guardian.id as string, studentId: student.id as string, client: await signedInClient(email) };
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

async function createDraftEvent(
  inst: TestInstitution,
  overrides: Partial<{ eventDate: string; dayStartsAt: string; dayEndsAt: string; slotMinutes: number; bookingClosesAt: string }> = {},
) {
  const eventDate = overrides.eventDate ?? isoFuture(14);
  const { data, error } = await inst
    .clientAs("admin")
    .from("ptm_events")
    .insert({
      institution_id: inst.institutionId,
      title: "Term PTM",
      event_date: eventDate,
      day_starts_at: overrides.dayStartsAt ?? "10:00",
      day_ends_at: overrides.dayEndsAt ?? "11:00",
      slot_minutes: overrides.slotMinutes ?? 10,
      booking_closes_at: overrides.bookingClosesAt ?? new Date(Date.now() + 7 * 86_400_000).toISOString(),
      created_by: inst.users.admin.id,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}

async function addSection(inst: TestInstitution, eventId: string, sectionId: string) {
  const { error } = await inst.clientAs("admin").from("ptm_event_sections").insert({
    event_id: eventId,
    institution_id: inst.institutionId,
    class_section_id: sectionId,
  });
  if (error) throw error;
}

async function publish(inst: TestInstitution, eventId: string) {
  return inst.clientAs("admin").from("ptm_events").update({ status: "published" }).eq("id", eventId).select("status").single();
}

describe("X08-T2: ptm_events lifecycle (guard_ptm_events_update)", () => {
  it("admin creates a draft event with 2 sections and publishes", async () => {
    const inst = await createTestInstitution("ptm-publish");
    try {
      const base = await makeBase(inst);
      const sectionB = await createClassSection(inst.institutionId, base.gradeId, base.yearId, { name: "B" });
      const eventId = await createDraftEvent(inst);
      await addSection(inst, eventId, base.sectionA);
      await addSection(inst, eventId, sectionB);

      const result = await publish(inst, eventId);
      expect(result.error).toBeNull();
      expect(result.data?.status).toBe("published");

      const [row] = await sql`select published_at, published_by from public.ptm_events where id = ${eventId}`;
      expect(row.published_at).not.toBeNull();
      expect(row.published_by).toBe(inst.users.admin.id);
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("publish with 0 sections -> invalid_state", async () => {
    const inst = await createTestInstitution("ptm-publish-nosection");
    try {
      await makeBase(inst);
      const eventId = await createDraftEvent(inst);
      const result = await publish(inst, eventId);
      expect(result.error?.message).toContain("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("publish with a past booking cutoff -> invalid_state", async () => {
    const inst = await createTestInstitution("ptm-publish-pastcutoff");
    try {
      const base = await makeBase(inst);
      const eventId = await createDraftEvent(inst, { bookingClosesAt: new Date(Date.now() - 3_600_000).toISOString() });
      await addSection(inst, eventId, base.sectionA);
      const result = await publish(inst, eventId);
      expect(result.error?.message).toContain("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("changing a published event's date -> invalid_state", async () => {
    const inst = await createTestInstitution("ptm-publish-editafter");
    try {
      const base = await makeBase(inst);
      const eventId = await createDraftEvent(inst);
      await addSection(inst, eventId, base.sectionA);
      const published = await publish(inst, eventId);
      expect(published.error).toBeNull();

      const edit = await inst.clientAs("admin").from("ptm_events").update({ event_date: isoFuture(30) }).eq("id", eventId);
      expect(edit.error?.message).toContain("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  }, 30_000);
});

describe("X08-T2: ptm_slots RLS + guard_ptm_slots_write", () => {
  it("teacher of the section inserts own slots 0..5; seq beyond the window fails; a teacher teaching no event section is denied by RLS", async () => {
    const inst = await createTestInstitution("ptm-slots");
    try {
      const base = await makeBase(inst);
      const eventId = await createDraftEvent(inst, { dayStartsAt: "10:00", dayEndsAt: "11:00", slotMinutes: 10 });
      await addSection(inst, eventId, base.sectionA);
      await publish(inst, eventId);

      for (let seq = 0; seq <= 5; seq++) {
        const { error } = await inst.clientAs("teacher").from("ptm_slots").insert({
          institution_id: inst.institutionId,
          event_id: eventId,
          staff_id: base.teacherStaffId,
          seq,
          created_by: inst.users.teacher.id,
        });
        expect(error, `seq=${seq}`).toBeNull();
      }

      const overflow = await inst.clientAs("teacher").from("ptm_slots").insert({
        institution_id: inst.institutionId,
        event_id: eventId,
        staff_id: base.teacherStaffId,
        seq: 6,
        created_by: inst.users.teacher.id,
      });
      expect(overflow.error?.message).toContain("code:validation_failed");

      const outsider = await newTeacher(inst.institutionId, "Outside Teacher");
      const outsiderInsert = await outsider.client.from("ptm_slots").insert({
        institution_id: inst.institutionId,
        event_id: eventId,
        staff_id: outsider.staffId,
        seq: 0,
        created_by: outsider.userId,
      });
      expect(outsiderInsert.error?.code).toBe("42501");
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("deleting a slot with a booked booking -> conflict; with only a cancelled one -> ok", async () => {
    const inst = await createTestInstitution("ptm-slot-delete");
    try {
      const base = await makeBase(inst);
      const eventId = await createDraftEvent(inst, { dayStartsAt: "10:00", dayEndsAt: "10:30", slotMinutes: 10, bookingClosesAt: new Date(Date.now() + 3_600_000).toISOString() });
      await addSection(inst, eventId, base.sectionA);
      await publish(inst, eventId);

      const { data: slot } = await inst
        .clientAs("teacher")
        .from("ptm_slots")
        .insert({ institution_id: inst.institutionId, event_id: eventId, staff_id: base.teacherStaffId, seq: 0, created_by: inst.users.teacher.id })
        .select("id")
        .single();
      const slotId = slot!.id as string;

      const book = await inst.clientAs("guardian").rpc("book_ptm_slot", { p_slot_id: slotId, p_student_id: base.studentId });
      expect(book.error).toBeNull();
      const bookingId = book.data as string;

      const blockedDelete = await inst.clientAs("teacher").from("ptm_slots").delete().eq("id", slotId);
      expect(blockedDelete.error?.message).toContain("code:conflict");

      const cancel = await inst.clientAs("guardian").rpc("cancel_ptm_booking", { p_booking_id: bookingId });
      expect(cancel.error).toBeNull();

      const okDelete = await inst.clientAs("teacher").from("ptm_slots").delete().eq("id", slotId);
      expect(okDelete.error).toBeNull();
    } finally {
      await inst.cleanup();
    }
  }, 30_000);
});

describe("X08-T2: booking lifecycle (book_ptm_slot / cancel_ptm_booking / ptm_slots_for_student)", () => {
  it("covers booking, conflicts, cross-family/section denials, cutoff, cancel + re-book, and never leaks another child's booking id", async () => {
    const inst = await createTestInstitution("ptm-booking");
    try {
      const base = await makeBase(inst);
      const otherTeacher = await newTeacher(inst.institutionId, "Section B Teacher");
      const sectionB = await createClassSection(inst.institutionId, base.gradeId, base.yearId, { name: "B", classTeacherId: otherTeacher.staffId });

      const eventId = await createDraftEvent(inst, {
        dayStartsAt: "10:00",
        dayEndsAt: "10:30",
        slotMinutes: 10,
        bookingClosesAt: new Date(Date.now() + 3_600_000).toISOString(),
      });
      await addSection(inst, eventId, base.sectionA);
      await addSection(inst, eventId, sectionB);
      await publish(inst, eventId);

      // Two slots for the fixture teacher (sectionA), one for the section-B teacher.
      const { data: slotsA } = await inst
        .clientAs("teacher")
        .from("ptm_slots")
        .insert([
          { institution_id: inst.institutionId, event_id: eventId, staff_id: base.teacherStaffId, seq: 0, created_by: inst.users.teacher.id },
          { institution_id: inst.institutionId, event_id: eventId, staff_id: base.teacherStaffId, seq: 1, created_by: inst.users.teacher.id },
        ])
        .select("id, seq")
        .order("seq");
      const slot0 = slotsA!.find((s) => s.seq === 0)!.id as string;
      const slot1 = slotsA!.find((s) => s.seq === 1)!.id as string;

      const { data: slotB } = await otherTeacher.client
        .from("ptm_slots")
        .insert({ institution_id: inst.institutionId, event_id: eventId, staff_id: otherTeacher.staffId, seq: 0, created_by: otherTeacher.userId })
        .select("id")
        .single();
      const slotBId = slotB!.id as string;

      const otherFamily = await newFamily(inst.institutionId, base.sectionA, base.yearId, "Other Family Child");
      const sectionBFamily = await newFamily(inst.institutionId, sectionB, base.yearId, "Section B Child");

      // Guardian books slot0 for their own child.
      const firstBook = await inst.clientAs("guardian").rpc("book_ptm_slot", { p_slot_id: slot0, p_student_id: base.studentId });
      expect(firstBook.error).toBeNull();
      const bookingId = firstBook.data as string;

      // Same child + same teacher again (a different slot) -> conflict.
      const sameChildAgain = await inst.clientAs("guardian").rpc("book_ptm_slot", { p_slot_id: slot1, p_student_id: base.studentId });
      expect(sameChildAgain.error?.message).toContain("code:conflict");

      // Other family tries to book the already-taken slot0 -> conflict.
      const otherTakesSlot = await otherFamily.client.rpc("book_ptm_slot", {
        p_slot_id: slot0,
        p_student_id: otherFamily.studentId,
      });
      expect(otherTakesSlot.error?.message).toContain("code:conflict");

      // Other family books slot1 instead (their own child, same teacher) -> ok.
      const otherBooksSlot1 = await otherFamily.client.rpc("book_ptm_slot", {
        p_slot_id: slot1,
        p_student_id: otherFamily.studentId,
      });
      expect(otherBooksSlot1.error).toBeNull();

      // Guardian books for another family's child -> forbidden.
      const wrongChild = await inst.clientAs("guardian").rpc("book_ptm_slot", { p_slot_id: slotBId, p_student_id: otherFamily.studentId });
      expect(wrongChild.error?.message).toContain("code:forbidden");

      // Section-B child books their own section's slot -> ok (sanity check before
      // proving the cross-section denial below).
      const sameSectionBooks = await sectionBFamily.client.rpc("book_ptm_slot", {
        p_slot_id: slotBId,
        p_student_id: sectionBFamily.studentId,
      });
      expect(sameSectionBooks.error).toBeNull();

      // Create a fresh open slot for the fixture (section-A) teacher and have the
      // section-B child attempt to book it: their active section (B) isn't eligible
      // for the section-A teacher -> validation_failed.
      const { data: slot2 } = await inst
        .clientAs("teacher")
        .from("ptm_slots")
        .insert({ institution_id: inst.institutionId, event_id: eventId, staff_id: base.teacherStaffId, seq: 2, created_by: inst.users.teacher.id })
        .select("id")
        .single();
      const crossSection = await sectionBFamily.client.rpc("book_ptm_slot", {
        p_slot_id: slot2!.id,
        p_student_id: sectionBFamily.studentId,
      });
      expect(crossSection.error?.message).toContain("code:validation_failed");

      // Cancel before cutoff -> the slot opens again and re-booking works.
      const cancelled = await inst.clientAs("guardian").rpc("cancel_ptm_booking", { p_booking_id: bookingId });
      expect(cancelled.error).toBeNull();
      const rebook = await inst.clientAs("guardian").rpc("book_ptm_slot", { p_slot_id: slot0, p_student_id: base.studentId });
      expect(rebook.error).toBeNull();

      // ptm_slots_for_student: mine/taken/open, never another child's booking id.
      const view = await inst.clientAs("guardian").rpc("ptm_slots_for_student", { p_student_id: base.studentId, p_event_id: eventId });
      expect(view.error).toBeNull();
      const bySeq = (seq: number) => (view.data as Array<Record<string, unknown>>).find((r) => r.seq === seq && r.staff_id === base.teacherStaffId);
      expect(bySeq(0)?.state).toBe("mine");
      expect(bySeq(0)?.booking_id).toBe(rebook.data);
      expect(bySeq(1)?.state).toBe("taken");
      expect(bySeq(1)?.booking_id).toBeNull();
      expect(bySeq(2)?.state).toBe("open");

      // After the booking cutoff -> invalid_state.
      const lateEventId = await createDraftEvent(inst, {
        dayStartsAt: "12:00",
        dayEndsAt: "12:30",
        slotMinutes: 10,
        bookingClosesAt: new Date(Date.now() + 4_000).toISOString(),
      });
      await addSection(inst, lateEventId, base.sectionA);
      const latePublish = await publish(inst, lateEventId);
      expect(latePublish.error).toBeNull();
      const { data: lateSlot } = await inst
        .clientAs("teacher")
        .from("ptm_slots")
        .insert({ institution_id: inst.institutionId, event_id: lateEventId, staff_id: base.teacherStaffId, seq: 0, created_by: inst.users.teacher.id })
        .select("id")
        .single();
      await new Promise((resolve) => setTimeout(resolve, 4_500));
      const tooLate = await inst.clientAs("guardian").rpc("book_ptm_slot", { p_slot_id: lateSlot!.id, p_student_id: base.studentId });
      expect(tooLate.error?.message).toContain("code:invalid_state");

      // Direct reads/writes bypassing the definers.
      const directEvents = await inst.clientAs("guardian").from("ptm_events").select("id");
      expect(directEvents.data).toHaveLength(0);
      const directSlots = await inst.clientAs("guardian").from("ptm_slots").select("id");
      expect(directSlots.data).toHaveLength(0);
      const directInsertBooking = await inst.clientAs("guardian").from("ptm_bookings").insert({
        institution_id: inst.institutionId,
        event_id: eventId,
        staff_id: base.teacherStaffId,
        slot_id: slot2!.id,
        student_id: base.studentId,
        booked_by: inst.users.guardian.id,
      });
      expect(directInsertBooking.error).not.toBeNull();

      // Teacher sees bookings on own slots only (not the section-B teacher's).
      const teacherBookings = await inst.clientAs("teacher").from("ptm_bookings").select("staff_id");
      expect((teacherBookings.data ?? []).every((r) => r.staff_id === base.teacherStaffId)).toBe(true);
      expect((teacherBookings.data ?? []).length).toBeGreaterThan(0);
    } finally {
      await inst.cleanup();
    }
  }, 60_000);

  it("admin of institution A cannot reference institution B's section or staff", async () => {
    const instA = await createTestInstitution("ptm-cross-a");
    const instB = await createTestInstitution("ptm-cross-b");
    try {
      const baseA = await makeBase(instA);
      const baseB = await makeBase(instB);
      const eventId = await createDraftEvent(instA);

      const crossSection = await instA.clientAs("admin").from("ptm_event_sections").insert({
        event_id: eventId,
        institution_id: instA.institutionId,
        class_section_id: baseB.sectionA,
      });
      expect(crossSection.error).not.toBeNull();

      await addSection(instA, eventId, baseA.sectionA);
      await publish(instA, eventId);
      const crossStaff = await instA.clientAs("admin").from("ptm_slots").insert({
        institution_id: instA.institutionId,
        event_id: eventId,
        staff_id: baseB.teacherStaffId,
        seq: 0,
        created_by: instA.users.admin.id,
      });
      expect(crossStaff.error).not.toBeNull();
    } finally {
      await instA.cleanup();
      await instB.cleanup();
    }
  }, 30_000);
});
