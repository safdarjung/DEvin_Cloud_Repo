// M15-T11 — src/modules/reports/{queries,query-defs}.ts. Plain query
// functions called directly (buildContext + a local acting-client, mirrors
// tests/db/timetable-queries.test.ts) alongside the real HTTP route for
// report.export's CSV path (mirrors tests/db/api-query-route.test.ts's
// getRequest/tokenFor). Both need "@/lib/supabase/server", so this file's
// mock wraps the real module (importOriginal) instead of swapping in the
// opt-in server-client-mock wholesale: direct calls use the acting client,
// the real HTTP route falls through to the real bearer-token createClient.
// actions.ts (T10) isn't owned here, so schedule/document fixtures are
// written straight via the service-role client, same shape as
// tests/db/report-sources-rls.test.ts's createSchedule helper.
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

let actingClient: SupabaseClient<Database> | null = null;

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return {
    ...actual,
    createClient: async () => actingClient ?? actual.createClient(),
  };
});
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

process.env.SERVICE_ROLE_CALLER = "test";
const { createAdminClient } = await import("@/lib/supabase/admin");
const admin = createAdminClient();

import { AppError } from "@/lib/actions/result";
import { GET } from "@/app/api/v1/query/[name]/route";
import { buildContext } from "../helpers/actions";
import { createAcademicYear, createClassSection, createGrade, closeFactoriesHelper } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";
import { reportExport, reportList, reportRuns } from "@/modules/reports/queries";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function createSchedule(inst: TestInstitution, source: string, recipientRoles: string[]): Promise<string> {
  const { data, error } = await admin
    .from("scheduled_reports")
    .insert({
      institution_id: inst.institutionId,
      name: `Schedule ${crypto.randomUUID().slice(0, 8)}`,
      source,
      cron: "0 20 * * *",
      recipient_roles: recipientRoles,
      created_by: inst.users.admin.id,
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("failed to create schedule fixture");
  return data.id as string;
}

async function createRunDocument(inst: TestInstitution, scheduleId: string): Promise<string> {
  const path = `${inst.institutionId}/report/${scheduleId}/${Date.now()}.csv`;
  const { error: uploadError } = await admin.storage.from("tenant-docs").upload(path, "date,grade\n", {
    contentType: "text/csv",
  });
  if (uploadError) throw uploadError;

  const { data, error } = await admin
    .from("documents")
    .insert({
      institution_id: inst.institutionId,
      entity_type: "report",
      entity_id: scheduleId,
      kind: "scheduled_report",
      file_name: "run.csv",
      mime: "text/csv",
      size_bytes: 14,
      path,
      created_by: inst.users.admin.id,
      status: "active",
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("failed to create document fixture");
  return data.id as string;
}

async function tokenFor(inst: TestInstitution, role: "owner" | "principal" | "admin" | "accountant" | "teacher"): Promise<string> {
  const { data, error } = await inst.clientAs(role).auth.getSession();
  if (error || !data.session) throw error ?? new Error(`no session for ${role}`);
  return data.session.access_token;
}

function getRequest(name: string, institution: string, input: unknown, headers: Record<string, string>): Promise<Response> {
  const url = new URL(`http://localhost/api/v1/query/${name}`);
  url.searchParams.set("institution", institution);
  url.searchParams.set("format", "csv");
  url.searchParams.set("input", JSON.stringify(input));
  return GET(new Request(url, { headers }), { params: Promise.resolve({ name }) });
}

describe("report.list (M15-T11)", () => {
  it("principal sees only this institution's schedules", async () => {
    const instA = await createTestInstitution("rq-list-a");
    const instB = await createTestInstitution("rq-list-b");
    try {
      await createSchedule(instA, "attendance.daily", ["principal"]);
      await createSchedule(instB, "attendance.daily", ["principal"]);

      const ctx = await buildContext(instA, "principal");
      actingClient = instA.clientAs("principal");
      try {
        const rows = await reportList(ctx);
        expect(rows).toHaveLength(1);
        expect(rows[0].source).toBe("attendance.daily");
      } finally {
        actingClient = null;
      }
    } finally {
      await instA.cleanup();
      await instB.cleanup();
    }
  });
});

describe("report.runs (M15-T11)", () => {
  it("admin on a principal-only schedule sees no runs; principal sees the run", async () => {
    const inst = await createTestInstitution("rq-runs");
    try {
      const scheduleId = await createSchedule(inst, "attendance.daily", ["principal"]);
      const documentId = await createRunDocument(inst, scheduleId);

      const adminCtx = await buildContext(inst, "admin");
      actingClient = inst.clientAs("admin");
      try {
        const adminRuns = await reportRuns(adminCtx, scheduleId, 30);
        expect(adminRuns).toEqual([]);
      } finally {
        actingClient = null;
      }

      const principalCtx = await buildContext(inst, "principal");
      actingClient = inst.clientAs("principal");
      try {
        const principalRuns = await reportRuns(principalCtx, scheduleId, 30);
        expect(principalRuns).toHaveLength(1);
        expect(principalRuns[0].documentId).toBe(documentId);
      } finally {
        actingClient = null;
      }
    } finally {
      await inst.cleanup();
    }
  });
});

describe("report.export (M15-T11)", () => {
  it("accountant: forbidden on attendance.daily, rows on finance.defaulters", async () => {
    const inst = await createTestInstitution("rq-export-accountant");
    try {
      const ctx = await buildContext(inst, "accountant");
      actingClient = inst.clientAs("accountant");
      try {
        let caught: unknown;
        try {
          await reportExport(ctx, { source: "attendance.daily", params: { dayOffset: 0 } });
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(AppError);
        expect((caught as AppError).code).toBe("forbidden");

        const result = await reportExport(ctx, { source: "finance.defaulters", params: { minDaysOverdue: 0 } });
        expect(result.rows).toEqual([]);
      } finally {
        actingClient = null;
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher: forbidden on finance.defaulters (handler's own source-permission check; teacher lacks finance.read)", async () => {
    const inst = await createTestInstitution("rq-export-teacher");
    try {
      const ctx = await buildContext(inst, "teacher");
      actingClient = inst.clientAs("teacher");
      try {
        let caught: unknown;
        try {
          await reportExport(ctx, { source: "finance.defaulters", params: { minDaysOverdue: 0 } });
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(AppError);
        expect((caught as AppError).code).toBe("forbidden");
      } finally {
        actingClient = null;
      }
    } finally {
      await inst.cleanup();
    }
  });

  // Security-review finding (LOW): the previous version of this test called
  // reportExport() directly and claimed "regardless of source", but teacher
  // holds attendance.read, so the handler's own source-permission check lets
  // attendance.daily through at this layer — only the outer `data.export`
  // gate in reportExportQuery's defineQuery() (query-defs.ts) blocks teacher
  // for every source. Both layers are asserted below so the test name can't
  // overstate real-API coverage again.
  it("teacher: reportExport() called directly allows attendance.daily (teacher has attendance.read; data.export is an outer gate, not the handler's job)", async () => {
    const inst = await createTestInstitution("rq-export-teacher-direct");
    try {
      const ctx = await buildContext(inst, "teacher");
      actingClient = inst.clientAs("teacher");
      try {
        const result = await reportExport(ctx, { source: "attendance.daily", params: { dayOffset: 0 } });
        expect(result.rows).toEqual([]);
      } finally {
        actingClient = null;
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher over HTTP: GET report.export?source=attendance.daily is forbidden regardless of source (data.export outer gate)", async () => {
    const inst = await createTestInstitution("rq-export-teacher-http");
    try {
      const token = await tokenFor(inst, "teacher");

      const res = await getRequest(
        "report.export",
        inst.slug,
        { source: "attendance.daily", params: {} },
        { authorization: `Bearer ${token}` },
      );

      expect(res.status).toBe(403);
      const body = (await res.json()) as { ok: boolean; error?: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error?.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("principal over HTTP: GET report.export?format=csv streams text/csv starting with the attendance header", async () => {
    const inst = await createTestInstitution("rq-export-csv");
    try {
      const yearId = await createAcademicYear(inst.institutionId, { isCurrent: true });
      const gradeId = await createGrade(inst.institutionId, { code: "A", displayName: "Grade A", sortKey: 1 });
      await createClassSection(inst.institutionId, gradeId, yearId, { name: "Alpha" });
      const token = await tokenFor(inst, "principal");

      const res = await getRequest(
        "report.export",
        inst.slug,
        { source: "attendance.daily", params: {} },
        { authorization: `Bearer ${token}` },
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/csv");
      const body = await res.text();
      expect(body.startsWith("date,grade,section,session_status,enrolled,marked,present_weighted,denominator,percentage")).toBe(true);
    } finally {
      await inst.cleanup();
    }
  });
});
