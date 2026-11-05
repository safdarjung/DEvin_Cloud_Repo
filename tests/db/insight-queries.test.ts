// M19-T18 — src/modules/insights/{queries,query-defs}.ts, exercised through
// callAs (real RLS via 0092's policies). Mirrors tests/db/timetable-queries
// .test.ts's buildContext/callAs pattern; row fixtures are planted via
// record_insights (service role), same shape as tests/db/insights-rls.test.ts.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { callAs, closeActionsHelper } from "../helpers/actions";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createGrade,
  createSubject,
  createSubjectAssignment,
} from "../helpers/factories";
import { plantStudent } from "../helpers/insight-fixtures";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";
import { insightsActionsQuery, insightsListQuery } from "@/modules/insights/query-defs";
import type { Insight } from "@/modules/fabric/types";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
  await closeActionsHelper();
});

function adminClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
}

async function teacherStaffId(institutionId: string): Promise<string> {
  const [row] = await sql`select staff_id from public.memberships where institution_id = ${institutionId} and role = 'teacher'`;
  return row.staff_id as string;
}

interface CandidateOverrides {
  signal?: string;
  domain?: string;
  reviewer_role?: string;
  entity_type?: string | null;
  entity_id?: string | null;
  entity_label?: string | null;
  class_section_id?: string | null;
}

function candidate(overrides: CandidateOverrides = {}) {
  return {
    signal: overrides.signal ?? "finance.overdue_growth",
    detector_version: 1,
    dedupe_key: `dk-${crypto.randomUUID()}`,
    domain: overrides.domain ?? "finance",
    kind: "descriptive",
    severity: "warning",
    title: "Overdue fees rising",
    pattern: "Overdue fees rose from 1,000 to 2,000 in the last 4 weeks.",
    evidence: [{ label: "Overdue now", value: 2000 }],
    sources: [],
    date_from: "2026-09-01",
    date_to: "2026-10-01",
    confidence: 0.6,
    factors: [],
    reviewer_role: overrides.reviewer_role ?? "accountant",
    recommended_actions: [],
    approval_required: false,
    entity_type: overrides.entity_type ?? null,
    entity_id: overrides.entity_id ?? null,
    entity_label: overrides.entity_label ?? null,
    class_section_id: overrides.class_section_id ?? null,
  };
}

async function recordInsight(admin: SupabaseClient, institutionId: string, overrides: CandidateOverrides = {}): Promise<string> {
  const row = candidate(overrides);
  const { error } = await admin.rpc("record_insights", { p_institution_id: institutionId, p_rows: [row] });
  if (error) throw error;
  const [inserted] = await sql`select id from public.insights where institution_id = ${institutionId} and dedupe_key = ${row.dedupe_key}`;
  return inserted.id as string;
}

const INSIGHT_KEYS = [
  "id",
  "institution_id",
  "created_at",
  "updated_at",
  "title",
  "domain",
  "severity",
  "kind",
  "pattern",
  "evidence",
  "sources",
  "date_from",
  "date_to",
  "confidence",
  "factors",
  "reviewer_role",
  "recommended_actions",
  "approval_required",
  "status",
  "entity_ref",
  "signal",
  "detector_version",
  "explanation",
].sort();

