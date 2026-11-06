// M20-T14 — mastery acceptance over HTTP (M20-tasks.md Task 14). Dispatches
// through the real /api/v1/actions and /api/v1/query route handlers with
// real bearer tokens (real RLS) — mirrors tests/db/timetable-acceptance.test.ts
// and tests/db/exam-seating-acceptance.test.ts (no @/lib/supabase/server
// mock; only next/headers + next/cache). The compute+detect step runs the
// job handler directly as service role (mirrors tests/db/mastery-detector.test.ts),
// since nothing dispatches `mastery.compute` over HTTP.
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
import { masteryCompute } from "@/modules/jobs/handlers/mastery.compute";
import type { JobRow } from "@/modules/jobs/types";
import { buildMasteryFixture, closeMasteryFixtureHelper, insertGapPlan, type MasteryFixture } from "../helpers/mastery-fixture";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

process.env.SERVICE_ROLE_CALLER = "test";
const { createAdminClient } = await import("@/lib/supabase/admin");
const admin = createAdminClient();

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

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

async function tokenFor(inst: TestInstitution, role: Parameters<TestInstitution["clientAs"]>[0]): Promise<string> {
  const { data, error } = await inst.clientAs(role).auth.getSession();
  if (error || !data.session) throw error ?? new Error(`no session for ${role}`);
  return data.session.access_token;
}

function makeJob(institutionId: string): JobRow {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    institution_id: institutionId,
    type: "mastery.compute",
    payload: {},
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

/** Service-role insert of one published exam + one draft (unit_ids '{}') maths paper per section. */
async function makePapers(
  inst: TestInstitution,
  fx: MasteryFixture,
  sections: string[],
): Promise<Record<string, string>> {
  const [exam] = await sql`
    insert into public.exams (institution_id, academic_year_id, term_id, name, type, status, published_at)
    values (
      ${inst.institutionId}, ${fx.academicYearId}, ${fx.termId}, ${`Acceptance-${crypto.randomUUID().slice(0, 8)}`},
      'unit_test', 'published', now()
    )
    returning id
  `;
  const bySection: Record<string, string> = {};
  for (const sectionId of sections) {
    const [paper] = await sql`
      insert into public.exam_papers (institution_id, exam_id, class_section_id, subject_id, max_marks, pass_marks, unit_ids)
      values (${inst.institutionId}, ${exam.id}, ${sectionId}, ${fx.subjects.maths.id}, 100, 33, '{}')
      returning id
    `;
    bySection[sectionId] = paper.id as string;
  }
  return bySection;
}

async function insertMark(inst: TestInstitution, paperId: string, studentId: string, marksObtained: number): Promise<void> {
  await sql`
    insert into public.marks (institution_id, exam_paper_id, student_id, marks_obtained)
    values (${inst.institutionId}, ${paperId}, ${studentId}, ${marksObtained})
  `;
}

afterAll(async () => {
  await sql.end();
  await closeMasteryFixtureHelper();
  await closeRolesHelper();
});

describe("M20 mastery acceptance: HTTP flow", () => {
  it(
    "exam_controller sets paper units, compute+detect runs, students/guardian/teacher read scoped results, " +
      "class teacher updates an intervention plan, admin cannot see it",
    async () => {
      const inst = await createTestInstitution("mastery-acceptance");
      try {
        const fx = await buildMasteryFixture(inst);
        const papers = await makePapers(inst, fx, [fx.sections.a, fx.sections.c]);

        // --- exam_controller sets paper units over HTTP -----------------------
        const examControllerAuth = { authorization: `Bearer ${await tokenFor(inst, "exam_controller")}` };
        const setUnitsRes = await dispatchAction(
          "exam.paper.setUnits",
          { institution: inst.slug, input: { paperId: papers[fx.sections.a], unitIds: fx.subjects.maths.units } },
          examControllerAuth,
        );
        expect(setUnitsRes.status).toBe(200);
        const setUnitsBody = await setUnitsRes.json();
        expect(setUnitsBody.ok).toBe(true);
        expect(setUnitsBody.data.unitIds).toEqual(fx.subjects.maths.units);

        // Section C's paper is mapped directly (service role) — only used to prove the
        // teacher's heatmap excludes it, not part of the HTTP flow under test.
        await sql`update public.exam_papers set unit_ids = ${fx.subjects.maths.units} where id = ${papers[fx.sections.c]}`;

        // Marks: fixture student + A2 (section A, gap: 30%); C1 (section C, not a gap: 80%).
        await insertMark(inst, papers[fx.sections.a], fx.students.fixture, 30);
        await insertMark(inst, papers[fx.sections.a], fx.students.a2, 30);
        await insertMark(inst, papers[fx.sections.c], fx.students.c1, 80);

        // --- compute + detect, service role (no HTTP surface for the job) -----
        await masteryCompute(makeJob(inst.institutionId), { admin });

        // --- student: own gaps vs. another student's (RLS-empty) --------------
        const studentAuth = { authorization: `Bearer ${await tokenFor(inst, "student")}` };
        const ownGapsRes = await dispatchQuery("mastery.gapsForStudent", inst.slug, { studentId: fx.students.fixture }, studentAuth);
        expect(ownGapsRes.status).toBe(200);
        const ownGapsBody = await ownGapsRes.json();
        expect(ownGapsBody.ok).toBe(true);
        expect(ownGapsBody.data.length).toBeGreaterThan(0);

        const otherGapsRes = await dispatchQuery("mastery.gapsForStudent", inst.slug, { studentId: fx.students.a2 }, studentAuth);
        expect(otherGapsRes.status).toBe(200);
        const otherGapsBody = await otherGapsRes.json();
        expect(otherGapsBody.ok).toBe(true);
        expect(otherGapsBody.data).toEqual([]);

        // --- guardian: own child's gaps -----------------------------------------
        const guardianAuth = { authorization: `Bearer ${await tokenFor(inst, "guardian")}` };
        const guardianGapsRes = await dispatchQuery(
          "mastery.gapsForStudent",
          inst.slug,
          { studentId: fx.students.fixture },
          guardianAuth,
        );
        expect(guardianGapsRes.status).toBe(200);
        const guardianGapsBody = await guardianGapsRes.json();
        expect(guardianGapsBody.ok).toBe(true);
        expect(guardianGapsBody.data.length).toBeGreaterThan(0);

        // --- teacher: heatmap scoped to taught sections only (A, not C) --------
        const teacherAuth = { authorization: `Bearer ${await tokenFor(inst, "teacher")}` };
        const heatmapRes = await dispatchQuery("mastery.heatmapBySection", inst.slug, {}, teacherAuth);
        expect(heatmapRes.status).toBe(200);
        const heatmapBody = await heatmapRes.json();
        expect(heatmapBody.ok).toBe(true);
        expect(heatmapBody.data.some((cell: { section_id: string }) => cell.section_id === fx.sections.a)).toBe(true);
        expect(heatmapBody.data.every((cell: { section_id: string }) => cell.section_id !== fx.sections.c)).toBe(true);

        // --- accountant: no mastery permission at all -> 403 -------------------
        const accountantAuth = { authorization: `Bearer ${await tokenFor(inst, "accountant")}` };
        const accountantRes = await dispatchQuery("mastery.heatmapBySection", inst.slug, {}, accountantAuth);
        expect(accountantRes.status).toBe(403);
        const accountantBody = await accountantRes.json();
        expect(accountantBody).toMatchObject({ ok: false, error: { code: "forbidden" } });

        // --- class teacher updates the proposed plan; admin can't see it -------
        const plan = await insertGapPlan(inst, fx, fx.students.fixture, "proposed");
        const updateRes = await dispatchAction(
          "mastery.intervention.update",
          { institution: inst.slug, input: { id: plan.actionId, status: "active" } },
          teacherAuth,
        );
        expect(updateRes.status).toBe(200);
        const updateBody = await updateRes.json();
        expect(updateBody.ok).toBe(true);
        expect(updateBody.data.status).toBe("active");

        const adminAuth = { authorization: `Bearer ${await tokenFor(inst, "admin")}` };
        const adminUpdateRes = await dispatchAction(
          "mastery.intervention.update",
          { institution: inst.slug, input: { id: plan.actionId, status: "review" } },
          adminAuth,
        );
        expect(adminUpdateRes.status).toBe(404);
        const adminUpdateBody = await adminUpdateRes.json();
        expect(adminUpdateBody).toMatchObject({ ok: false, error: { code: "not_found" } });
      } finally {
        await inst.cleanup();
      }
    },
  );

  it("institution with mastery off -> 403 forbidden", async () => {
    const inst = await createTestInstitution("mastery-acceptance-module-off");
    try {
      await sql`
        update public.institutions
        set settings = jsonb_set(settings, '{modules,mastery}', 'false'::jsonb)
        where id = ${inst.institutionId}
      `;
      const examControllerAuth = { authorization: `Bearer ${await tokenFor(inst, "exam_controller")}` };

      const res = await dispatchAction(
        "exam.paper.setUnits",
        { institution: inst.slug, input: { paperId: crypto.randomUUID(), unitIds: [] } },
        examControllerAuth,
      );
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body).toMatchObject({ ok: false, error: { code: "forbidden", message: MODULE_DISABLED_MESSAGE } });
    } finally {
      await inst.cleanup();
    }
  });
});

