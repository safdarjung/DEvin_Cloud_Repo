// M19-T21 — insights acceptance over HTTP + seeded tenant. Real runner
// (runOnceCore + createRunnerPorts, mirrors tests/db/reports-acceptance.test.ts)
// sweeps + detects on a fixture institution with every plant* helper, then
// HTTP review/dismiss/list are exercised (mirrors
// tests/db/timetable-acceptance.test.ts's dispatch helpers). Institution B
// proves the module gate end to end. The seeded tenant is read only, via each
// detector's own `run()` (rulings Task 21) — never record_insights.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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
import { MODULE_DISABLED_MESSAGE } from "@/lib/modules/catalog";
import { DETECTORS } from "@/modules/insights/detectors/index";
import { createRunnerPorts, runOnceCore } from "@/modules/jobs/runner";
import {
  plantAcademicSetup,
  plantAdmissions,
  plantAttendance,
  plantFees,
  plantMarks,
  plantStudent,
  plantTimetable,
} from "../helpers/insight-fixtures";
import { closeRolesHelper, createTestInstitution, type FixtureRole, type TestInstitution } from "../helpers/roles";
import { withoutSweeps } from "../helpers/runner-ports";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

function adminClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
}

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

// 05 §4.1 default statuses, mirrors insights-detect-job.test.ts.
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

/** Flips one module key in-place; keeps every other key `createTestInstitution` set (allModulesOn). */
async function setModule(institutionId: string, key: string, on: boolean): Promise<void> {
  await sql`
    update public.institutions
    set settings = jsonb_set(settings, array['modules', ${key}]::text[], to_jsonb(${on}))
    where id = ${institutionId}
  `;
}

/** Calendar date (YYYY-MM-DD) of `d` in Asia/Kolkata — the sweep's own tz fallback. */
function istDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

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

function queryUrl(name: string, institution: string, input: unknown): URL {
  const url = new URL(`http://localhost/api/v1/query/${name}`);
  url.searchParams.set("institution", institution);
  url.searchParams.set("input", JSON.stringify(input));
  return url;
}

function dispatchQuery(name: string, institution: string, input: unknown, headers: Record<string, string>): Promise<Response> {
  return queryGet(new Request(queryUrl(name, institution, input), { headers }), { params: Promise.resolve({ name }) });
}

async function tokenFor(inst: TestInstitution, role: FixtureRole): Promise<string> {
  const { data, error } = await inst.clientAs(role).auth.getSession();
  if (error || !data.session) throw error ?? new Error(`no session for ${role}`);
  return data.session.access_token;
}

async function domainCounts(institutionId: string): Promise<Record<string, number>> {
  const rows = await sql`select domain, count(*)::int as n from public.insights where institution_id = ${institutionId} group by domain`;
  const out: Record<string, number> = {};
  for (const r of rows) out[r.domain as string] = r.n as number;
  return out;
}

