// M20-T5 — migration 0093 part 2: public.compute_mastery,
// public.enqueue_mastery_compute sweep, public.mastery_heatmap,
// public.mastery_student_stats (M20-tasks.md rulings "Algorithm", "SQL read
// functions", "Scheduling", Task 5 TEST FIRST).
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  buildMasteryFixture,
  closeMasteryFixtureHelper,
  gradeSubmission,
  insertSnapshots,
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

async function setModule(institutionId: string, key: string, enabled: boolean): Promise<void> {
  await sql`
    update public.institutions
    set settings = jsonb_set(coalesce(settings, '{}'::jsonb), array['modules', ${key}], ${enabled}::text::jsonb)
    where id = ${institutionId}::uuid
  `;
}

async function jobsFor(institutionId: string, type: string) {
  return sql`select * from public.jobs where type = ${type} and institution_id = ${institutionId}::uuid`;
}

async function snapshotsFor(institutionId: string, studentId: string) {
  return sql`
    select * from public.mastery_snapshots
    where institution_id = ${institutionId}::uuid and student_id = ${studentId}::uuid
    order by curriculum_unit_id
  `;
}

async function newInst(label: string): Promise<{ inst: TestInstitution; fx: MasteryFixture }> {
  const inst = await createTestInstitution(label);
  createdInstitutions.push(inst);
  const fx = await buildMasteryFixture(inst);
  return { inst, fx };
}