describe("M20 mastery acceptance: demo tenant snapshot matches T13's formula", () => {
  it("Aarav Sharma's Mathematics unit-1 score = HY marks / max (3 dp), confidence 0.5 (deterministic on seed)", async () => {
    const [institution] = await sql`select id from public.institutions where slug = 'st-josephs-demo'`;
    if (!institution) throw new Error("Demo institution not found — run `pnpm demo:reset` first.");
    const institutionId = institution.id as string;

    const [hy] = await sql`
      select id from public.exams where institution_id = ${institutionId} and name = 'Half-Yearly Examination 2026'
    `;
    const [row] = await sql`
      select round(m.marks_obtained / ep.max_marks, 3) as expected_score, cu.id as unit_id
      from public.students s
      join public.marks m on m.student_id = s.id
      join public.exam_papers ep on ep.id = m.exam_paper_id and ep.exam_id = ${hy.id}
      join public.subjects sub on sub.id = ep.subject_id and sub.code = 'MATH'
      join public.class_sections cs on cs.id = ep.class_section_id
      join public.curriculum_units cu on cu.grade_id = cs.grade_id and cu.subject_id = ep.subject_id and cu.sequence = 1
      where s.first_name = 'Aarav' and s.last_name = 'Sharma' and s.institution_id = ${institutionId}
    `;
    expect(row).toBeTruthy();

    const [snapshot] = await sql`
      select score, confidence
      from public.mastery_snapshots ms
      join public.students s on s.id = ms.student_id
      where s.first_name = 'Aarav' and s.last_name = 'Sharma' and ms.curriculum_unit_id = ${row.unit_id}
    `;
    expect(snapshot).toBeTruthy();
    expect(Number(snapshot.score)).toBeCloseTo(Number(row.expected_score), 3);
    expect(Number(snapshot.confidence)).toBe(0.5);
  });
});