describe("M19 insights acceptance: real runner on a fixture tenant, HTTP review, module gate, seeded-tenant read", () => {
  it(
    "real runOnceCore detects every domain, a rerun is a no-op; principal reviews/dismisses over HTTP; teacher sees only " +
      "taught-section rows; guardian is forbidden; institution B (insights off) enqueues nothing and is gated",
    async () => {
      const admin = adminClient();
      const inst = await createTestInstitution("insights-acceptance");
      try {
        const asOf = istDate(new Date(Date.now() - 24 * 60 * 60 * 1000)); // local yesterday — the sweep's own rule
        await setAttendanceStatuses(inst.institutionId);
        const setup = await plantAcademicSetup(sql, inst.institutionId);

        // --- attendance.student_drop (same combo as T14's job test) ----------
        const studentAtt = await plantStudent(sql, inst.institutionId, setup.classSectionId, setup.academicYearId);
        const recentSessions = Array.from({ length: 7 }, (_, i) => ({
          daysAgo: i,
          records: { [studentAtt]: i < 3 ? "P" : "A" },
        }));
        const baseSessions = Array.from({ length: 10 }, (_, i) => ({
          daysAgo: 7 + i,
          records: { [studentAtt]: "P" },
        }));
        await plantAttendance(sql, inst.institutionId, setup.classSectionId, asOf, [...recentSessions, ...baseSessions]);

        // --- academics.marks_decline (80% -> 60%, 20pt drop >= 15pt min) -----
        const studentMarks = await plantStudent(sql, inst.institutionId, setup.classSectionId, setup.academicYearId);
        await plantMarks(sql, inst.institutionId, setup, asOf, [
          { daysAgo: 100, marks: [{ studentId: studentMarks, marksObtained: 80 }] },
          { daysAgo: 10, marks: [{ studentId: studentMarks, marksObtained: 60 }] },
        ]);

        // --- finance.overdue_growth (paid before "then", reversed after "then") ---
        const studentFee = await plantStudent(sql, inst.institutionId, setup.classSectionId, setup.academicYearId);
        await plantFees(sql, inst.institutionId, setup.academicYearId, setup.termId, asOf, {
          invoices: [
            {
              studentId: studentFee,
              total: 30000,
              dueDaysAgo: 40,
              payments: [{ amount: 30000, receivedDaysAgo: 35, reversalDaysAgo: 5 }],
            },
          ],
        });

        // --- admissions.stage_dwell (6 new enquiries stale past the 2-day threshold) ---
        await plantAdmissions(sql, inst.institutionId, asOf, {
          enquiries: Array.from({ length: 6 }, () => ({ status: "new" as const, createdDaysAgo: 3, updatedDaysAgo: 3 })),
        });

        // --- staff.workload + operations.room_capacity: one teacher, one small
        // room, 4 weekdays x 12 periods (periods.seq is capped at 12) = 48
        // periods/week (> the 36 default limit) all in a 30-seat room, with 43
        // students enrolled in the section (> 30). -----------------------------
        const [{ staff_id: teacherStaffId }] = (await sql`
          select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'
        `) as unknown as [{ staff_id: string }];
        for (let i = 0; i < 40; i++) {
          await plantStudent(sql, inst.institutionId, setup.classSectionId, setup.academicYearId);
        }
        const periods = Array.from({ length: 12 }, (_, i) => ({ seq: i + 1 }));
        const slots = [1, 2, 3, 4].flatMap((weekday) =>
          periods.map((p) => ({
            weekday,
            periodSeq: p.seq,
            teacherStaffId,
            classSectionId: setup.classSectionId,
            subjectId: setup.subjectId,
            roomName: "Room-30",
          })),
        );
        await plantTimetable(sql, inst.institutionId, setup.academicYearId, inst.users.admin.id, {
          periods,
          rooms: [{ name: "Room-30", capacity: 30 }],
          status: "published",
          slots,
        });

        // Teacher becomes the class teacher of the fixture section, so its
        // attendance/academics rows (and only those) are visible to it.
        await sql`update public.class_sections set class_teacher_id = ${teacherStaffId} where id = ${setup.classSectionId}`;

        // --- Run 1: real runner sweep + claim/dispatch ------------------------
        const ports = withoutSweeps(createRunnerPorts(admin), ["enqueueDueInsights"]);
        await runOnceCore({ workerId: "insights-acceptance-worker" }, ports);

        const counts = await domainCounts(inst.institutionId);
        for (const domain of ["attendance", "academics", "finance", "admissions", "operations", "staff"]) {
          expect(counts[domain], `expected >= 1 ${domain} insight`).toBeGreaterThanOrEqual(1);
        }
        const rows = await sql`
          select evidence, confidence, detector_version, status from public.insights where institution_id = ${inst.institutionId}
        `;
        for (const row of rows) {
          expect(Array.isArray(row.evidence) && row.evidence.length > 0).toBe(true);
          expect(Number(row.confidence)).toBeGreaterThanOrEqual(0);
          expect(Number(row.confidence)).toBeLessThanOrEqual(1);
          expect(row.detector_version).toBe(1);
          expect(row.status).toBe("new");
        }
        const totalAfterRun1 = rows.length;

        // --- Run 2: no new job, no new rows ------------------------------------
        await runOnceCore({ workerId: "insights-acceptance-worker" }, ports);
        const rowsAfterRun2 = await sql`select id from public.insights where institution_id = ${inst.institutionId}`;
        expect(rowsAfterRun2).toHaveLength(totalAfterRun1);

        // --- HTTP: principal reviews, then dismisses, a finance insight -------
        const principalAuth = { authorization: `Bearer ${await tokenFor(inst, "principal")}` };
        const teacherAuth = { authorization: `Bearer ${await tokenFor(inst, "teacher")}` };
        const guardianAuth = { authorization: `Bearer ${await tokenFor(inst, "guardian")}` };

        const [financeInsight] = await sql`
          select id from public.insights where institution_id = ${inst.institutionId} and domain = 'finance' limit 1
        `;
        const reviewRes = await dispatchAction(
          "insight.review",
          { institution: inst.slug, input: { insightId: financeInsight.id } },
          principalAuth,
        );
        expect(reviewRes.status).toBe(200);
        const reviewBody = await reviewRes.json();
        expect(reviewBody.ok).toBe(true);
        expect(reviewBody.data.status).toBe("reviewing");

        const dismissRes = await dispatchAction(
          "insight.dismiss",
          { institution: inst.slug, input: { insightId: financeInsight.id, note: "Reviewed and no action needed." } },
          principalAuth,
        );
        expect(dismissRes.status).toBe(200);
        const dismissBody = await dismissRes.json();
        expect(dismissBody.ok).toBe(true);
        expect(dismissBody.data.status).toBe("dismissed");

        // --- HTTP: teacher sees only its taught section's attendance/academics ---
        const teacherListRes = await dispatchQuery("insights.list", inst.slug, {}, teacherAuth);
        expect(teacherListRes.status).toBe(200);
        const teacherListBody = await teacherListRes.json();
        expect(teacherListBody.ok).toBe(true);
        expect(teacherListBody.data.length).toBeGreaterThan(0);
        for (const row of teacherListBody.data) {
          expect(["attendance", "academics"]).toContain(row.domain);
        }

        // --- HTTP: guardian is forbidden ---------------------------------------
        const guardianListRes = await dispatchQuery("insights.list", inst.slug, {}, guardianAuth);
        expect(guardianListRes.status).toBe(403);

        // --- Institution B: insights off => sweep enqueues nothing, gated query ---
        const instB = await createTestInstitution("insights-acceptance-b");
        try {
          await setModule(instB.institutionId, "insights", false);
          const sweepB = await admin.rpc("enqueue_insight_detection");
          expect(sweepB.error).toBeNull();
          const jobsB = await sql`
            select id from public.jobs where institution_id = ${instB.institutionId} and type = 'insights.detect'
          `;
          expect(jobsB).toHaveLength(0);

          const principalBAuth = { authorization: `Bearer ${await tokenFor(instB, "principal")}` };
          const listBRes = await dispatchQuery("insights.list", instB.slug, {}, principalBAuth);
          expect(listBRes.status).toBe(403);
          const listBBody = await listBRes.json();
          expect(listBBody.error.message).toBe(MODULE_DISABLED_MESSAGE);
        } finally {
          await instB.cleanup();
        }
      } finally {
        await inst.cleanup();
      }
    },
    60_000,
  );

  it("seeded demo tenant: every detector's run() against real data, read-only, >= 1 attendance candidate", async () => {
    const admin = adminClient();
    const [demo] = await sql`select id, settings from public.institutions where slug = 'st-josephs-demo'`;
    if (!demo) throw new Error("Demo institution not found — run `pnpm db:reset` first.");
    const demoId = demo.id as string;
    const demoSettings = (demo.settings ?? {}) as Record<string, unknown>;
    const asOf = "2026-10-28";

    // No write: a detector's run() only ever selects via its source rpc.
    // Snapshot rather than assert zero — another institution's real sweep
    // (this file's first test, or a prior run against this shared stack)
    // may already have written real rows for this tenant.
    const before = await sql`select count(*)::int as n from public.insights where institution_id = ${demoId}`;

    const perDomain: Record<string, number> = {};
    for (const detector of DETECTORS) {
      const candidates = await detector.run(admin, { institutionId: demoId, asOf, settings: demoSettings });
      for (const c of candidates) perDomain[c.domain] = (perDomain[c.domain] ?? 0) + 1;
    }

    // T21 rulings: print per-domain counts into the report.
    console.log("M19-T21 seeded-tenant per-domain candidate counts:", perDomain);

    expect(perDomain.attendance ?? 0).toBeGreaterThanOrEqual(1);

    const after = await sql`select count(*)::int as n from public.insights where institution_id = ${demoId}`;
    expect(after[0].n).toBe(before[0].n);
  }, 30_000);
});
