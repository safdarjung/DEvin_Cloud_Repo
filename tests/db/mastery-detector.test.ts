// M20-T12 — gap detector `mastery_gap_v1` (M20-tasks.md rulings "Gap
// detector", "Interventions", "AI boundary"; Task 12 TEST FIRST). Handler end
// to end on the T4/T5 fixture: real admin client, real compute_mastery, real
// record_insights (M19's writer) and T6's guard on the plan insert.
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { masteryCompute } from "@/modules/jobs/handlers/mastery.compute";
import { runMasteryGapDetector } from "@/modules/mastery/detector";
import type { JobRow } from "@/modules/jobs/types";
import {
  buildMasteryFixture,
  closeMasteryFixtureHelper,
  publishExam,
  type MasteryFixture,
} from "../helpers/mastery-fixture";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

process.env.SERVICE_ROLE_CALLER = "test";
const { createAdminClient } = await import("@/lib/supabase/admin");
const admin = createAdminClient();
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeMasteryFixtureHelper();
  await closeRolesHelper();
});

const createdInstitutions: TestInstitution[] = [];
afterEach(async () => {
  await Promise.all(createdInstitutions.splice(0).map((inst) => inst.cleanup()));
});

async function newInst(label: string): Promise<{ inst: TestInstitution; fx: MasteryFixture }> {
  const inst = await createTestInstitution(label);
  createdInstitutions.push(inst);
  const fx = await buildMasteryFixture(inst);
  return { inst, fx };
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

/** Institution-local today (fixture institutions carry no locale → Asia/Kolkata). */
function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

function plusDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** One published exam: Maths paper → both Maths units, Science paper → both Science units. */
async function examFor(
  inst: TestInstitution,
  fx: MasteryFixture,
  studentId: string,
  maths: number,
  science: number,
  classSectionId = fx.sections.a,
) {
  await publishExam(inst, fx, {
    classSectionId,
    unitIdsBySubject: { maths: fx.subjects.maths.units, science: fx.subjects.science.units },
    marks: [
      { studentId, subjectKey: "maths", marksObtained: maths },
      { studentId, subjectKey: "science", marksObtained: science },
    ],
  });
}

async function insightsFor(institutionId: string) {
  return sql`select * from public.insights where institution_id = ${institutionId}::uuid order by entity_id`;
}

async function plansFor(institutionId: string) {
  return sql`
    select * from public.insight_actions
    where institution_id = ${institutionId}::uuid and kind = 'intervention'
    order by student_id
  `;
}

async function studentNameParts(studentId: string): Promise<string[]> {
  const [row] = await sql`select first_name, last_name from public.students where id = ${studentId}::uuid`;
  return [row.first_name as string, row.last_name as string | null].filter((p): p is string => !!p);
}

describe("mastery gap detector (mastery_gap_v1)", () => {
  it("a support student gets one insight + one proposed plan; watch/none students get nothing", async () => {
    const { inst, fx } = await newInst("mastery-det-support");
    // Support: 4 gap units (Maths 10%, Science 30%), mean 0.20 → critical.
    await examFor(inst, fx, fx.students.fixture, 10, 30);
    // Watch: 2 gap units (Maths 50%), Science 80% → mean 0.65.
    await examFor(inst, fx, fx.students.a2, 50, 80);
    // None: 90% everywhere, section B.
    await examFor(inst, fx, fx.students.b1, 90, 90, fx.sections.b);

    await masteryCompute(makeJob(inst.institutionId), { admin });

    const insights = await insightsFor(inst.institutionId);
    expect(insights).toHaveLength(1);
    const insight = insights[0];
    const day = today();
    expect(insight).toMatchObject({
      signal: "academics.mastery_gap",
      detector_version: 1,
      dedupe_key: `academics.mastery_gap:student:${fx.students.fixture}:${fx.termId}`,
      domain: "academics",
      kind: "diagnostic",
      severity: "critical",
      title: "Learning gaps need support",
      pattern: "4 units below 60% mastery; overall 20%",
      evidence: [
        { label: "Gap units", value: 4 },
        { label: "Overall mastery", value: 20, unit: "%" },
        { label: "Units assessed", value: 4 },
        { label: "Maths · Algebra basics", value: 10, unit: "%" },
        { label: "Maths · Geometry basics", value: 10, unit: "%" },
        { label: "Science · Forces", value: 30, unit: "%" },
        { label: "Science · Energy", value: 30, unit: "%" },
      ],
      sources: ["mastery.gapsForStudent"],
      factors: [],
      reviewer_role: "teacher",
      recommended_actions: [
        "Review the proposed intervention plan",
        "Re-teach the weakest units",
        "Re-assess after the plan's review date",
      ],
      approval_required: true,
      status: "new",
      entity_type: "student",
      entity_id: fx.students.fixture,
      // M19 check: no label stored for student entities; the read path resolves the name.
      entity_label: null,
      class_section_id: fx.sections.a,
    });
    expect(Number(insight.confidence)).toBe(0.67);
    const [year] = await sql`select starts_on from public.academic_years where id = ${fx.academicYearId}::uuid`;
    expect((insight.date_from as Date).toISOString().slice(0, 10)).toBe(
      (year.starts_on as Date).toISOString().slice(0, 10),
    );
    expect((insight.date_to as Date).toISOString().slice(0, 10)).toBe(day);

    // AI boundary: no student name in what M19's explain prompt may carry.
    const exposed = JSON.stringify(insight.evidence) + insight.pattern;
    for (const part of await studentNameParts(fx.students.fixture)) expect(exposed).not.toContain(part);

    const plans = await plansFor(inst.institutionId);
    expect(plans).toHaveLength(1);
    const [teacher] = await sql`select full_name from public.staff where id = ${fx.teacherStaffId}::uuid`;
    expect(plans[0]).toMatchObject({
      insight_id: insight.id,
      kind: "intervention",
      student_id: fx.students.fixture,
      action: "Intervention plan",
      owner: teacher.full_name,
      owner_staff_id: fx.teacherStaffId,
      rationale: "mastery_gap_v1: 4 gap units, overall 20%",
      expected_outcome: "Listed units at or above 60% mastery",
      goal: "Raise 3 gap units to 60% mastery",
      steps: [
        { title: "Re-teach: Algebra basics (Maths)", due: plusDays(day, 7), done: false },
        { title: "Re-teach: Geometry basics (Maths)", due: plusDays(day, 14), done: false },
        { title: "Re-teach: Forces (Science)", due: plusDays(day, 21), done: false },
        { title: "Re-assess gap units", due: plusDays(day, 28), done: false },
      ],
      intervention_status: "proposed",
      status: "planned",
    });
    expect((plans[0].review_date as Date).toISOString().slice(0, 10)).toBe(plusDays(day, 28));
    const planText = `${plans[0].goal} ${JSON.stringify(plans[0].steps)} ${plans[0].rationale}`;
    for (const part of await studentNameParts(fx.students.fixture)) expect(planText).not.toContain(part);
  });

  it("a second run duplicates nothing; a mark change refreshes the open insight; statuses never change", async () => {
    const { inst, fx } = await newInst("mastery-det-refresh");
    await examFor(inst, fx, fx.students.fixture, 10, 30);
    await masteryCompute(makeJob(inst.institutionId), { admin });

    const [before] = await insightsFor(inst.institutionId);
    const [planBefore] = await plansFor(inst.institutionId);
    // Teacher picked it up: insight reviewing, plan active (direct postgres = trusted writer).
    await sql`update public.insights set status = 'reviewing' where id = ${before.id}::uuid`;
    await sql`update public.insight_actions set intervention_status = 'active' where id = ${planBefore.id}::uuid`;

    expect(await runMasteryGapDetector(admin, inst.institutionId)).toEqual({ created: 0, refreshed: 1, plans: 0 });

    // Science re-test at 70% → Science units (0.3·2 + 0.7·2)/4 = 0.50; mean 0.30 → warning.
    await examFor(inst, fx, fx.students.fixture, 10, 70);
    await masteryCompute(makeJob(inst.institutionId), { admin });

    const insights = await insightsFor(inst.institutionId);
    const plans = await plansFor(inst.institutionId);
    expect(insights).toHaveLength(1);
    expect(plans).toHaveLength(1);
    expect(insights[0]).toMatchObject({
      id: before.id,
      status: "reviewing",
      severity: "warning",
      pattern: "4 units below 60% mastery; overall 30%",
      evidence: [
        { label: "Gap units", value: 4 },
        { label: "Overall mastery", value: 30, unit: "%" },
        { label: "Units assessed", value: 4 },
        { label: "Maths · Algebra basics", value: 10, unit: "%" },
        { label: "Maths · Geometry basics", value: 10, unit: "%" },
        { label: "Science · Forces", value: 50, unit: "%" },
        { label: "Science · Energy", value: 50, unit: "%" },
      ],
    });
    expect(plans[0]).toMatchObject({ id: planBefore.id, intervention_status: "active", status: "planned" });
    expect(plans[0].steps).toEqual(planBefore.steps);
  });

  it("a dismissed insight stays untouched and no new one is raised this term", async () => {
    const { inst, fx } = await newInst("mastery-det-dismissed");
    await examFor(inst, fx, fx.students.fixture, 10, 30);
    await masteryCompute(makeJob(inst.institutionId), { admin });

    const [insight] = await insightsFor(inst.institutionId);
    await sql`update public.insights set status = 'dismissed' where id = ${insight.id}::uuid`;
    const [dismissed] = await insightsFor(inst.institutionId);

    await examFor(inst, fx, fx.students.fixture, 10, 70);
    await sql`select public.compute_mastery(${inst.institutionId}::uuid)`;
    expect(await runMasteryGapDetector(admin, inst.institutionId)).toEqual({ created: 0, refreshed: 0, plans: 0 });

    const after = await insightsFor(inst.institutionId);
    expect(after).toHaveLength(1);
    expect(after[0]).toEqual(dismissed);
    expect(await plansFor(inst.institutionId)).toHaveLength(1);
  });

  it("an open insight without a plan gets the proposed plan", async () => {
    const { inst, fx } = await newInst("mastery-det-noplan");
    await examFor(inst, fx, fx.students.fixture, 10, 30);
    await sql`select public.compute_mastery(${inst.institutionId}::uuid)`;
    const [open] = await sql`
      insert into public.insights (
        institution_id, signal, detector_version, dedupe_key, domain, kind, severity,
        title, pattern, evidence, date_from, date_to, confidence, reviewer_role,
        entity_type, entity_id, class_section_id, status
      )
      values (
        ${inst.institutionId}, 'academics.mastery_gap', 1,
        ${`academics.mastery_gap:student:${fx.students.fixture}:${fx.termId}`},
        'academics', 'diagnostic', 'warning', 'Learning gaps need support', 'stale', ${sql.json([{ label: "Gap units", value: 1 }])},
        ${today()}, ${today()}, 0.1, 'teacher', 'student', ${fx.students.fixture}, ${fx.sections.a}, 'reviewing'
      )
      returning id
    `;

    expect(await runMasteryGapDetector(admin, inst.institutionId)).toEqual({ created: 0, refreshed: 1, plans: 1 });

    const insights = await insightsFor(inst.institutionId);
    expect(insights).toHaveLength(1);
    expect(insights[0]).toMatchObject({ id: open.id, status: "reviewing", pattern: "4 units below 60% mastery; overall 20%" });
    const plans = await plansFor(inst.institutionId);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ insight_id: open.id, intervention_status: "proposed", owner_staff_id: fx.teacherStaffId });
  });
});
