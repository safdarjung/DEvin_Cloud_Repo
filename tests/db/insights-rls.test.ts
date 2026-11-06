// M19-T2 — migration 0092 part 1: insights, insight_actions, briefings
// tables, RLS, record_insights writer. Real signed-in clients + real RLS,
// same pattern as operations-rls.test.ts / timetable-rls.test.ts.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createGrade,
  createSubjectAssignment,
  createSubject,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

function adminClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
}

interface Candidate {
  signal: string;
  detector_version: number;
  dedupe_key: string;
  domain: string;
  kind: string;
  severity: string;
  title: string;
  pattern: string;
  evidence: { label: string; value: number }[];
  sources: string[];
  date_from: string;
  date_to: string;
  confidence: number;
  factors: unknown[];
  reviewer_role: string;
  recommended_actions: string[];
  approval_required: boolean;
  entity_type: string | null;
  entity_id: string | null;
  entity_label: string | null;
  class_section_id: string | null;
}

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    signal: "finance.overdue_growth",
    detector_version: 1,
    dedupe_key: `dk-${crypto.randomUUID()}`,
    domain: "finance",
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
    reviewer_role: "accountant",
    recommended_actions: [],
    approval_required: false,
    entity_type: null,
    entity_id: null,
    entity_label: null,
    class_section_id: null,
    ...overrides,
  };
}

/** Inserts one row per domain directly (service role), for the RLS read matrix. */
async function seedDomainRows(
  institutionId: string,
  classSectionId: string,
): Promise<Record<string, string>> {
  const admin = adminClient();
  const rows: [string, Candidate][] = [
    [
      "attendance",
      candidate({
        signal: "attendance.section_drop",
        domain: "attendance",
        reviewer_role: "principal",
        entity_type: "section",
        entity_id: crypto.randomUUID(),
        class_section_id: classSectionId,
      }),
    ],
    [
      "academics",
      candidate({
        signal: "academics.awaiting_review",
        domain: "academics",
        reviewer_role: "principal",
        entity_type: "section",
        entity_id: crypto.randomUUID(),
        class_section_id: classSectionId,
      }),
    ],
    ["finance", candidate({ signal: "finance.overdue_growth", domain: "finance", reviewer_role: "accountant" })],
    [
      "admissions",
      candidate({ signal: "admissions.stage_dwell", domain: "admissions", reviewer_role: "admissions" }),
    ],
    [
      "staff",
      candidate({
        signal: "staff.workload",
        domain: "staff",
        reviewer_role: "principal",
        entity_type: "staff",
        entity_id: crypto.randomUUID(),
      }),
    ],
    [
      "operations",
      candidate({ signal: "operations.room_pressure", domain: "operations", reviewer_role: "admin" }),
    ],
  ];

  const ids: Record<string, string> = {};
  for (const [domain, row] of rows) {
    const { data, error } = await admin.rpc("record_insights", {
      p_institution_id: institutionId,
      p_rows: [row],
    });
    if (error) throw error;
    expect(data).toBe(1);
    const [inserted] = await sql`
      select id from public.insights where institution_id = ${institutionId} and dedupe_key = ${row.dedupe_key}
    `;
    ids[domain] = inserted.id as string;
  }
  return ids;
}

