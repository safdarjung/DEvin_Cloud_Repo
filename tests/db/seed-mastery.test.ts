// M20-T13 — seed: exam_papers.unit_ids mapping + compute_mastery over the
// demo tenant (M20-tasks.md Task 13 TEST FIRST). Reads the already-seeded
// demo tenant — run `pnpm demo:reset` before this file (see CLAUDE.md "Run
// only your packet's targeted tests").
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

process.env.SERVICE_ROLE_CALLER = "test";
const { createAdminClient } = await import("@/lib/supabase/admin");
const admin = createAdminClient();

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

const institutionRows = await sql`select id from public.institutions where slug = 'st-josephs-demo'`;
if (!institutionRows[0]) throw new Error("Demo institution not found — run `pnpm demo:reset` first.");
const institutionId = institutionRows[0].id as string;

const yearRows = await sql`
  select id from public.academic_years where institution_id = ${institutionId} and is_current
`;
const academicYearId = yearRows[0].id as string;

const [hy] = await sql`
  select id from public.exams where institution_id = ${institutionId} and name = 'Half-Yearly Examination 2026'
`;
const [pt] = await sql`
  select id from public.exams where institution_id = ${institutionId} and name = 'Periodic Test 2 (Grade X)'
`;
const hyExamId = hy.id as string;
const ptExamId = pt.id as string;

afterAll(async () => {
  await sql.end();
});

describe("M20-T13 exam_papers.unit_ids mapping", () => {
  it("every HY-2026 paper maps exactly units 1-2 of its own grade + subject", async () => {
    const rows = await sql`
      select ep.unit_ids, cu1.id as unit1, cu2.id as unit2
      from public.exam_papers ep
      join public.class_sections cs on cs.id = ep.class_section_id
      join public.curriculum_units cu1
        on cu1.grade_id = cs.grade_id and cu1.subject_id = ep.subject_id and cu1.sequence = 1
      join public.curriculum_units cu2
        on cu2.grade_id = cs.grade_id and cu2.subject_id = ep.subject_id and cu2.sequence = 2
      where ep.exam_id = ${hyExamId}
    `;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.unit_ids).toEqual([row.unit1, row.unit2]);
    }
  });

  it("every PT2-X paper maps exactly unit 3 of its own grade + subject", async () => {
    const rows = await sql`
      select ep.unit_ids, cu3.id as unit3
      from public.exam_papers ep
      join public.class_sections cs on cs.id = ep.class_section_id
      join public.curriculum_units cu3
        on cu3.grade_id = cs.grade_id and cu3.subject_id = ep.subject_id and cu3.sequence = 3
      where ep.exam_id = ${ptExamId}
    `;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.unit_ids).toEqual([row.unit3]);
    }
  });
});

describe("M20-T13 compute_mastery over the demo tenant", () => {
  it("snapshot count = 2 x current non-absent HY-2026 marks of actively enrolled students; no unit-3 (PT2-X) snapshot", async () => {
    const [{ n: markCount }] = await sql`
      select count(*)::int as n
      from public.marks m
      join public.exam_papers ep on ep.id = m.exam_paper_id and ep.exam_id = ${hyExamId}
      join public.enrolments e
        on e.student_id = m.student_id
        and e.institution_id = m.institution_id
        and e.academic_year_id = ${academicYearId}
        and e.status = 'active'
      where not m.is_absent and m.superseded_by is null
    `;

    const [{ n: snapshotCount }] = await sql`
      select count(*)::int as n from public.mastery_snapshots where institution_id = ${institutionId}
    `;
    expect(snapshotCount).toBe(2 * markCount);

    const [{ n: ptUnitSnapshots }] = await sql`
      select count(*)::int as n
      from public.mastery_snapshots ms
      join public.exam_papers ep on ep.exam_id = ${ptExamId}
      where ms.curriculum_unit_id = any(ep.unit_ids)
    `;
    expect(ptUnitSnapshots).toBe(0);
  });

  it("Aarav Sharma's Mathematics unit-1 score = HY marks / max (3 dp), confidence 0.5", async () => {
    const [row] = await sql`
      select round(m.marks_obtained / ep.max_marks, 3) as expected_score, cu.id as unit_id
      from public.students s
      join public.marks m on m.student_id = s.id
      join public.exam_papers ep on ep.id = m.exam_paper_id and ep.exam_id = ${hyExamId}
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

  it("calling compute_mastery again produces identical scores (determinism)", async () => {
    const before = await sql`
      select student_id, curriculum_unit_id, score, confidence
      from public.mastery_snapshots where institution_id = ${institutionId}
      order by student_id, curriculum_unit_id
    `;

    const { error } = await admin.rpc("compute_mastery", { p_institution_id: institutionId });
    expect(error).toBeNull();

    const after = await sql`
      select student_id, curriculum_unit_id, score, confidence
      from public.mastery_snapshots where institution_id = ${institutionId}
      order by student_id, curriculum_unit_id
    `;

    expect(after.length).toBe(before.length);
    for (let i = 0; i < before.length; i++) {
      expect(after[i].score).toBe(before[i].score);
      expect(after[i].confidence).toBe(before[i].confidence);
    }
  });
});
