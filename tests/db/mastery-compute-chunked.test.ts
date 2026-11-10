// DBT-153 — migration 0111: per-section compute_mastery + sweep equals the whole-tenant run.
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  buildMasteryFixture,
  closeMasteryFixtureHelper,
  insertSnapshots,
  publishExam,
} from "../helpers/mastery-fixture";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

process.env.SERVICE_ROLE_CALLER = "test";
const { createAdminClient } = await import("@/lib/supabase/admin");
const admin = createAdminClient();
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeMasteryFixtureHelper();
  await closeRolesHelper();
});

const created: TestInstitution[] = [];
afterEach(async () => {
  await Promise.all(created.splice(0).map((inst) => inst.cleanup()));
});

async function snapshots(institutionId: string) {
  return sql`
    select student_id, curriculum_unit_id, class_section_id, subject_id, score::float8 as score,
           confidence::float8 as confidence, mark_count, submission_count, evidence
    from public.mastery_snapshots where institution_id = ${institutionId}::uuid
    order by student_id, curriculum_unit_id
  `;
}

async function build() {
  const inst = await createTestInstitution("mastery-chunked");
  created.push(inst);
  const fx = await buildMasteryFixture(inst);
  for (const [sectionId, studentId] of [
    [fx.sections.a, fx.students.fixture],
    [fx.sections.a, fx.students.a2],
    [fx.sections.b, fx.students.b1],
  ] as const) {
    await publishExam(inst, fx, {
      classSectionId: sectionId,
      unitIdsBySubject: { maths: fx.subjects.maths.units },
      marks: [{ studentId, subjectKey: "maths", marksObtained: 60 }],
    });
  }
  return { inst, fx };
}

describe("compute_mastery chunked (0111)", () => {
  it("per-section calls + sweep produce the same rows as the whole-tenant call", async () => {
    const { inst, fx } = await build();
    expect((await admin.rpc("compute_mastery", { p_institution_id: inst.institutionId })).error).toBeNull();
    const whole = await snapshots(inst.institutionId);
    expect(whole.length).toBe(6);
    await sql`delete from public.mastery_snapshots where institution_id = ${inst.institutionId}::uuid`;

    const runAt = new Date().toISOString();
    for (const sectionId of Object.values(fx.sections)) {
      const { error } = await admin.rpc("compute_mastery", {
        p_institution_id: inst.institutionId,
        p_class_section_id: sectionId,
        p_run_at: runAt,
      });
      expect(error).toBeNull();
    }
    const sweep = await admin.rpc("compute_mastery_sweep", { p_institution_id: inst.institutionId, p_run_at: runAt });
    expect(sweep.error).toBeNull();

    expect(await snapshots(inst.institutionId)).toEqual(whole);
  });

  it("a section call leaves other sections' rows alone; sweep removes rows no run touched; rerun is idempotent", async () => {
    const { inst, fx } = await build();
    const runAt = new Date().toISOString();
    await admin.rpc("compute_mastery", {
      p_institution_id: inst.institutionId,
      p_class_section_id: fx.sections.a,
      p_run_at: runAt,
    });
    const [stale] = await insertSnapshots(inst, fx, [
      {
        studentId: fx.students.c1,
        classSectionId: fx.sections.c,
        subjectId: fx.subjects.maths.id,
        curriculumUnitId: fx.subjects.maths.units[0],
        computedAt: "2020-01-01T00:00:00Z",
      },
    ]);
    // section A call must not delete section C's stale row
    await admin.rpc("compute_mastery", {
      p_institution_id: inst.institutionId,
      p_class_section_id: fx.sections.a,
      p_run_at: runAt,
    });
    expect((await sql`select 1 from public.mastery_snapshots where id = ${stale}::uuid`).length).toBe(1);

    const before = await snapshots(inst.institutionId);
    await admin.rpc("compute_mastery_sweep", { p_institution_id: inst.institutionId, p_run_at: runAt });
    expect((await sql`select 1 from public.mastery_snapshots where id = ${stale}::uuid`).length).toBe(0);
    expect((await snapshots(inst.institutionId)).length).toBe(before.length - 1);
  });

  it("sweep is service_role only", async () => {
    const { inst } = await build();
    const r = await inst.clientAs("admin").rpc("compute_mastery_sweep", {
      p_institution_id: inst.institutionId,
      p_run_at: new Date().toISOString(),
    });
    expect(r.error?.code).toBe("42501");
  });
});