describe("public.compute_mastery (0093)", () => {
  it("published paper mapped to 2 units: each marked student gets 2 rows, score = marks/max (3dp), confidence 0.5, mark_count 1, one evidence item", async () => {
    const { inst, fx } = await newInst("compute-two-units");
    await publishExam(inst, fx, {
      unitIdsBySubject: { maths: fx.subjects.maths.units },
      marks: [{ studentId: fx.students.fixture, subjectKey: "maths", marksObtained: 75 }],
    });

    const { error } = await admin.rpc("compute_mastery", { p_institution_id: inst.institutionId });
    expect(error).toBeNull();

    const rows = await snapshotsFor(inst.institutionId, fx.students.fixture);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(Number(row.score)).toBe(0.75);
      expect(Number(row.confidence)).toBe(0.5);
      expect(row.mark_count).toBe(1);
      expect(row.submission_count).toBe(0);
      expect((row.evidence as unknown[]).length).toBe(1);
    }
  });

  it("absent mark produces no row", async () => {
    const { inst, fx } = await newInst("compute-absent");
    await publishExam(inst, fx, {
      unitIdsBySubject: { maths: [fx.subjects.maths.units[0]] },
      marks: [{ studentId: fx.students.fixture, subjectKey: "maths", marksObtained: null, isAbsent: true }],
    });

    await admin.rpc("compute_mastery", { p_institution_id: inst.institutionId });
    expect(await snapshotsFor(inst.institutionId, fx.students.fixture)).toHaveLength(0);
  });

  it("only the current mark version counts", async () => {
    const { inst, fx } = await newInst("compute-superseded");
    const { paperIdsBySubject } = await publishExam(inst, fx, {
      unitIdsBySubject: { maths: [fx.subjects.maths.units[0]] },
      marks: [],
    });
    const paperId = paperIdsBySubject.maths!;

    // Both versions inserted together, old already pointing at new, so the
    // "one current row" deferred constraint never sees two (precedent:
    // tests/db/insight-sources-academic.test.ts).
    await sql`
      with new_mark as (
        insert into public.marks (institution_id, exam_paper_id, student_id, marks_obtained, version_no)
        values (${inst.institutionId}, ${paperId}, ${fx.students.fixture}, 80, 2)
        returning id
      )
      insert into public.marks (institution_id, exam_paper_id, student_id, marks_obtained, version_no, superseded_by)
      select ${inst.institutionId}, ${paperId}, ${fx.students.fixture}, 40, 1, new_mark.id from new_mark
    `;

    await admin.rpc("compute_mastery", { p_institution_id: inst.institutionId });
    const rows = await snapshotsFor(inst.institutionId, fx.students.fixture);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].score)).toBe(0.8);
  });

  it("a marks_entry exam is ignored (only published exams count)", async () => {
    const { inst, fx } = await newInst("compute-marks-entry");
    await publishExam(inst, fx, {
      status: "marks_entry",
      unitIdsBySubject: { maths: [fx.subjects.maths.units[0]] },
      marks: [{ studentId: fx.students.fixture, subjectKey: "maths", marksObtained: 90 }],
    });

    await admin.rpc("compute_mastery", { p_institution_id: inst.institutionId });
    expect(await snapshotsFor(inst.institutionId, fx.students.fixture)).toHaveLength(0);
  });

  it("exam mark (w2) + graded submission (w1) on one unit: score 0.7, confidence 0.75", async () => {
    const { inst, fx } = await newInst("compute-mark-plus-submission");
    const unitId = fx.subjects.maths.units[0];
    await publishExam(inst, fx, {
      unitIdsBySubject: { maths: [unitId] },
      marks: [{ studentId: fx.students.fixture, subjectKey: "maths", marksObtained: 80 }],
    });
    await gradeSubmission(inst, fx, {
      studentId: fx.students.fixture,
      classSectionId: fx.sections.a,
      subjectId: fx.subjects.maths.id,
      curriculumUnitId: unitId,
      score: 5,
      maxScore: 10,
    });

    await admin.rpc("compute_mastery", { p_institution_id: inst.institutionId });
    const rows = await snapshotsFor(inst.institutionId, fx.students.fixture);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].score)).toBe(0.7);
    expect(Number(rows[0].confidence)).toBe(0.75);
    expect(rows[0].mark_count).toBe(1);
    expect(rows[0].submission_count).toBe(1);
  });

  it("an ungraded submission is ignored", async () => {
    const { inst, fx } = await newInst("compute-ungraded");
    await gradeSubmission(inst, fx, {
      studentId: fx.students.fixture,
      classSectionId: fx.sections.a,
      subjectId: fx.subjects.maths.id,
      curriculumUnitId: fx.subjects.maths.units[0],
      score: 5,
      status: "submitted",
    });

    await admin.rpc("compute_mastery", { p_institution_id: inst.institutionId });
    expect(await snapshotsFor(inst.institutionId, fx.students.fixture)).toHaveLength(0);
  });

  it("unmapping a unit from the paper deletes its row on recompute", async () => {
    const { inst, fx } = await newInst("compute-unmap");
    const { paperIdsBySubject } = await publishExam(inst, fx, {
      unitIdsBySubject: { maths: fx.subjects.maths.units },
      marks: [{ studentId: fx.students.fixture, subjectKey: "maths", marksObtained: 75 }],
    });
    await admin.rpc("compute_mastery", { p_institution_id: inst.institutionId });
    expect(await snapshotsFor(inst.institutionId, fx.students.fixture)).toHaveLength(2);

    await sql`update public.exam_papers set unit_ids = ${[fx.subjects.maths.units[0]]} where id = ${paperIdsBySubject.maths!}`;
    await admin.rpc("compute_mastery", { p_institution_id: inst.institutionId });

    const rows = await snapshotsFor(inst.institutionId, fx.students.fixture);
    expect(rows).toHaveLength(1);
    expect(rows[0].curriculum_unit_id).toBe(fx.subjects.maths.units[0]);
  });

  it("a student with no active enrolment gets no row", async () => {
    const { inst, fx } = await newInst("compute-no-enrolment");
    const [unenrolled] = await sql`
      insert into public.students (institution_id, admission_no, first_name, dob, gender)
      values (${inst.institutionId}, ${`ADM-UNENR-${crypto.randomUUID().slice(0, 6)}`}, 'Test', '2014-01-01', 'other')
      returning id
    `;
    await publishExam(inst, fx, {
      unitIdsBySubject: { maths: [fx.subjects.maths.units[0]] },
      marks: [{ studentId: unenrolled.id as string, subjectKey: "maths", marksObtained: 75 }],
    });

    await admin.rpc("compute_mastery", { p_institution_id: inst.institutionId });
    expect(await snapshotsFor(inst.institutionId, unenrolled.id as string)).toHaveLength(0);
  });

  it("a rerun on unchanged data yields the same values and ids", async () => {
    const { inst, fx } = await newInst("compute-rerun");
    await publishExam(inst, fx, {
      unitIdsBySubject: { maths: [fx.subjects.maths.units[0]] },
      marks: [{ studentId: fx.students.fixture, subjectKey: "maths", marksObtained: 75 }],
    });

    await admin.rpc("compute_mastery", { p_institution_id: inst.institutionId });
    const first = await snapshotsFor(inst.institutionId, fx.students.fixture);
    await admin.rpc("compute_mastery", { p_institution_id: inst.institutionId });
    const second = await snapshotsFor(inst.institutionId, fx.students.fixture);

    expect(second).toHaveLength(1);
    expect(second[0].id).toBe(first[0].id);
    expect(Number(second[0].score)).toBe(Number(first[0].score));
    expect(Number(second[0].confidence)).toBe(Number(first[0].confidence));
  });

  it("authenticated cannot execute it (42501); service_role can", async () => {
    const { inst } = await newInst("compute-perm");
    const authed = await inst.clientAs("admin").rpc("compute_mastery", { p_institution_id: inst.institutionId });
    expect(authed.error?.code).toBe("42501");

    const asService = await admin.rpc("compute_mastery", { p_institution_id: inst.institutionId });
    expect(asService.error).toBeNull();
  });
});

