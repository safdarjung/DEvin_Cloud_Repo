// M13-T10 — src/modules/calendar/queries.ts, called directly as a plain
// query function (not via HTTP), same buildContext + setActingClient
// pattern as tests/db/timetable-queries.test.ts. RLS (0075) does the real
// audience narrowing; these assertions are the acceptance list in
// M13-tasks.md Task 10.
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { buildContext } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";
import { calendarForRole } from "@/modules/calendar/queries";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function createEvent(
  inst: TestInstitution,
  academicYearId: string,
  overrides: Partial<{ kind: string; title: string; startsOn: string; endsOn: string; audience: string }> = {},
): Promise<string> {
  const [row] = await sql`
    insert into public.academic_calendar_events (institution_id, academic_year_id, kind, title, starts_on, ends_on, audience, created_by)
    values (
      ${inst.institutionId}, ${academicYearId}, ${overrides.kind ?? "event"}, ${overrides.title ?? "Event"},
      ${overrides.startsOn ?? "2026-11-10"}, ${overrides.endsOn ?? "2026-11-10"}, ${overrides.audience ?? "all"},
      ${inst.users.owner.id}
    )
    returning id
  `;
  return row.id as string;
}

describe("calendar.forRole (src/modules/calendar/queries.ts)", () => {
  it("staff sees staff and all-audience events; guardian sees only audience all", async () => {
    const inst = await createTestInstitution("cal-audience");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      await createEvent(inst, yearId, { title: "Staff training", audience: "staff" });
      await createEvent(inst, yearId, { title: "PTM", audience: "all" });

      const staffCtx = await buildContext(inst, "teacher");
      setActingClient(inst.clientAs("teacher"));
      try {
        const staffRows = await calendarForRole(staffCtx, {});
        expect(staffRows.map((r) => r.title).sort()).toEqual(["PTM", "Staff training"]);
      } finally {
        setActingClient(null);
      }

      const guardianCtx = await buildContext(inst, "guardian");
      setActingClient(inst.clientAs("guardian"));
      try {
        const guardianRows = await calendarForRole(guardianCtx, {});
        expect(guardianRows.map((r) => r.title)).toEqual(["PTM"]);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("an event starting before `from` and ending inside the window is included", async () => {
    const inst = await createTestInstitution("cal-overlap");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      await createEvent(inst, yearId, { title: "Exam week", kind: "exam_week", startsOn: "2026-11-01", endsOn: "2026-11-10" });

      const ctx = await buildContext(inst, "owner");
      setActingClient(inst.clientAs("owner"));
      try {
        const rows = await calendarForRole(ctx, { from: "2026-11-05", to: "2026-11-20" });
        expect(rows.map((r) => r.title)).toEqual(["Exam week"]);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("kinds filter works", async () => {
    const inst = await createTestInstitution("cal-kinds");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      await createEvent(inst, yearId, { title: "Diwali", kind: "holiday", startsOn: "2026-11-10", endsOn: "2026-11-10" });
      await createEvent(inst, yearId, { title: "Annual Day", kind: "event", startsOn: "2026-11-12", endsOn: "2026-11-12" });

      const ctx = await buildContext(inst, "owner");
      setActingClient(inst.clientAs("owner"));
      try {
        const rows = await calendarForRole(ctx, { from: "2026-11-01", to: "2026-11-30", kinds: ["holiday"] });
        expect(rows.map((r) => r.title)).toEqual(["Diwali"]);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("default window (today .. today + 90 days, institution timezone) with a mocked clock", async () => {
    const inst = await createTestInstitution("cal-default-window");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      // 2026-11-02T03:30:00Z = Mon 09:00 IST (default timezone Asia/Kolkata) -> "today" = 2026-11-02.
      await createEvent(inst, yearId, { title: "Too early", startsOn: "2026-10-01", endsOn: "2026-10-31" });
      await createEvent(inst, yearId, { title: "In window", startsOn: "2026-11-15", endsOn: "2026-11-15" });
      await createEvent(inst, yearId, { title: "Too late", startsOn: "2027-02-10", endsOn: "2027-02-10" });

      const ctx = await buildContext(inst, "owner");
      setActingClient(inst.clientAs("owner"));
      vi.setSystemTime(new Date("2026-11-02T03:30:00Z"));
      try {
        const rows = await calendarForRole(ctx, {});
        expect(rows.map((r) => r.title)).toEqual(["In window"]);
      } finally {
        vi.useRealTimers();
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });
});
