import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mock (T-022 lead review pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { createVersion, publishVersion, saveDraft, upsertPeriod, upsertRoom } from "@/modules/timetable/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createGrade, createSubject } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

// M07-T4 — timetable.room.upsert / timetable.period.upsert /
// timetable.version.create / timetable.saveDraft / timetable.publish.
// Columns exactly as 0069: rooms.{name, capacity}, periods.{seq, name,
// starts_at, ends_at, is_break}, timetable_versions.{academic_year_id, name,
// status}, timetable_slots.{class_section_id, teacher_id, room_id, weekday,
// period_id} — conflicts are the table's own unique constraints (23505),
// not application logic.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

async function createStaffRow(institutionId: string, fullName = "Test Teacher"): Promise<string> {
  const [row] = await sql`
    insert into public.staff (institution_id, employee_no, full_name, designation)
    values (${institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, ${fullName}, 'Teacher')
    returning id
  `;
  return row.id as string;
}

async function setupSection(institutionId: string, name: string): Promise<{ yearId: string; sectionId: string; subjectId: string }> {
  const yearId = await createAcademicYear(institutionId);
  const gradeId = await createGrade(institutionId);
  const sectionId = await createClassSection(institutionId, gradeId, yearId, { name });
  const subjectId = await createSubject(institutionId);
  return { yearId, sectionId, subjectId };
}

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

describe("timetable actions (M07-T4)", () => {
  it("admin builds rooms/periods/version, saves a draft, and publishes it", async () => {
    const inst = await createTestInstitution("timetable-actions-happy");
    const { yearId, sectionId, subjectId } = await setupSection(inst.institutionId, "A");
    const teacherId = await createStaffRow(inst.institutionId);

    const room = await callAs(inst, "admin", upsertRoom, { name: "Room 101", capacity: 40 });
    expect(room.ok).toBe(true);
    if (!room.ok) return;

    const period = await callAs(inst, "admin", upsertPeriod, { seq: 1, name: "Period 1", startsAt: "08:00", endsAt: "08:40" });
    expect(period.ok).toBe(true);
    if (!period.ok) return;

    const version = await callAs(inst, "admin", createVersion, { academicYearId: yearId, name: "Draft v1" });
    expect(version.ok).toBe(true);
    if (!version.ok) return;
    expect(version.data.status).toBe("draft");

    const saved = await callAs(inst, "admin", saveDraft, {
      versionId: version.data.id,
      slots: [
        {
          classSectionId: sectionId,
          weekday: 1,
          periodId: period.data.id,
          subjectId,
          teacherId,
          roomId: room.data.id,
        },
      ],
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.data.slotCount).toBe(1);

    const published = await callAs(inst, "admin", publishVersion, { versionId: version.data.id });
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    expect(published.data.status).toBe("published");

    await inst.cleanup();
  });

  it("a teacher double-booked across two sections is a conflict naming the teacher", async () => {
    const inst = await createTestInstitution("timetable-actions-teacher-conflict");
    const { yearId, sectionId: sectionA, subjectId } = await setupSection(inst.institutionId, "A");
    const gradeId = await createGrade(inst.institutionId, { code: "VII", sortKey: 7 });
    const sectionB = await createClassSection(inst.institutionId, gradeId, yearId, { name: "B" });
    const teacherId = await createStaffRow(inst.institutionId);

    const period = await callAs(inst, "admin", upsertPeriod, { seq: 1, name: "Period 1", startsAt: "08:00", endsAt: "08:40" });
    expect(period.ok).toBe(true);
    if (!period.ok) return;

    const version = await callAs(inst, "admin", createVersion, { academicYearId: yearId, name: "Draft v1" });
    expect(version.ok).toBe(true);
    if (!version.ok) return;

    const first = await callAs(inst, "admin", saveDraft, {
      versionId: version.data.id,
      slots: [{ classSectionId: sectionA, weekday: 1, periodId: period.data.id, subjectId, teacherId }],
    });
    expect(first.ok).toBe(true);

    const second = await callAs(inst, "admin", saveDraft, {
      versionId: version.data.id,
      slots: [{ classSectionId: sectionB, weekday: 1, periodId: period.data.id, subjectId, teacherId }],
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe("conflict");
    expect(second.error.fieldErrors?.slots?.[0]).toContain("teacher");

    await inst.cleanup();
  });

  it("a teacher is forbidden from saving a draft", async () => {
    const inst = await createTestInstitution("timetable-actions-teacher-forbidden");
    const { yearId } = await setupSection(inst.institutionId, "A");

    const version = await callAs(inst, "admin", createVersion, { academicYearId: yearId, name: "Draft v1" });
    expect(version.ok).toBe(true);
    if (!version.ok) return;

    const result = await callAs(inst, "teacher", saveDraft, {
      versionId: version.data.id,
      slots: [
        {
          classSectionId: crypto.randomUUID(),
          weekday: 1,
          periodId: crypto.randomUUID(),
          subjectId: crypto.randomUUID(),
          teacherId: crypto.randomUUID(),
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("forbidden");

    await inst.cleanup();
  });

  it("saveDraft on a published version is rejected as invalid_state", async () => {
    const inst = await createTestInstitution("timetable-actions-invalid-state");
    const { yearId, sectionId, subjectId } = await setupSection(inst.institutionId, "A");
    const teacherId = await createStaffRow(inst.institutionId);

    const period = await callAs(inst, "admin", upsertPeriod, { seq: 1, name: "Period 1", startsAt: "08:00", endsAt: "08:40" });
    expect(period.ok).toBe(true);
    if (!period.ok) return;

    const version = await callAs(inst, "admin", createVersion, { academicYearId: yearId, name: "Draft v1" });
    expect(version.ok).toBe(true);
    if (!version.ok) return;

    const saved = await callAs(inst, "admin", saveDraft, {
      versionId: version.data.id,
      slots: [{ classSectionId: sectionId, weekday: 1, periodId: period.data.id, subjectId, teacherId }],
    });
    expect(saved.ok).toBe(true);

    const published = await callAs(inst, "admin", publishVersion, { versionId: version.data.id });
    expect(published.ok).toBe(true);

    const result = await callAs(inst, "admin", saveDraft, {
      versionId: version.data.id,
      slots: [{ classSectionId: sectionId, weekday: 2, periodId: period.data.id, subjectId, teacherId }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_state");

    await inst.cleanup();
  });
});
