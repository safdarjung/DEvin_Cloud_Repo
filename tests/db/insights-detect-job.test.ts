// M19-T14 — job `insights.detect`: real admin client + real `record_insights`
// rpc, fixture institution with a `plantAttendance` student drop (same
// fixture shape as T4's insight_src_attendance test). Module gating and
// detector-failure isolation are exercised against the real DB; only the
// `marksDetector.run` spy is a unit-level seam (same object the registry
// imports — module instances are cached across the `@/` alias).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";
import { insightsDetect } from "@/modules/jobs/handlers/insights.detect";
import type { JobRow } from "@/modules/jobs/types";
import { marksDetector } from "@/modules/insights/detectors/marks";
import { plantAcademicSetup, plantAttendance, plantStudent } from "../helpers/insight-fixtures";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

function adminClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
}

// 05 §4.1 default statuses, mirrors insight-sources-academic.test.ts.
const ATTENDANCE_STATUSES = [
  { code: "P", label: "Present", counts_present: 1, in_denominator: true },
  { code: "A", label: "Absent", counts_present: 0, in_denominator: true },
];

async function setAttendanceStatuses(institutionId: string): Promise<void> {
  await sql`
    update public.institutions
    set settings = settings || jsonb_build_object('attendance', jsonb_build_object('statuses', ${sql.json(ATTENDANCE_STATUSES)}::jsonb))
    where id = ${institutionId}
  `;
}

/** Flips one module key in-place; keeps every other key `createTestInstitution` set (`allModulesOn`). */
async function setModule(institutionId: string, key: string, on: boolean): Promise<void> {
  await sql`
    update public.institutions
    set settings = jsonb_set(settings, array['modules', ${key}]::text[], to_jsonb(${on}))
    where id = ${institutionId}
  `;
}

function makeJob(institutionId: string, payload: Record<string, unknown>): JobRow {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    institution_id: institutionId,
    type: "insights.detect",
    payload,
    idempotency_key: `test:${crypto.randomUUID()}`,
    status: "running",
    attempts: 1,
    max_attempts: 5,
    run_after: now,
    locked_at: now,
    locked_by: "test-worker",
    last_error: null,
    created_at: now,
    updated_at: now,
  };
}

/** Plants one section + one student whose last 7 days (3P/4A) drop well
 * below a 100%-present 10-day baseline — fires `attendance.student_drop`. */
async function plantStudentDrop(institutionId: string, asOf: string): Promise<void> {
  await setAttendanceStatuses(institutionId);
  const setup = await plantAcademicSetup(sql, institutionId);
  const studentId = await plantStudent(sql, institutionId, setup.classSectionId, setup.academicYearId);
  const recentSessions = Array.from({ length: 7 }, (_, i) => ({
    daysAgo: i,
    records: { [studentId]: i < 3 ? "P" : "A" },
  }));
  const baseSessions = Array.from({ length: 10 }, (_, i) => ({
    daysAgo: 7 + i,
    records: { [studentId]: "P" },
  }));
  await plantAttendance(sql, institutionId, setup.classSectionId, asOf, [...recentSessions, ...baseSessions]);
}

async function studentDropRows(institutionId: string) {
  return sql`
    select status, detector_version, confidence, evidence
    from public.insights
    where institution_id = ${institutionId} and signal = 'attendance.student_drop'
  `;
}

describe("job insights.detect", () => {
  it("writes one attendance.student_drop row; a rerun inserts no new row", async () => {
    const inst = await createTestInstitution("insights-detect-drop");
    const admin = adminClient();
    try {
      const asOf = "2026-11-20";
      await plantStudentDrop(inst.institutionId, asOf);

      await insightsDetect(makeJob(inst.institutionId, { as_of: asOf }), { admin });

      const rows = await studentDropRows(inst.institutionId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: "new", detector_version: 1 });
      expect(Number(rows[0].confidence)).toBeGreaterThanOrEqual(0);
      expect(Number(rows[0].confidence)).toBeLessThanOrEqual(1);
      expect(Array.isArray(rows[0].evidence)).toBe(true);
      expect((rows[0].evidence as unknown[]).length).toBeGreaterThan(0);

      // Rerun with the same as_of: dedupe key unchanged, no second row.
      await insightsDetect(makeJob(inst.institutionId, { as_of: asOf }), { admin });
      expect(await studentDropRows(inst.institutionId)).toHaveLength(1);
    } finally {
      await inst.cleanup();
    }
  });

  it("insights module off: writes zero rows", async () => {
    const inst = await createTestInstitution("insights-detect-off");
    const admin = adminClient();
    try {
      const asOf = "2026-11-20";
      await plantStudentDrop(inst.institutionId, asOf);
      await setModule(inst.institutionId, "insights", false);

      await insightsDetect(makeJob(inst.institutionId, { as_of: asOf }), { admin });

      expect(await studentDropRows(inst.institutionId)).toHaveLength(0);
    } finally {
      await inst.cleanup();
    }
  });

  it("exams module off: marksDetector.run is not called", async () => {
    const inst = await createTestInstitution("insights-detect-exams-off");
    const admin = adminClient();
    const runSpy = vi.spyOn(marksDetector, "run");
    try {
      await setModule(inst.institutionId, "exams", false);

      await insightsDetect(makeJob(inst.institutionId, { as_of: "2026-11-20" }), { admin });

      expect(runSpy).not.toHaveBeenCalled();
    } finally {
      runSpy.mockRestore();
      await inst.cleanup();
    }
  });

  it("a detector throwing does not lose the others' rows, and the handler throws with the failed key", async () => {
    const inst = await createTestInstitution("insights-detect-partial-fail");
    const admin = adminClient();
    const runSpy = vi.spyOn(marksDetector, "run").mockRejectedValue(new Error("boom"));
    try {
      const asOf = "2026-11-20";
      await plantStudentDrop(inst.institutionId, asOf);

      await expect(insightsDetect(makeJob(inst.institutionId, { as_of: asOf }), { admin })).rejects.toThrow(
        "detectors failed: marks",
      );

      // attendance ran before marks (Signals-table order) and is unaffected.
      expect(await studentDropRows(inst.institutionId)).toHaveLength(1);
    } finally {
      runSpy.mockRestore();
      await inst.cleanup();
    }
  });

  it("a bad payload throws before any rpc call", async () => {
    const inst = await createTestInstitution("insights-detect-bad-payload");
    const admin = adminClient();
    const fromSpy = vi.spyOn(admin, "from");
    try {
      await expect(insightsDetect(makeJob(inst.institutionId, {}), { admin })).rejects.toThrow();
      expect(fromSpy).not.toHaveBeenCalled();
    } finally {
      fromSpy.mockRestore();
      await inst.cleanup();
    }
  });
});
