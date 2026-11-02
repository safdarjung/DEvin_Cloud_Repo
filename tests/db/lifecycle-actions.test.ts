import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mock (T-022 lead review pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { promote, transfer, withdraw } from "@/modules/lifecycle/actions";
import type { TransferInput } from "@/modules/lifecycle/schemas";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createEnrolment, createGrade } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

// M14-T6 — lifecycle.promote / lifecycle.transfer / lifecycle.withdraw action
// wrappers over the 0076 definers (promote_students / exit_student). Same
// shape as tests/db/timetable-actions.test.ts: real per-role TenantContext
// via callAs, no mocked Supabase client.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function studentMembership(institutionId: string) {
  const [row] = await sql`
    select student_id from public.memberships
    where institution_id = ${institutionId} and role = 'student'
  `;
  return row.student_id as string;
}

async function buildYears(inst: TestInstitution) {
  const fromYearId = await createAcademicYear(inst.institutionId, {
    name: "2026-27",
    startsOn: "2026-04-01",
    endsOn: "2027-03-31",
    isCurrent: false,
  });
  const toYearId = await createAcademicYear(inst.institutionId, {
    name: "2027-28",
    startsOn: "2027-04-01",
    endsOn: "2028-03-31",
    isCurrent: true,
  });
  const gradeId = await createGrade(inst.institutionId);
  return { fromYearId, toYearId, gradeId };
}

describe("lifecycle actions (M14-T6)", () => {
  it("admin promotes a mapped section, then a re-run returns zeros", async () => {
    const inst = await createTestInstitution("lc-actions-promote");
    try {
      const { fromYearId, toYearId, gradeId } = await buildYears(inst);
      const fromSectionId = await createClassSection(inst.institutionId, gradeId, fromYearId, { name: "A" });
      const toSectionId = await createClassSection(inst.institutionId, gradeId, toYearId, { name: "A2" });
      const studentId = await studentMembership(inst.institutionId);
      await createEnrolment(inst.institutionId, studentId, fromSectionId, fromYearId, { rollNo: 1 });

      const first = await callAs(inst, "admin", promote, {
        fromYearId,
        toYearId,
        mappings: [{ fromSectionId, toSectionId }],
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.data.promoted).toBe(1);
      expect(first.data.graduated).toBe(0);
      expect(first.data.skippedStudentIds).toEqual([]);
      expect(typeof first.data.batchId).toBe("string");

      const second = await callAs(inst, "admin", promote, {
        fromYearId,
        toYearId,
        mappings: [{ fromSectionId, toSectionId }],
      });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.data.promoted).toBe(0);
      expect(second.data.graduated).toBe(0);
    } finally {
      await inst.cleanup();
    }
  });

  it("admissions is forbidden from promoting", async () => {
    const inst = await createTestInstitution("lc-actions-promote-forbidden");
    try {
      const { fromYearId, toYearId, gradeId } = await buildYears(inst);
      const fromSectionId = await createClassSection(inst.institutionId, gradeId, fromYearId, { name: "A" });

      const result = await callAs(inst, "admissions", promote, {
        fromYearId,
        toYearId,
        mappings: [{ fromSectionId, toSectionId: null }],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("withdraws a student with a sequenced TC number; a second withdraw is invalid_state", async () => {
    const inst = await createTestInstitution("lc-actions-withdraw");
    try {
      const studentId = await studentMembership(inst.institutionId);
      const year = new Date().getFullYear();

      const first = await callAs(inst, "admin", withdraw, {
        studentId,
        reason: "Family relocating to another city",
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.data.tcNo).toBe(`TC/${year}/00001`);
      expect(typeof first.data.eventId).toBe("string");

      const second = await callAs(inst, "admin", withdraw, {
        studentId,
        reason: "Family relocating to another city",
      });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.error.code).toBe("invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("transfer without a destination school is validation_failed", async () => {
    const inst = await createTestInstitution("lc-actions-transfer-validation");
    try {
      const studentId = await studentMembership(inst.institutionId);

      const result = await callAs(inst, "admin", transfer, {
        studentId,
        reason: "Moving to another school",
      } as unknown as TransferInput);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("validation_failed");
    } finally {
      await inst.cleanup();
    }
  });

  it("a teacher is forbidden from withdrawing a student", async () => {
    const inst = await createTestInstitution("lc-actions-withdraw-forbidden");
    try {
      const studentId = await studentMembership(inst.institutionId);

      const result = await callAs(inst, "teacher", withdraw, {
        studentId,
        reason: "Family relocating to another city",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });
});
