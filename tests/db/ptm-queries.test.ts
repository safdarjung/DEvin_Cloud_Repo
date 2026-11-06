// X08-T6 — src/modules/ptm/queries.ts: ptm.events / ptm.teacherSchedule /
// ptm.forStudent, called directly as plain query functions (not via HTTP),
// same pattern as tests/db/timetable-queries.test.ts (buildContext +
// setActingClient). Fixtures mirror tests/db/ptm-rls.test.ts's
// makeBase/createDraftEvent/addSection/publish/newTeacher/newFamily.
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { buildContext } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createEnrolment, createGrade } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";
import { permissionsFor, type Role } from "@/lib/auth/permissions";
import { AppError } from "@/lib/actions/result";
import type { TenantContext } from "@/lib/auth/types";
import { ptmEvents, ptmForStudent, ptmTeacherSchedule } from "@/modules/ptm/queries";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });
const PASSWORD = "correct-horse-battery-staple";

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

function adminClient() {
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
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

/** A second teacher outside the fixture's one-per-role roster, with a real signed-in client + a TenantContext (buildContext only covers the fixed fixture roles). */
async function newTeacher(institutionId: string, fullName: string): Promise<{ staffId: string; client: SupabaseClient; ctx: TenantContext }> {
  const email = `ptm-q-${crypto.randomUUID()}@test.coolskool.test`;
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
  const [institution] = await sql`select slug, name, settings, ai_policy, is_demo from public.institutions where id = ${institutionId}`;

  const ctx: TenantContext = {
    institution: {
      id: institutionId,
      slug: institution.slug,
      name: institution.name,
      settings: institution.settings ?? {},
      ai_policy: institution.ai_policy,
      is_demo: institution.is_demo,
    },
    user: { id: data.user.id, profile: { fullName, phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role: "teacher", staffId: staff.id as string, guardianId: null, studentId: null },
    permissions: new Set(permissionsFor("teacher" as Role)),
  };

  return { staffId: staff.id as string, client: await signedInClient(email), ctx };
}

/** A second guardian+child family outside the fixture's one-per-role roster. */
async function newFamily(
  institutionId: string,
  sectionId: string,
  academicYearId: string,
  fullName: string,
): Promise<{ studentId: string; client: SupabaseClient; ctx: TenantContext }> {
  const email = `ptm-q-${crypto.randomUUID()}@test.coolskool.test`;
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
  const [institution] = await sql`select slug, name, settings, ai_policy, is_demo from public.institutions where id = ${institutionId}`;

  const ctx: TenantContext = {
    institution: {
      id: institutionId,
      slug: institution.slug,
      name: institution.name,
      settings: institution.settings ?? {},
      ai_policy: institution.ai_policy,
      is_demo: institution.is_demo,
    },
    user: { id: data.user.id, profile: { fullName, phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role: "guardian", staffId: null, guardianId: guardian.id as string, studentId: null },
    permissions: new Set(permissionsFor("guardian" as Role)),
  };

  return { studentId: student.id as string, client: await signedInClient(email), ctx };
}

/** Academic year + grade VI + section A (class teacher = fixture teacher), fixture student enrolled and guardian-linked. */
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
): Promise<string> {
  const { data, error } = await inst
    .clientAs("admin")
    .from("ptm_events")
    .insert({
      institution_id: inst.institutionId,
      title: "Term PTM",
      event_date: overrides.eventDate ?? isoFuture(14),
      day_starts_at: overrides.dayStartsAt ?? "10:00",
      day_ends_at: overrides.dayEndsAt ?? "10:30",
      slot_minutes: overrides.slotMinutes ?? 10,
      booking_closes_at: overrides.bookingClosesAt ?? new Date(Date.now() + 7 * 86_400_000).toISOString(),
      created_by: inst.users.admin.id,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}

async function addSection(inst: TestInstitution, eventId: string, sectionId: string): Promise<void> {
  const { error } = await inst.clientAs("admin").from("ptm_event_sections").insert({
    event_id: eventId,
    institution_id: inst.institutionId,
    class_section_id: sectionId,
  });
  if (error) throw error;
}

async function publish(inst: TestInstitution, eventId: string): Promise<void> {
  const { error } = await inst.clientAs("admin").from("ptm_events").update({ status: "published" }).eq("id", eventId);
  if (error) throw error;
}

async function insertSlot(client: SupabaseClient, inst: TestInstitution, eventId: string, staffId: string, seq: number, createdBy: string): Promise<string> {
  const { data, error } = await client
    .from("ptm_slots")
    .insert({ institution_id: inst.institutionId, event_id: eventId, staff_id: staffId, seq, created_by: createdBy })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}

async function expectAppError(promise: Promise<unknown>, code: string): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(AppError);
  expect((caught as AppError).code).toBe(code);
}

describe("X08-T6: ptm.events", () => {
  it("lists published events with their class section ids, defaulting to today or later; includePast brings past ones back", async () => {
    const inst = await createTestInstitution("ptm-q-events");
    try {
      const base = await makeBase(inst);
      const futureEventId = await createDraftEvent(inst, { eventDate: isoFuture(14) });
      await addSection(inst, futureEventId, base.sectionA);
      await publish(inst, futureEventId);

      // guard_ptm_events_update only fires on UPDATE and rejects a past
      // cutoff, so a past-but-published fixture must be INSERTed in its
      // final shape directly (service role, raw sql) — only the read side
      // is under test here (mirrors ptm-rls.test.ts's "seed inserts final
      // states" note in the migration's own header comment).
      const [pastEvent] = await sql`
        insert into public.ptm_events (institution_id, title, event_date, day_starts_at, day_ends_at, slot_minutes, booking_closes_at, status, published_at, published_by, created_by)
        values (${inst.institutionId}, 'Past PTM', '2020-01-04', '10:00', '10:30', 10, '2020-01-03T18:00:00+05:30', 'published', now(), ${inst.users.admin.id}, ${inst.users.admin.id})
        returning id
      `;
      const pastEventId = pastEvent.id as string;
      await sql`
        insert into public.ptm_event_sections (event_id, institution_id, class_section_id)
        values (${pastEventId}, ${inst.institutionId}, ${base.sectionA})
      `;

      const ctx = await buildContext(inst, "admin");
      setActingClient(inst.clientAs("admin"));
      try {
        const defaultRows = await ptmEvents(ctx);
        expect(defaultRows.map((r) => r.id)).toEqual([futureEventId]);
        expect(defaultRows[0]).toMatchObject({
          dayStartsAt: "10:00",
          dayEndsAt: "10:30",
          slotMinutes: 10,
          status: "published",
          classSectionIds: [base.sectionA],
        });

        const withPast = await ptmEvents(ctx, true);
        expect(withPast.map((r) => r.id).sort()).toEqual([futureEventId, pastEventId].sort());
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("RLS hides every event from a guardian (staff-only SELECT) regardless of status", async () => {
    const inst = await createTestInstitution("ptm-q-events-guardian");
    try {
      const base = await makeBase(inst);
      const eventId = await createDraftEvent(inst);
      await addSection(inst, eventId, base.sectionA);
      await publish(inst, eventId);

      const ctx = await buildContext(inst, "guardian");
      setActingClient(inst.clientAs("guardian"));
      try {
        const rows = await ptmEvents(ctx, true);
        expect(rows).toEqual([]);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  }, 30_000);
});

describe("X08-T6: ptm.teacherSchedule", () => {
  it("lists own slots with the booked child's name and section; an unbooked slot has booking: null", async () => {
    const inst = await createTestInstitution("ptm-q-schedule");
    try {
      const base = await makeBase(inst);
      const eventId = await createDraftEvent(inst);
      await addSection(inst, eventId, base.sectionA);
      await publish(inst, eventId);

      const teacherClient = inst.clientAs("teacher");
      const slot0 = await insertSlot(teacherClient, inst, eventId, base.teacherStaffId, 0, inst.users.teacher.id);
      await insertSlot(teacherClient, inst, eventId, base.teacherStaffId, 1, inst.users.teacher.id);

      const book = await inst.clientAs("guardian").rpc("book_ptm_slot", { p_slot_id: slot0, p_student_id: base.studentId });
      expect(book.error).toBeNull();

      const ctx = await buildContext(inst, "teacher");
      setActingClient(teacherClient);
      try {
        const schedule = await ptmTeacherSchedule(ctx, eventId);
        expect(schedule).toHaveLength(2);
        const [row0, row1] = [...schedule].sort((a, b) => a.seq - b.seq);
        expect(row0).toMatchObject({ seq: 0, startsAt: "10:00", endsAt: "10:10" });
        expect(row0.booking).toMatchObject({ bookingId: book.data, studentId: base.studentId, sectionName: "Grade VI-A" });
        expect(row0.booking?.studentName.length).toBeGreaterThan(0);
        expect(row1).toMatchObject({ seq: 1, startsAt: "10:10", endsAt: "10:20", booking: null });
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("a teacher asking for another teacher's schedule -> forbidden; an admin asking for it works", async () => {
    const inst = await createTestInstitution("ptm-q-schedule-cross");
    try {
      const base = await makeBase(inst);
      const other = await newTeacher(inst.institutionId, "Other Teacher");
      const sectionB = await createClassSection(inst.institutionId, base.gradeId, base.yearId, { name: "B", classTeacherId: other.staffId });
      const eventId = await createDraftEvent(inst);
      await addSection(inst, eventId, base.sectionA);
      await addSection(inst, eventId, sectionB);
      await publish(inst, eventId);
      await insertSlot(other.client, inst, eventId, other.staffId, 0, other.ctx.user.id);

      const ctx = await buildContext(inst, "teacher");
      setActingClient(inst.clientAs("teacher"));
      try {
        await expectAppError(ptmTeacherSchedule(ctx, eventId, other.staffId), "forbidden");
      } finally {
        setActingClient(null);
      }

      const adminCtx = await buildContext(inst, "admin");
      setActingClient(inst.clientAs("admin"));
      try {
        const schedule = await ptmTeacherSchedule(adminCtx, eventId, other.staffId);
        expect(schedule).toHaveLength(1);
        expect(schedule[0]).toMatchObject({ seq: 0, booking: null });
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("no staffId resolvable and none given -> validation_failed", async () => {
    const inst = await createTestInstitution("ptm-q-schedule-novalid");
    try {
      const base = await makeBase(inst);
      const eventId = await createDraftEvent(inst);
      await addSection(inst, eventId, base.sectionA);
      await publish(inst, eventId);

      // Every fixture role except guardian/student carries a staff_id
      // (tests/helpers/roles.ts) — guardian is the one with none, used
      // here purely to exercise the "no own staffId" branch of the plain
      // query function (bypassing the ptm.slot.manage gate a real request
      // would hit first).
      const ctx = await buildContext(inst, "guardian");
      setActingClient(inst.clientAs("guardian"));
      try {
        await expectAppError(ptmTeacherSchedule(ctx, eventId), "validation_failed");
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  }, 30_000);
});

describe("X08-T6: ptm.forStudent", () => {
  it("a guardian's own child sees mine/taken/open across the event's slots", async () => {
    const inst = await createTestInstitution("ptm-q-forstudent");
    try {
      const base = await makeBase(inst);
      const eventId = await createDraftEvent(inst);
      await addSection(inst, eventId, base.sectionA);
      await publish(inst, eventId);

      const teacherClient = inst.clientAs("teacher");
      const slot0 = await insertSlot(teacherClient, inst, eventId, base.teacherStaffId, 0, inst.users.teacher.id);
      const slot1 = await insertSlot(teacherClient, inst, eventId, base.teacherStaffId, 1, inst.users.teacher.id);
      await insertSlot(teacherClient, inst, eventId, base.teacherStaffId, 2, inst.users.teacher.id);

      const otherFamily = await newFamily(inst.institutionId, base.sectionA, base.yearId, "Other Child");

      const mineBook = await inst.clientAs("guardian").rpc("book_ptm_slot", { p_slot_id: slot0, p_student_id: base.studentId });
      expect(mineBook.error).toBeNull();
      const otherBook = await otherFamily.client.rpc("book_ptm_slot", { p_slot_id: slot1, p_student_id: otherFamily.studentId });
      expect(otherBook.error).toBeNull();

      const ctx = await buildContext(inst, "guardian");
      setActingClient(inst.clientAs("guardian"));
      try {
        const rows = await ptmForStudent(ctx, base.studentId, eventId);
        const bySeq = (seq: number) => rows.find((r) => r.seq === seq)!;
        expect(bySeq(0)).toMatchObject({ state: "mine", bookingId: mineBook.data });
        expect(bySeq(1)).toMatchObject({ state: "taken", bookingId: null });
        expect(bySeq(2)).toMatchObject({ state: "open", bookingId: null });
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("a guardian asking for another family's child -> forbidden", async () => {
    const inst = await createTestInstitution("ptm-q-forstudent-cross");
    try {
      const base = await makeBase(inst);
      const otherFamily = await newFamily(inst.institutionId, base.sectionA, base.yearId, "Not Mine");

      const ctx = await buildContext(inst, "guardian");
      setActingClient(inst.clientAs("guardian"));
      try {
        await expectAppError(ptmForStudent(ctx, otherFamily.studentId), "forbidden");
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  }, 30_000);
});