describe("0092 part 1: insights/insight_actions/briefings RLS + record_insights", () => {
  it("record_insights: counts, dedupe, open-key collision, dismiss reopens, cross-tenant class_section skipped", async () => {
    await withTwoInstitutions(async (a, b) => {
      const admin = adminClient();
      const yearB = await createAcademicYear(b.institutionId);
      const gradeB = await createGrade(b.institutionId);
      const sectionB = await createClassSection(b.institutionId, gradeB, yearB);

      const row1 = candidate();
      const row2 = candidate({
        dedupe_key: `dk-${crypto.randomUUID()}`,
        signal: "admissions.stage_dwell",
        domain: "admissions",
        reviewer_role: "admissions",
      });

      // 2 rows -> 2
      const first = await admin.rpc("record_insights", { p_institution_id: a.institutionId, p_rows: [row1, row2] });
      expect(first.error).toBeNull();
      expect(first.data).toBe(2);

      // same payload again -> 0 (dedupe_key unique)
      const repeat = await admin.rpc("record_insights", { p_institution_id: a.institutionId, p_rows: [row1, row2] });
      expect(repeat.error).toBeNull();
      expect(repeat.data).toBe(0);

      // new dedupe_key, same open (signal, entity=none) -> 0 (insights_open_key)
      const sameOpen = await admin.rpc("record_insights", {
        p_institution_id: a.institutionId,
        p_rows: [candidate({ dedupe_key: `dk-${crypto.randomUUID()}` })],
      });
      expect(sameOpen.error).toBeNull();
      expect(sameOpen.data).toBe(0);

      // dismiss row1 (service role) -> now 1 new row for the same open key is allowed
      await admin.from("insights").update({ status: "dismissed" }).eq("institution_id", a.institutionId).eq("dedupe_key", row1.dedupe_key);
      const afterDismiss = await admin.rpc("record_insights", {
        p_institution_id: a.institutionId,
        p_rows: [candidate({ dedupe_key: `dk-${crypto.randomUUID()}` })],
      });
      expect(afterDismiss.error).toBeNull();
      expect(afterDismiss.data).toBe(1);

      // a row whose class_section_id belongs to B is skipped
      const crossTenant = await admin.rpc("record_insights", {
        p_institution_id: a.institutionId,
        p_rows: [
          candidate({
            dedupe_key: `dk-${crypto.randomUUID()}`,
            signal: "attendance.section_drop",
            domain: "attendance",
            reviewer_role: "principal",
            entity_type: "section",
            entity_id: crypto.randomUUID(),
            class_section_id: sectionB,
          }),
        ],
      });
      expect(crossTenant.error).toBeNull();
      expect(crossTenant.data).toBe(0);
      const leaked = await sql`
        select id from public.insights where institution_id = ${a.institutionId} and class_section_id = ${sectionB}
      `;
      expect(leaked).toHaveLength(0);
    });
  }, 30_000);

  it("record_insights called by an authenticated user is denied", async () => {
    const inst = await createTestInstitution("insights-auth-denied");
    try {
      const { data, error } = await inst
        .clientAs("principal")
        .rpc("record_insights", { p_institution_id: inst.institutionId, p_rows: [candidate()] });
      expect(error).not.toBeNull();
      expect(data).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("checks: entity_label with entity_type student is rejected; 9 evidence items is rejected", async () => {
    const inst = await createTestInstitution("insights-checks");
    const admin = adminClient();
    try {
      const badLabel = await admin.from("insights").insert({
        institution_id: inst.institutionId,
        ...candidate({ entity_type: "student", entity_id: crypto.randomUUID(), entity_label: "Should be null" }),
      });
      expect(badLabel.error).not.toBeNull();

      const tooMuchEvidence = await admin.from("insights").insert({
        institution_id: inst.institutionId,
        ...candidate({ evidence: Array.from({ length: 9 }, (_, i) => ({ label: `e${i}`, value: i })) }),
      });
      expect(tooMuchEvidence.error).not.toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  describe("read scoping within one institution", () => {
    let inst: TestInstitution;
    let ids: Record<string, string>;
    let teacherSectionId: string;

    beforeAll(async () => {
      inst = await createTestInstitution("insights-scope");
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      teacherSectionId = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
      const subjectId = await createSubject(inst.institutionId);
      const [teacherStaff] = await sql`
        select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'
      `;
      await createSubjectAssignment(inst.institutionId, teacherSectionId, subjectId, teacherStaff.staff_id as string);
      ids = await seedDomainRows(inst.institutionId, teacherSectionId);
    }, 30_000);

    afterAll(async () => {
      await inst.cleanup();
    });

    it("principal sees all domains", async () => {
      const { data, error } = await inst.clientAs("principal").from("insights").select("id, domain").eq("institution_id", inst.institutionId);
      expect(error).toBeNull();
      expect((data ?? []).map((r) => r.domain).sort()).toEqual(
        ["academics", "admissions", "attendance", "finance", "operations", "staff"].sort(),
      );
    });

    it("accountant sees only finance", async () => {
      const { data, error } = await inst.clientAs("accountant").from("insights").select("domain").eq("institution_id", inst.institutionId);
      expect(error).toBeNull();
      expect((data ?? []).map((r) => r.domain)).toEqual(["finance"]);
    });

    it("admissions sees only admissions", async () => {
      const { data, error } = await inst.clientAs("admissions").from("insights").select("domain").eq("institution_id", inst.institutionId);
      expect(error).toBeNull();
      expect((data ?? []).map((r) => r.domain)).toEqual(["admissions"]);
    });

    it("exam_controller sees only academics", async () => {
      const { data, error } = await inst.clientAs("exam_controller").from("insights").select("domain").eq("institution_id", inst.institutionId);
      expect(error).toBeNull();
      expect((data ?? []).map((r) => r.domain)).toEqual(["academics"]);
    });

    it("teacher sees attendance/academics of taught sections only (no staff/operations, no other sections)", async () => {
      const { data, error } = await inst.clientAs("teacher").from("insights").select("domain").eq("institution_id", inst.institutionId);
      expect(error).toBeNull();
      expect((data ?? []).map((r) => r.domain).sort()).toEqual(["academics", "attendance"].sort());
    });

    it("guardian and student see none", async () => {
      for (const role of ["guardian", "student"] as const) {
        const { data, error } = await inst.clientAs(role).from("insights").select("id").eq("institution_id", inst.institutionId);
        expect(error).toBeNull();
        expect(data).toHaveLength(0);
      }
    });

    it("direct PostgREST insert/update/delete on insights/insight_actions/briefings by principal is denied", async () => {
      const principal = inst.clientAs("principal");

      const insertAttempt = await principal.from("insights").insert({
        institution_id: inst.institutionId,
        ...candidate(),
      });
      expect(insertAttempt.error).not.toBeNull();

      const insightId = ids.finance;
      const updateAttempt = await principal.from("insights").update({ status: "dismissed" }).eq("id", insightId).select("id");
      expect(updateAttempt.error !== null || (updateAttempt.data ?? []).length === 0).toBe(true);

      const deleteAttempt = await principal.from("insights").delete().eq("id", insightId).select("id");
      expect(deleteAttempt.error !== null || (deleteAttempt.data ?? []).length === 0).toBe(true);

      const actionInsertAttempt = await principal.from("insight_actions").insert({
        institution_id: inst.institutionId,
        insight_id: insightId,
        action: "x",
        owner: "x",
        rationale: "x",
        expected_outcome: "x",
        status: "planned",
        created_by: inst.users.principal.id,
      });
      expect(actionInsertAttempt.error).not.toBeNull();

      const briefingInsertAttempt = await principal.from("briefings").insert({
        institution_id: inst.institutionId,
        role: "teacher",
        brief_date: "2026-10-01",
        headline: "x",
        items: [],
        sources: [],
      });
      expect(briefingInsertAttempt.error).not.toBeNull();
    });

    it("insight_actions is visible exactly when its parent insight is", async () => {
      const admin = adminClient();
      const { data: action, error: insertError } = await admin
        .from("insight_actions")
        .insert({
          institution_id: inst.institutionId,
          insight_id: ids.finance,
          action: "Call the family",
          owner: "Accountant",
          rationale: "Overdue fees rising fast",
          expected_outcome: "Overdue amount drops next week",
          status: "planned",
          created_by: inst.users.accountant.id,
        })
        .select("id")
        .single();
      expect(insertError).toBeNull();

      const accountantRead = await inst.clientAs("accountant").from("insight_actions").select("id").eq("id", action!.id);
      expect(accountantRead.error).toBeNull();
      expect(accountantRead.data).toHaveLength(1);

      const admissionsRead = await inst.clientAs("admissions").from("insight_actions").select("id").eq("id", action!.id);
      expect(admissionsRead.error).toBeNull();
      expect(admissionsRead.data).toHaveLength(0);

      const principalRead = await inst.clientAs("principal").from("insight_actions").select("id").eq("id", action!.id);
      expect(principalRead.error).toBeNull();
      expect(principalRead.data).toHaveLength(1);
    });

    it("briefings: a teacher sees only role='teacher' rows", async () => {
      const admin = adminClient();
      const rolesSeeded = ["teacher", "accountant"] as const;
      for (const role of rolesSeeded) {
        const { error } = await admin.from("briefings").insert({
          institution_id: inst.institutionId,
          role,
          brief_date: "2026-10-02",
          headline: `Brief for ${role}`,
          items: [],
          sources: [],
        });
        expect(error).toBeNull();
      }

      const teacherRead = await inst.clientAs("teacher").from("briefings").select("role").eq("institution_id", inst.institutionId);
      expect(teacherRead.error).toBeNull();
      expect((teacherRead.data ?? []).map((r) => r.role)).toEqual(["teacher"]);

      const principalRead = await inst.clientAs("principal").from("briefings").select("role").eq("institution_id", inst.institutionId);
      expect(principalRead.error).toBeNull();
      expect((principalRead.data ?? []).map((r) => r.role).sort()).toEqual(["accountant", "teacher"]);
    });
  });
});
