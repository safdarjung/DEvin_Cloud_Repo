// M15-T12 — scheduled reports acceptance over HTTP: principal saves a
// schedule via /api/v1/actions/report.schedule.save, teacher marks today's
// attendance for one section via /api/v1/actions/attendance.mark, the
// schedule is forced due (`sql`, trusted caller keeps its own next_run_at
// per the write guard), the real runner (runOnceCore + createRunnerPorts)
// sweeps and runs the job, principal reads the run via
// /api/v1/query/report.runs and downloads the CSV via
// /api/v1/actions/document.getReadUrl (mirrors tests/db/documents-acceptance.test.ts's
// signed-URL fetch); every non-recipient role gets 404 not_found (mirrors
// tests/db/timetable-acceptance.test.ts's HTTP dispatch helpers). Finally
// report.export over GET ?format=csv is checked for a permitted vs. a
// forbidden caller.
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { POST as actionsPost } from "@/app/api/v1/actions/[name]/route";
import { GET as queryGet } from "@/app/api/v1/query/[name]/route";
import { allModulesOn } from "@/lib/modules/catalog";
import { DEFAULT_INSTITUTION_SETTINGS } from "@/modules/core/schemas";
import { createRunnerPorts, runOnceCore } from "@/modules/jobs/runner";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createEnrolment,
  createGrade,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type FixtureRole, type TestInstitution } from "../helpers/roles";
import { withoutSweeps } from "../helpers/runner-ports";

process.env.SERVICE_ROLE_CALLER = "test";
const { createAdminClient } = await import("@/lib/supabase/admin");
const admin = createAdminClient();

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

function actionRequest(name: string, body: unknown, headers: Record<string, string>): Request {
  return new Request(`http://localhost/api/v1/actions/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function dispatchAction(name: string, body: unknown, headers: Record<string, string>): Promise<Response> {
  return actionsPost(actionRequest(name, body, headers), { params: Promise.resolve({ name }) });
}

function queryUrl(name: string, institution: string, input: unknown, format?: "csv"): URL {
  const url = new URL(`http://localhost/api/v1/query/${name}`);
  url.searchParams.set("institution", institution);
  url.searchParams.set("input", JSON.stringify(input));
  if (format) url.searchParams.set("format", format);
  return url;
}

function dispatchQuery(name: string, institution: string, input: unknown, headers: Record<string, string>, format?: "csv"): Promise<Response> {
  return queryGet(new Request(queryUrl(name, institution, input, format), { headers }), { params: Promise.resolve({ name }) });
}

async function tokenFor(inst: TestInstitution, role: FixtureRole): Promise<string> {
  const { data, error } = await inst.clientAs(role).auth.getSession();
  if (error || !data.session) throw error ?? new Error(`no session for ${role}`);
  return data.session.access_token;
}

/** 20:00 IST = 14:30 UTC same calendar day (no DST in India). */
function nextTwentyHundredIst(after: Date): Date {
  const istDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(after);
  const [y, m, d] = istDate.split("-").map(Number);
  let candidate = new Date(Date.UTC(y, m - 1, d, 14, 30, 0));
  if (candidate <= after) candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
  return candidate;
}

function todayInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
}