describe("insights.list / insights.actions (M19-T18)", () => {
  it("principal: every open row, with keys matching the Insight contract; student entity label resolves to the real name", async () => {
    const inst = await createTestInstitution("insights-list-principal");
    try {
      const admin = adminClient();
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId);
      const studentId = await plantStudent(sql, inst.institutionId, sectionId, yearId);

      await recordInsight(admin, inst.institutionId, { signal: "finance.overdue_growth", domain: "finance", reviewer_role: "accountant" });
      await recordInsight(admin, inst.institutionId, {
        signal: "staff.workload",
        domain: "staff",
        reviewer_role: "principal",
        entity_type: "staff",
        entity_id: crypto.randomUUID(), // no matching staff row -> fallback label
      });
      await recordInsight(admin, inst.institutionId, {
        signal: "academics.marks_decline",
        domain: "academics",
        reviewer_role: "principal",
        entity_type: "student",
        entity_id: studentId,
        class_section_id: sectionId,
      });

      const result = await callAs(inst, "principal", insightsListQuery, {});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const rows = result.data as Insight[];
      expect(rows).toHaveLength(3);
      expect(Object.keys(rows[0]).sort()).toEqual(INSIGHT_KEYS);

      const student = rows.find((r) => r.entity_ref?.type === "student");
      expect(student?.entity_ref?.label).toBe("Test");

      const staff = rows.find((r) => r.entity_ref?.type === "staff");
      expect(staff?.entity_ref?.label).toBe("Staff member");
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("teacher: only own-section attendance/academics rows; accountant: only finance", async () => {
    const inst = await createTestInstitution("insights-list-scoped");
    try {
      const admin = adminClient();
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId);
      const subjectId = await createSubject(inst.institutionId);
      const staffId = await teacherStaffId(inst.institutionId);
      await createSubjectAssignment(inst.institutionId, sectionId, subjectId, staffId);

      await recordInsight(admin, inst.institutionId, {
        signal: "attendance.section_drop",
        domain: "attendance",
        reviewer_role: "principal",
        entity_type: "section",
        entity_id: sectionId,
        class_section_id: sectionId,
      });
      await recordInsight(admin, inst.institutionId, { signal: "finance.overdue_growth", domain: "finance", reviewer_role: "accountant" });
      await recordInsight(admin, inst.institutionId, {
        signal: "staff.workload",
        domain: "staff",
        reviewer_role: "principal",
        entity_type: "staff",
        entity_id: crypto.randomUUID(),
      });

      const teacherResult = await callAs(inst, "teacher", insightsListQuery, {});
      expect(teacherResult.ok).toBe(true);
      if (teacherResult.ok) {
        expect((teacherResult.data as Insight[]).map((r) => r.domain)).toEqual(["attendance"]);
      }

      const accountantResult = await callAs(inst, "accountant", insightsListQuery, {});
      expect(accountantResult.ok).toBe(true);
      if (accountantResult.ok) {
        expect((accountantResult.data as Insight[]).map((r) => r.domain)).toEqual(["finance"]);
      }
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("guardian: insights.list -> forbidden (lacks insight.read)", async () => {
    const inst = await createTestInstitution("insights-list-guardian");
    try {
      const result = await callAs(inst, "guardian", insightsListQuery, {});
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("insights.actions: a superseded action is hidden; current rows ordered decided_at asc", async () => {
    const inst = await createTestInstitution("insights-actions");
    try {
      const admin = adminClient();
      const insightId = await recordInsight(admin, inst.institutionId, { signal: "finance.overdue_growth", domain: "finance", reviewer_role: "accountant" });

      const { data: first, error: firstError } = await admin
        .from("insight_actions")
        .insert({
          institution_id: inst.institutionId,
          insight_id: insightId,
          action: "Call the family",
          owner: "Accountant",
          rationale: "Overdue fees rising fast",
          expected_outcome: "Overdue amount drops next week",
          status: "planned",
          created_by: inst.users.accountant.id,
        })
        .select("id")
        .single();
      if (firstError) throw firstError;

      const { data: second, error: secondError } = await admin
        .from("insight_actions")
        .insert({
          institution_id: inst.institutionId,
          insight_id: insightId,
          supersedes_id: first!.id,
          action: "Called the family",
          owner: "Accountant",
          rationale: "Overdue fees rising fast",
          expected_outcome: "Overdue amount drops next week",
          actual_outcome: "Payment promised by Friday",
          decided_at: "2026-10-02T00:00:00Z",
          measured_at: "2026-10-02T00:00:00Z",
          status: "measured",
          created_by: inst.users.accountant.id,
        })
        .select("id")
        .single();
      if (secondError) throw secondError;

      const result = await callAs(inst, "accountant", insightsActionsQuery, { insightId });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.map((a) => a.id)).toEqual([second!.id]);
      expect(result.data[0].status).toBe("measured");
    } finally {
      await inst.cleanup();
    }
  }, 30_000);
});
