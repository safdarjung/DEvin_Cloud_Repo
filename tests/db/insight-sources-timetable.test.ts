// M19-T6 — migration 0092 part 5: insight_src_workload,
// insight_src_room_capacity, insight_src_rooms, enqueue_insight_detection.
// Real signed-in clients + real RLS/grants, same pattern as
// insight-sources-office.test.ts.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { plantAcademicSetup, plantStudent, plantTimetable } from "../helpers/insight-fixtures";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

function adminClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
}

async function teacherStaffId(institutionId: string): Promise<string> {
  const [row] = await sql`select staff_id from public.memberships where institution_id = ${institutionId} and role = 'teacher'`;
  return row.staff_id as string;
}

/** Calendar date (YYYY-MM-DD) of `d` in Asia/Kolkata — the test
 * institutions' default timezone, matching the sweep's `tz` fallback. */
function istDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

interface WorkloadRow {
  version_id: string;
  staff_id: string;
  periods_week: number;
}

describe("0092 part 5: insight_src_workload", () => {
  it("counts slots per teacher in the published version covering as_of; a draft version is ignored", async () => {
    const inst = await createTestInstitution("insight-src-workload");
    const admin = adminClient();
    try {
      const setup = await plantAcademicSetup(sql, inst.institutionId);
      const teacherId = await teacherStaffId(inst.institutionId);
      const asOf = "2026-11-20";

      const published = await plantTimetable(sql, inst.institutionId, setup.academicYearId, inst.users.admin.id, {
        periods: [{ seq: 1 }, { seq: 2 }],
        status: "published",
        slots: [
          { weekday: 1, periodSeq: 1, teacherStaffId: teacherId, classSectionId: setup.classSectionId, subjectId: setup.subjectId },
          { weekday: 2, periodSeq: 2, teacherStaffId: teacherId, classSectionId: setup.classSectionId, subjectId: setup.subjectId },
        ],
      });

      // A draft version with an extra slot for the same teacher must not count.
      await plantTimetable(sql, inst.institutionId, setup.academicYearId, inst.users.admin.id, {
        periods: [{ seq: 3 }],
        status: "draft",
        slots: [{ weekday: 3, periodSeq: 3, teacherStaffId: teacherId, classSectionId: setup.classSectionId, subjectId: setup.subjectId }],
      });

      const { data, error } = await admin.rpc("insight_src_workload", { p_institution_id: inst.institutionId, p_as_of: asOf });
      expect(error).toBeNull();
      const rows = data as WorkloadRow[];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ version_id: published.versionId, staff_id: teacherId, periods_week: 2 });
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("no published version in the as_of year => empty", async () => {
    const inst = await createTestInstitution("insight-src-workload-empty");
    const admin = adminClient();
    try {
      const setup = await plantAcademicSetup(sql, inst.institutionId);
      const teacherId = await teacherStaffId(inst.institutionId);
      await plantTimetable(sql, inst.institutionId, setup.academicYearId, inst.users.admin.id, {
        periods: [{ seq: 1 }],
        status: "draft",
        slots: [{ weekday: 1, periodSeq: 1, teacherStaffId: teacherId, classSectionId: setup.classSectionId, subjectId: setup.subjectId }],
      });

      const { data, error } = await admin.rpc("insight_src_workload", { p_institution_id: inst.institutionId, p_as_of: "2026-11-20" });
      expect(error).toBeNull();
      expect(data).toEqual([]);
    } finally {
      await inst.cleanup();
    }
  });

  it("is denied for an authenticated caller", async () => {
    const inst = await createTestInstitution("insight-src-workload-denied");
    try {
      const { data, error } = await inst
        .clientAs("principal")
        .rpc("insight_src_workload", { p_institution_id: inst.institutionId, p_as_of: "2026-11-20" });
      expect(error).not.toBeNull();
      expect(data).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });
});

interface RoomCapacityRow {
  version_id: string;
  class_section_id: string;
  section_label: string;
  strength: number;
  smallest_capacity: number;
  slots_over: number;
}

describe("0092 part 5: insight_src_room_capacity", () => {
  it("strength 40 in a 30-seat room => flagged, with the correct smallest_capacity and slots_over", async () => {
    const inst = await createTestInstitution("insight-src-roomcap");
    const admin = adminClient();
    try {
      const setup = await plantAcademicSetup(sql, inst.institutionId);
      const teacherId = await teacherStaffId(inst.institutionId);
      for (let i = 0; i < 40; i++) {
        await plantStudent(sql, inst.institutionId, setup.classSectionId, setup.academicYearId);
      }

      const plant = await plantTimetable(sql, inst.institutionId, setup.academicYearId, inst.users.admin.id, {
        periods: [{ seq: 1 }, { seq: 2 }],
        rooms: [{ name: "Room-30", capacity: 30 }],
        status: "published",
        slots: [
          {
            weekday: 1,
            periodSeq: 1,
            teacherStaffId: teacherId,
            classSectionId: setup.classSectionId,
            subjectId: setup.subjectId,
            roomName: "Room-30",
          },
        ],
      });

      const { data, error } = await admin.rpc("insight_src_room_capacity", { p_institution_id: inst.institutionId, p_as_of: "2026-11-20" });
      expect(error).toBeNull();
      const rows = data as RoomCapacityRow[];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        version_id: plant.versionId,
        class_section_id: setup.classSectionId,
        section_label: setup.sectionLabel,
        strength: 40,
        smallest_capacity: 30,
        slots_over: 1,
      });
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("strength within every assigned room's capacity => excluded", async () => {
    const inst = await createTestInstitution("insight-src-roomcap-ok");
    const admin = adminClient();
    try {
      const setup = await plantAcademicSetup(sql, inst.institutionId);
      const teacherId = await teacherStaffId(inst.institutionId);
      for (let i = 0; i < 20; i++) {
        await plantStudent(sql, inst.institutionId, setup.classSectionId, setup.academicYearId);
      }

      await plantTimetable(sql, inst.institutionId, setup.academicYearId, inst.users.admin.id, {
        periods: [{ seq: 1 }],
        rooms: [{ name: "Room-30", capacity: 30 }],
        status: "published",
        slots: [
          {
            weekday: 1,
            periodSeq: 1,
            teacherStaffId: teacherId,
            classSectionId: setup.classSectionId,
            subjectId: setup.subjectId,
            roomName: "Room-30",
          },
        ],
      });

      const { data, error } = await admin.rpc("insight_src_room_capacity", { p_institution_id: inst.institutionId, p_as_of: "2026-11-20" });
      expect(error).toBeNull();
      expect(data).toEqual([]);
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("is denied for an authenticated caller", async () => {
    const inst = await createTestInstitution("insight-src-roomcap-denied");
    try {
      const { data, error } = await inst
        .clientAs("principal")
        .rpc("insight_src_room_capacity", { p_institution_id: inst.institutionId, p_as_of: "2026-11-20" });
      expect(error).not.toBeNull();
      expect(data).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });
});

interface RoomsRow {
  version_id: string;
  room_id: string;
  room_name: string;
  periods_used: number;
  periods_total: number;
  open_maintenance: number;
}

describe("0092 part 5: insight_src_rooms", () => {
  it("periods_total = 6x non-break periods; periods_used per room; open_maintenance via assets.room_id", async () => {
    const inst = await createTestInstitution("insight-src-rooms");
    const admin = adminClient();
    try {
      const setup = await plantAcademicSetup(sql, inst.institutionId);
      const teacherId = await teacherStaffId(inst.institutionId);

      const plant = await plantTimetable(sql, inst.institutionId, setup.academicYearId, inst.users.admin.id, {
        periods: [{ seq: 1 }, { seq: 2 }, { seq: 3, isBreak: true }],
        rooms: [
          { name: "Room-A", capacity: 30 },
          { name: "Room-B", capacity: 30 },
        ],
        status: "published",
        slots: [
          {
            weekday: 1,
            periodSeq: 1,
            teacherStaffId: teacherId,
            classSectionId: setup.classSectionId,
            subjectId: setup.subjectId,
            roomName: "Room-A",
          },
          {
            weekday: 2,
            periodSeq: 2,
            teacherStaffId: teacherId,
            classSectionId: setup.classSectionId,
            subjectId: setup.subjectId,
            roomName: "Room-A",
          },
        ],
      });

      const [asset] = await sql`
        insert into public.assets (institution_id, name, category, room_id)
        values (${inst.institutionId}, 'Projector', 'electrical', ${plant.roomIds["Room-A"]})
        returning id
      `;
      await sql`
        insert into public.maintenance_requests (institution_id, asset_id, issue, status, raised_by)
        values (${inst.institutionId}, ${asset.id}, 'Insight fixture repair', 'open', ${inst.users.admin.id})
      `;

      const { data, error } = await admin.rpc("insight_src_rooms", { p_institution_id: inst.institutionId, p_as_of: "2026-11-20" });
      expect(error).toBeNull();
      const rows = data as RoomsRow[];
      expect(rows).toHaveLength(2);

      const roomA = rows.find((r) => r.room_id === plant.roomIds["Room-A"]);
      const roomB = rows.find((r) => r.room_id === plant.roomIds["Room-B"]);
      // 2 non-break periods x 6 weekdays = 12.
      expect(roomA).toMatchObject({ version_id: plant.versionId, periods_used: 2, periods_total: 12, open_maintenance: 1 });
      expect(roomB).toMatchObject({ version_id: plant.versionId, periods_used: 0, periods_total: 12, open_maintenance: 0 });
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("no published version covering as_of => empty", async () => {
    const inst = await createTestInstitution("insight-src-rooms-empty");
    const admin = adminClient();
    try {
      const setup = await plantAcademicSetup(sql, inst.institutionId);
      const teacherId = await teacherStaffId(inst.institutionId);
      await plantTimetable(sql, inst.institutionId, setup.academicYearId, inst.users.admin.id, {
        periods: [{ seq: 1 }],
        rooms: [{ name: "Room-A", capacity: 30 }],
        status: "draft",
        slots: [
          {
            weekday: 1,
            periodSeq: 1,
            teacherStaffId: teacherId,
            classSectionId: setup.classSectionId,
            subjectId: setup.subjectId,
            roomName: "Room-A",
          },
        ],
      });

      const { data, error } = await admin.rpc("insight_src_rooms", { p_institution_id: inst.institutionId, p_as_of: "2026-11-20" });
      expect(error).toBeNull();
      expect(data).toEqual([]);
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("is denied for an authenticated caller", async () => {
    const inst = await createTestInstitution("insight-src-rooms-denied");
    try {
      const { data, error } = await inst
        .clientAs("principal")
        .rpc("insight_src_rooms", { p_institution_id: inst.institutionId, p_as_of: "2026-11-20" });
      expect(error).not.toBeNull();
      expect(data).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });
});

describe("0092 part 5: enqueue_insight_detection (Sweep)", () => {
  it("insights on: one job keyed by local yesterday; a second call enqueues nothing more", async () => {
    const inst = await createTestInstitution("insight-sweep-on");
    const admin = adminClient();
    try {
      await sql`
        update public.institutions
        set settings = jsonb_set(coalesce(settings, '{}'::jsonb), array['modules', 'insights'], 'true'::jsonb)
        where id = ${inst.institutionId}
      `;

      // The sweep is global (it loops every institution with the module on),
      // so the seeded demo tenant contributes too — assert our own
      // institution's row, not the raw total.
      const first = await admin.rpc("enqueue_insight_detection");
      expect(first.error).toBeNull();
      expect(first.data as number).toBeGreaterThanOrEqual(1);

      const expectedAsOf = istDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
      const [job] = await sql`
        select payload, idempotency_key from public.jobs
        where type = 'insights.detect' and institution_id = ${inst.institutionId}
      `;
      expect(job).toBeDefined();
      expect(job.payload.as_of).toBe(expectedAsOf);
      expect(job.idempotency_key).toBe(`insights.detect:${inst.institutionId}:${expectedAsOf.replace(/-/g, "")}`);

      const second = await admin.rpc("enqueue_insight_detection");
      expect(second.error).toBeNull();
      expect(second.data).toBe(0);

      const jobs = await sql`select id from public.jobs where type = 'insights.detect' and institution_id = ${inst.institutionId}`;
      expect(jobs).toHaveLength(1);
    } finally {
      await inst.cleanup();
    }
  });

  it("insights off: no job", async () => {
    // createTestInstitution turns every optional module on by default
    // (tests/helpers/roles.ts allModulesOn()) — explicitly flip this one off.
    const inst = await createTestInstitution("insight-sweep-off");
    const admin = adminClient();
    try {
      await sql`
        update public.institutions
        set settings = jsonb_set(coalesce(settings, '{}'::jsonb), array['modules', 'insights'], 'false'::jsonb)
        where id = ${inst.institutionId}
      `;

      const { data, error } = await admin.rpc("enqueue_insight_detection");
      expect(error).toBeNull();
      expect(data).toBe(0);

      const jobs = await sql`select id from public.jobs where type = 'insights.detect' and institution_id = ${inst.institutionId}`;
      expect(jobs).toHaveLength(0);
    } finally {
      await inst.cleanup();
    }
  });

  it("is denied for an authenticated caller", async () => {
    const inst = await createTestInstitution("insight-sweep-denied");
    try {
      const { data, error } = await inst.clientAs("principal").rpc("enqueue_insight_detection");
      expect(error).not.toBeNull();
      expect(data).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });
});
