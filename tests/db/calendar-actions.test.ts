import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mock (T-022 lead review pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { upsertCalendarEvent, deleteCalendarEvent } from "@/modules/calendar/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions } from "../helpers/roles";

// M13-T7 — calendar.event.upsert / calendar.event.delete. Column names
// exactly as 0075: academic_calendar_events.{academic_year_id, kind, title,
// description, starts_on, ends_on, audience, created_by}.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

describe("calendar actions (M13-T7)", () => {
  it("admin creates a holiday and a staff-only event", async () => {
    const inst = await createTestInstitution("calendar-actions-happy");
    const yearId = await createAcademicYear(inst.institutionId);

    const holiday = await callAs(inst, "admin", upsertCalendarEvent, {
      academicYearId: yearId,
      kind: "holiday",
      title: "Independence Day",
      startsOn: "2026-08-15",
      endsOn: "2026-08-15",
      audience: "all",
    });
    expect(holiday.ok).toBe(true);
    if (!holiday.ok) return;

    const staffEvent = await callAs(inst, "admin", upsertCalendarEvent, {
      academicYearId: yearId,
      kind: "ptm",
      title: "Staff planning meeting",
      startsOn: "2026-09-01",
      endsOn: "2026-09-01",
      audience: "staff",
    });
    expect(staffEvent.ok).toBe(true);
    if (!staffEvent.ok) return;
    expect(staffEvent.data.id).not.toBe(holiday.data.id);
  });

  it("an event outside the academic year is validation_failed", async () => {
    const inst = await createTestInstitution("calendar-actions-outside-year");
    const yearId = await createAcademicYear(inst.institutionId); // 2026-04-01..2027-03-31

    const result = await callAs(inst, "admin", upsertCalendarEvent, {
      academicYearId: yearId,
      kind: "event",
      title: "Too early",
      startsOn: "2026-01-01",
      endsOn: "2026-01-02",
      audience: "all",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation_failed");
  });

  it("an academic year from another institution is forbidden", async () => {
    await withTwoInstitutions(async (instA, instB) => {
      const yearB = await createAcademicYear(instB.institutionId);

      const result = await callAs(instA, "admin", upsertCalendarEvent, {
        academicYearId: yearB,
        kind: "event",
        title: "Cross-institution",
        startsOn: "2026-04-10",
        endsOn: "2026-04-10",
        audience: "all",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    });
  });

  it("a teacher is forbidden from creating a calendar event", async () => {
    const inst = await createTestInstitution("calendar-actions-teacher-forbidden");
    const yearId = await createAcademicYear(inst.institutionId);

    const result = await callAs(inst, "teacher", upsertCalendarEvent, {
      academicYearId: yearId,
      kind: "event",
      title: "Probe",
      startsOn: "2026-04-10",
      endsOn: "2026-04-10",
      audience: "all",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("forbidden");
  });

  it("deleting the same event twice returns not_found the second time", async () => {
    const inst = await createTestInstitution("calendar-actions-delete-twice");
    const yearId = await createAcademicYear(inst.institutionId);

    const created = await callAs(inst, "admin", upsertCalendarEvent, {
      academicYearId: yearId,
      kind: "event",
      title: "To delete",
      startsOn: "2026-04-10",
      endsOn: "2026-04-10",
      audience: "all",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const first = await callAs(inst, "admin", deleteCalendarEvent, { id: created.data.id });
    expect(first.ok).toBe(true);

    const second = await callAs(inst, "admin", deleteCalendarEvent, { id: created.data.id });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe("not_found");
  });

  it("an update changes dates in place (same id)", async () => {
    const inst = await createTestInstitution("calendar-actions-update");
    const yearId = await createAcademicYear(inst.institutionId);

    const created = await callAs(inst, "admin", upsertCalendarEvent, {
      academicYearId: yearId,
      kind: "event",
      title: "Sports day",
      startsOn: "2026-04-10",
      endsOn: "2026-04-10",
      audience: "all",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const updated = await callAs(inst, "admin", upsertCalendarEvent, {
      id: created.data.id,
      academicYearId: yearId,
      kind: "event",
      title: "Sports day",
      startsOn: "2026-04-20",
      endsOn: "2026-04-21",
      audience: "all",
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.data.id).toBe(created.data.id);

    const [row] = await sql`
      select starts_on::text, ends_on::text from public.academic_calendar_events where id = ${created.data.id}
    `;
    expect(row.starts_on).toBe("2026-04-20");
    expect(row.ends_on).toBe("2026-04-21");
  });
});
