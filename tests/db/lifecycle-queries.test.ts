// M14-T8 — src/modules/lifecycle/queries.ts, called directly as a plain
// query function (not via HTTP; mirrors tests/db/timetable-queries.test.ts's
// buildContext + setActingClient pattern). RLS (0076
// student_lifecycle_events_select + 0025 enrolments_select) is the only
// narrowing the query relies on.
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { buildContext } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createEnrolment, createGrade } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";
import { lifecycleHistory } from "@/modules/lifecycle/queries";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function insertStudent(institutionId: string, admissionNo: string): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo}, 'Test Student', '2016-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

async function insertEvent(
  inst: TestInstitution,
  studentId: string,
  overrides: Partial<{
    kind: string;
    batchId: string | null;
    fromEnrolmentId: string | null;
    toEnrolmentId: string | null;
    effectiveOn: string;
    reason: string | null;
    tcNo: string | null;
    tcSnapshot: Record<string, unknown> | null;
  }> = {},
): Promise<string> {
  const kind = overrides.kind ?? "withdrawn";
  const tcNo = overrides.tcNo ?? (kind === "promoted" || kind === "graduated" ? null : `TC/TEST/${crypto.randomUUID().slice(0, 8)}`);
  const tcSnapshot = overrides.tcSnapshot ?? (tcNo ? {} : null);
  const [row] = await sql`
    insert into public.student_lifecycle_events
      (institution_id, student_id, kind, batch_id, from_enrolment_id, to_enrolment_id, effective_on, reason, tc_no, tc_snapshot, created_by)
    values
      (${inst.institutionId}, ${studentId}, ${kind}, ${overrides.batchId ?? null}, ${overrides.fromEnrolmentId ?? null}, ${overrides.toEnrolmentId ?? null},
       ${overrides.effectiveOn ?? "2026-06-01"}, ${overrides.reason ?? null}, ${tcNo}, ${tcSnapshot ? sql.json(tcSnapshot as unknown as postgres.JSONValue) : null}, ${inst.users.admin.id})
    returning id
  `;
  return row.id as string;
}

describe("lifecycle.history query (M14-T8)", () => {
  it("admin sees the completed and the active enrolment plus the promoted event", async () => {
    const inst = await createTestInstitution("lc-hist-admin");
    try {
      const yearA = await createAcademicYear(inst.institutionId, { name: "2025-26", startsOn: "2025-04-01", endsOn: "2026-03-31", isCurrent: false });
      const yearB = await createAcademicYear(inst.institutionId, { name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: true });
      const gradeId = await createGrade(inst.institutionId);
      const sectionA = await createClassSection(inst.institutionId, gradeId, yearA, { name: "A" });
      const sectionB = await createClassSection(inst.institutionId, gradeId, yearB, { name: "B" });
      const studentId = await insertStudent(inst.institutionId, "ADM-LH1");

      const [completed] = await sql`
        insert into public.enrolments (institution_id, student_id, class_section_id, academic_year_id, roll_no, started_on, ended_on, status)
        values (${inst.institutionId}, ${studentId}, ${sectionA}, ${yearA}, 1, '2025-04-01', '2026-03-31', 'completed')
        returning id
      `;
      const activeId = await createEnrolment(inst.institutionId, studentId, sectionB, yearB, { rollNo: 2, startedOn: "2026-04-01" });
      const eventId = await insertEvent(inst, studentId, {
        kind: "promoted",
        batchId: crypto.randomUUID(),
        fromEnrolmentId: completed.id,
        toEnrolmentId: activeId,
        effectiveOn: "2026-04-01",
      });

      const ctx = await buildContext(inst, "admin");
      setActingClient(inst.clientAs("admin"));
      try {
        const history = await lifecycleHistory(ctx, studentId);
        expect(history.enrolments).toEqual([
          {
            id: completed.id,
            academicYear: "2025-26",
            grade: "VI",
            section: "A",
            rollNo: 1,
            status: "completed",
            startedOn: "2025-04-01",
            endedOn: "2026-03-31",
          },
          {
            id: activeId,
            academicYear: "2026-27",
            grade: "VI",
            section: "B",
            rollNo: 2,
            status: "active",
            startedOn: "2026-04-01",
            endedOn: null,
          },
        ]);
        expect(history.events).toHaveLength(1);
        expect(history.events[0]).toMatchObject({ id: eventId, kind: "promoted", reason: null, tcNo: null, tcSnapshot: null });
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian sees own child's TC snapshot", async () => {
    const inst = await createTestInstitution("lc-hist-guardian");
    try {
      const studentId = await insertStudent(inst.institutionId, "ADM-LH2");
      const tcSnapshot = { tc_no: "TC/TEST/00001", student_name: "Test Student" };
      await insertEvent(inst, studentId, { kind: "withdrawn", tcNo: "TC/TEST/00001", tcSnapshot, effectiveOn: "2026-06-01" });

      const [guardianLink] = await sql`
        select guardian_id from public.memberships where institution_id = ${inst.institutionId} and role = 'guardian'
      `;
      await sql`
        insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
        values (${inst.institutionId}, ${guardianLink.guardian_id}, ${studentId}, 'mother', true)
      `;

      const ctx = await buildContext(inst, "guardian");
      setActingClient(inst.clientAs("guardian"));
      try {
        const history = await lifecycleHistory(ctx, studentId);
        expect(history.events).toHaveLength(1);
        expect(history.events[0]).toMatchObject({ kind: "withdrawn", tcNo: "TC/TEST/00001", tcSnapshot });
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("a guardian asking for another family's child sees empty arrays", async () => {
    const inst = await createTestInstitution("lc-hist-guardian-other");
    try {
      const otherStudentId = await insertStudent(inst.institutionId, "ADM-LH3-OTHER");
      await insertEvent(inst, otherStudentId, { kind: "withdrawn", effectiveOn: "2026-06-01" });

      const ctx = await buildContext(inst, "guardian");
      setActingClient(inst.clientAs("guardian"));
      try {
        const history = await lifecycleHistory(ctx, otherStudentId);
        expect(history).toEqual({ enrolments: [], events: [] });
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher of the current section sees the history; teacher of another section sees nothing", async () => {
    const inst = await createTestInstitution("lc-hist-teacher");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const [teacherStaff] = await sql`
        select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'
      `;
      const sectionA = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A", classTeacherId: teacherStaff.staff_id });
      const sectionB = await createClassSection(inst.institutionId, gradeId, yearId, { name: "B" });

      const ownStudentId = await insertStudent(inst.institutionId, "ADM-LH4-OWN");
      await createEnrolment(inst.institutionId, ownStudentId, sectionA, yearId, { rollNo: 1 });
      await insertEvent(inst, ownStudentId, { kind: "withdrawn", effectiveOn: "2026-06-01" });

      const otherStudentId = await insertStudent(inst.institutionId, "ADM-LH4-OTHER");
      await createEnrolment(inst.institutionId, otherStudentId, sectionB, yearId, { rollNo: 1 });
      await insertEvent(inst, otherStudentId, { kind: "withdrawn", effectiveOn: "2026-06-01" });

      const ctx = await buildContext(inst, "teacher");
      setActingClient(inst.clientAs("teacher"));
      try {
        const ownHistory = await lifecycleHistory(ctx, ownStudentId);
        expect(ownHistory.enrolments).toHaveLength(1);
        expect(ownHistory.events).toHaveLength(1);

        const otherHistory = await lifecycleHistory(ctx, otherStudentId);
        expect(otherHistory).toEqual({ enrolments: [], events: [] });
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });
});