describe("M15 scheduled reports acceptance: principal schedules, teacher marks attendance, runner fires, principal downloads", () => {
  it(
    "principal saves a schedule, teacher marks attendance, the forced-due schedule produces one run readable only " +
      "by the recipient role, and report.export streams/forbids over HTTP",
    async () => {
      const inst = await createTestInstitution("reports-acceptance");
      try {
        // Fixture institutions start with only `{ modules }` in settings
        // (tests/helpers/roles.ts), and attendance.mark's `.strict()`
        // settings parse needs the full 05 §4.1 default shape, not just
        // `statuses`.
        await sql`
          update public.institutions
          set settings = ${sql.json({ modules: allModulesOn(), ...DEFAULT_INSTITUTION_SETTINGS })}::jsonb
          where id = ${inst.institutionId}::uuid
        `;

        const yearId = await createAcademicYear(inst.institutionId, { isCurrent: true });
        const gradeId = await createGrade(inst.institutionId, { code: "RA", displayName: "Grade RA", sortKey: 1 });

        const [{ staff_id: teacherStaffId }] = await sql<{ staff_id: string }[]>`
          select staff_id from public.memberships
          where institution_id = ${inst.institutionId} and user_id = ${inst.users.teacher.id}
        `;
        const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, {
          name: "RA1",
          classTeacherId: teacherStaffId,
        });

        const [{ student_id: studentId }] = await sql<{ student_id: string }[]>`
          select student_id from public.memberships
          where institution_id = ${inst.institutionId} and user_id = ${inst.users.student.id}
        `;
        await createEnrolment(inst.institutionId, studentId, sectionId, yearId);

        const principalAuth = { authorization: `Bearer ${await tokenFor(inst, "principal")}` };
        const teacherAuth = { authorization: `Bearer ${await tokenFor(inst, "teacher")}` };
        const ownerAuth = { authorization: `Bearer ${await tokenFor(inst, "owner")}` };
        const adminAuth = { authorization: `Bearer ${await tokenFor(inst, "admin")}` };
        const accountantAuth = { authorization: `Bearer ${await tokenFor(inst, "accountant")}` };
        const guardianAuth = { authorization: `Bearer ${await tokenFor(inst, "guardian")}` };

        // --- principal saves the nightly schedule ---------------------------
        const before = new Date();
        const saveRes = await dispatchAction(
          "report.schedule.save",
          {
            institution: inst.slug,
            input: {
              name: "Nightly attendance",
              source: "attendance.daily",
              cron: "0 20 * * *",
              recipientRoles: ["principal"],
            },
          },
          principalAuth,
        );
        expect(saveRes.status).toBe(200);
        const saveBody = await saveRes.json();
        expect(saveBody.ok).toBe(true);
        const scheduleId = saveBody.data.id as string;
        expect(new Date(saveBody.data.nextRunAt).getTime()).toBe(nextTwentyHundredIst(before).getTime());

        // --- teacher marks today's attendance for the section ----------------
        const today = todayInTimezone("Asia/Kolkata");
        const markRes = await dispatchAction(
          "attendance.mark",
          {
            institution: inst.slug,
            input: {
              classSectionId: sectionId,
              date: today,
              records: [{ studentId, status: "P" }],
            },
          },
          teacherAuth,
        );
        const markBody = await markRes.json();
        expect(markRes.status).toBe(200);
        expect(markBody.ok).toBe(true);

        // --- force the schedule due (trusted `sql` caller keeps its own next_run_at) ---
        await sql`update public.scheduled_reports set next_run_at = now() - interval '1 minute' where id = ${scheduleId}::uuid`;

        // --- real runner: sweep enqueues report.generate, then claims and runs it ---
        const ports = withoutSweeps(createRunnerPorts(admin), ["enqueueDueReports"]);
        const beforeSweep = new Date();
        await runOnceCore({ workerId: "reports-acceptance-worker" }, ports);

        // --- principal reads the run -----------------------------------------
        const runsRes = await dispatchQuery("report.runs", inst.slug, { reportId: scheduleId, limit: 30 }, principalAuth);
        expect(runsRes.status).toBe(200);
        const runsBody = await runsRes.json();
        expect(runsBody.ok).toBe(true);
        expect(runsBody.data).toHaveLength(1);
        const documentId = runsBody.data[0].documentId as string;

        // --- principal downloads the CSV via a signed URL --------------------
        const readRes = await dispatchAction(
          "document.getReadUrl",
          { institution: inst.slug, input: { documentId } },
          principalAuth,
        );
        expect(readRes.status).toBe(200);
        const readBody = await readRes.json();
        expect(readBody.ok).toBe(true);
        expect(readBody.data.mime).toBe("text/csv");
        const fetched = await fetch(readBody.data.url);
        expect(fetched.status).toBe(200);
        const csvText = await fetched.text();
        const [header, ...rows] = csvText.trim().split("\r\n");
        const columns = header.split(",");
        const sectionRow = rows.map((r) => r.split(","));
        const sectionIdx = columns.indexOf("section");
        const percentageIdx = columns.indexOf("percentage");
        const row = sectionRow.find((r) => r[sectionIdx] === "RA1");
        expect(row).toBeDefined();
        expect(Number(row?.[percentageIdx])).toBe(100);

        // --- every non-recipient role is refused the document, not merely hidden ---
        for (const [label, headers] of [
          ["owner", ownerAuth],
          ["admin", adminAuth],
          ["teacher", teacherAuth],
          ["accountant", accountantAuth],
          ["guardian", guardianAuth],
        ] as const) {
          const res = await dispatchAction("document.getReadUrl", { institution: inst.slug, input: { documentId } }, headers);
          expect(res.status, `${label} should get 404`).toBe(404);
          expect((await res.json()).error.code).toBe("not_found");
        }

        // --- runner fires again: no new run, next_run_at stays at the next 20:00 IST ---
        await runOnceCore({ workerId: "reports-acceptance-worker" }, ports);
        const runsAgainRes = await dispatchQuery("report.runs", inst.slug, { reportId: scheduleId, limit: 30 }, principalAuth);
        const runsAgainBody = await runsAgainRes.json();
        expect(runsAgainBody.data).toHaveLength(1);

        const [{ next_run_at: nextRunAt }] = await sql<{ next_run_at: string }[]>`
          select next_run_at from public.scheduled_reports where id = ${scheduleId}::uuid
        `;
        expect(new Date(nextRunAt).getTime()).toBe(nextTwentyHundredIst(beforeSweep).getTime());

        // --- report.export over HTTP: principal streams CSV, accountant is forbidden ---
        const exportOkRes = await dispatchQuery(
          "report.export",
          inst.slug,
          { source: "attendance.daily", params: {} },
          principalAuth,
          "csv",
        );
        expect(exportOkRes.status).toBe(200);
        expect(exportOkRes.headers.get("content-type")).toContain("text/csv");

        const exportForbiddenRes = await dispatchQuery(
          "report.export",
          inst.slug,
          { source: "attendance.daily", params: {} },
          accountantAuth,
          "csv",
        );
        expect(exportForbiddenRes.status).toBe(403);
      } finally {
        await inst.cleanup();
      }
    },
  );
});
