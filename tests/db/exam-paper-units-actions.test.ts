import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mocks (BRIEF-COMMON lesson 13).
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { setPaperUnits } from "@/modules/exams/paper-units.actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper } from "../helpers/factories";
import { buildMasteryFixture, closeMasteryFixtureHelper, publishExam } from "../helpers/mastery-fixture";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeMasteryFixtureHelper();
  await closeRolesHelper();
});

describe("M20-T7 exam.paper.setUnits", () => {
  it("exam_controller maps 2 units onto a paper; stored on exam_papers; audit records the count", async () => {
    const inst = await createTestInstitution("exam-paper-units-basic");
    try {
      const fx = await buildMasteryFixture(inst);
      const { paperIdsBySubject } = await publishExam(inst, fx, {
        unitIdsBySubject: { maths: [] },
        marks: [],
      });
      const paperId = paperIdsBySubject.maths as string;
      const unitIds = fx.subjects.maths.units;

      const result = await callAs(inst, "exam_controller", setPaperUnits, { paperId, unitIds: [...unitIds] });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toEqual({ paperId, unitIds: [...unitIds] });

      const [row] = await sql`select unit_ids from public.exam_papers where id = ${paperId}::uuid`;
      expect(row.unit_ids).toEqual(unitIds);

      const [auditRow] = await sql`
        select metadata from public.audit_events
        where entity_id = ${paperId}::uuid and action = 'exam.paper.units_set'
        order by created_at desc limit 1
      `;
      expect(auditRow.metadata).toEqual({ paperId, unitCount: 2 });
    } finally {
      await inst.cleanup();
    }
  });

  it("[] clears a previously mapped paper", async () => {
    const inst = await createTestInstitution("exam-paper-units-clear");
    try {
      const fx = await buildMasteryFixture(inst);
      const { paperIdsBySubject } = await publishExam(inst, fx, {
        unitIdsBySubject: { maths: [fx.subjects.maths.units[0]] },
        marks: [],
      });
      const paperId = paperIdsBySubject.maths as string;

      const result = await callAs(inst, "exam_controller", setPaperUnits, { paperId, unitIds: [] });
      expect(result.ok).toBe(true);

      const [row] = await sql`select unit_ids from public.exam_papers where id = ${paperId}::uuid`;
      expect(row.unit_ids).toEqual([]);
    } finally {
      await inst.cleanup();
    }
  });

  it("a unit from another subject is rejected as validation_failed naming unitIds", async () => {
    const inst = await createTestInstitution("exam-paper-units-wrong-subject");
    try {
      const fx = await buildMasteryFixture(inst);
      const { paperIdsBySubject } = await publishExam(inst, fx, {
        unitIdsBySubject: { maths: [] },
        marks: [],
      });
      const paperId = paperIdsBySubject.maths as string;

      const result = await callAs(inst, "exam_controller", setPaperUnits, {
        paperId,
        unitIds: [fx.subjects.science.units[0]],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("validation_failed");
      expect(result.error.fieldErrors?.unitIds).toBeTruthy();
    } finally {
      await inst.cleanup();
    }
  });

  it("a teacher without exam.manage is forbidden", async () => {
    const inst = await createTestInstitution("exam-paper-units-forbidden");
    try {
      const fx = await buildMasteryFixture(inst);
      const { paperIdsBySubject } = await publishExam(inst, fx, {
        unitIdsBySubject: { maths: [] },
        marks: [],
      });
      const paperId = paperIdsBySubject.maths as string;

      const result = await callAs(inst, "teacher", setPaperUnits, { paperId, unitIds: [] });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("an unknown paper id is not_found", async () => {
    const inst = await createTestInstitution("exam-paper-units-not-found");
    try {
      const result = await callAs(inst, "exam_controller", setPaperUnits, {
        paperId: "00000000-0000-0000-0000-000000000000",
        unitIds: [],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("not_found");
    } finally {
      await inst.cleanup();
    }
  });
});