describe("public.enqueue_mastery_compute (0093 sweep)", () => {
  it("mastery on: one mastery.compute job keyed by institution+local date; a repeat sweep adds nothing", async () => {
    const { inst } = await newInst("sweep-mastery-on");
    await setModule(inst.institutionId, "mastery", true);

    const first = await admin.rpc("enqueue_mastery_compute");
    expect(first.error).toBeNull();

    const jobs = await jobsFor(inst.institutionId, "mastery.compute");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].idempotency_key as string).toMatch(new RegExp(`^mastery\\.compute:${inst.institutionId}:\\d{8}$`));

    const second = await admin.rpc("enqueue_mastery_compute");
    expect(second.error).toBeNull();
    expect(await jobsFor(inst.institutionId, "mastery.compute")).toHaveLength(1);
  });

  it("mastery off: no job", async () => {
    const { inst } = await newInst("sweep-mastery-off");
    await setModule(inst.institutionId, "mastery", false);
    await admin.rpc("enqueue_mastery_compute");
    expect(await jobsFor(inst.institutionId, "mastery.compute")).toHaveLength(0);
  });

  it("authenticated cannot execute it (42501); service_role can", async () => {
    const { inst } = await newInst("sweep-perm");
    const authed = await inst.clientAs("admin").rpc("enqueue_mastery_compute");
    expect(authed.error?.code).toBe("42501");

    const asService = await admin.rpc("enqueue_mastery_compute");
    expect(asService.error).toBeNull();
  });
});

describe("public.mastery_heatmap / public.mastery_student_stats (0093)", () => {
  it("teacher's heatmap and student stats exclude section C", async () => {
    const { inst, fx } = await newInst("heatmap-teacher-scope");
    await insertSnapshots(inst, fx, [
      { studentId: fx.students.fixture, classSectionId: fx.sections.a, subjectId: fx.subjects.maths.id, curriculumUnitId: fx.subjects.maths.units[0] },
      { studentId: fx.students.b1, classSectionId: fx.sections.b, subjectId: fx.subjects.science.id, curriculumUnitId: fx.subjects.science.units[0] },
      { studentId: fx.students.c1, classSectionId: fx.sections.c, subjectId: fx.subjects.maths.id, curriculumUnitId: fx.subjects.maths.units[1] },
    ]);

    const heatmap = await inst.clientAs("teacher").rpc("mastery_heatmap", {
      p_academic_year_id: fx.academicYearId,
      p_class_section_id: null as unknown as string,
      p_subject_id: null as unknown as string,
      p_gap_threshold: 0.6,
      p_min_confidence: 0.5,
    });
    expect(heatmap.error).toBeNull();
    expect((heatmap.data as { class_section_id: string }[]).map((r) => r.class_section_id)).not.toContain(fx.sections.c);

    const stats = await inst.clientAs("teacher").rpc("mastery_student_stats", {
      p_academic_year_id: fx.academicYearId,
      p_class_section_id: null as unknown as string,
      p_gap_threshold: 0.6,
      p_min_confidence: 0.5,
    });
    expect(stats.error).toBeNull();
    expect((stats.data as { class_section_id: string }[]).map((r) => r.class_section_id)).not.toContain(fx.sections.c);
  });

  it("boundary: score 0.6 not counted as a gap, 0.599 counted, confidence 0.49 never counted", async () => {
    const { inst, fx } = await newInst("heatmap-boundary");
    await insertSnapshots(inst, fx, [
      {
        studentId: fx.students.fixture,
        classSectionId: fx.sections.a,
        subjectId: fx.subjects.maths.id,
        curriculumUnitId: fx.subjects.maths.units[0],
        score: 0.6,
        confidence: 0.5,
      },
      {
        studentId: fx.students.a2,
        classSectionId: fx.sections.a,
        subjectId: fx.subjects.maths.id,
        curriculumUnitId: fx.subjects.maths.units[1],
        score: 0.599,
        confidence: 0.5,
      },
      {
        studentId: fx.students.b1,
        classSectionId: fx.sections.b,
        subjectId: fx.subjects.science.id,
        curriculumUnitId: fx.subjects.science.units[0],
        score: 0.1,
        confidence: 0.49,
      },
    ]);

    const heatmap = await admin.rpc("mastery_heatmap", {
      p_academic_year_id: fx.academicYearId,
      p_class_section_id: null as unknown as string,
      p_subject_id: null as unknown as string,
      p_gap_threshold: 0.6,
      p_min_confidence: 0.5,
    });
    expect(heatmap.error).toBeNull();
    const below = (heatmap.data as { below: number }[]).reduce((sum, r) => sum + r.below, 0);
    expect(below).toBe(1);
  });
});
