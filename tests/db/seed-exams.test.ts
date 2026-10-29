import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// T-021 (05 §8 / §8.1). Reads the already-seeded demo tenant — run
// `pnpm demo:reset` before this file (see CLAUDE.md "Run only your
// packet's targeted tests").

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

let institutionId: string;
let hyExamId: string;
let ptExamId: string;

beforeAll(async () => {
  const [row] = await sql`select id from public.institutions where slug = 'st-josephs-demo'`;
  if (!row) throw new Error("Demo institution not found — run `pnpm demo:reset` first.");
  institutionId = row.id as string;

  const [hy] = await sql`
    select id, status from public.exams
    where institution_id = ${institutionId} and name = 'Half-Yearly Examination 2026'
  `;
  const [pt] = await sql`
    select id, status from public.exams
    where institution_id = ${institutionId} and name = 'Periodic Test 2 (Grade X)'
  `;
  hyExamId = hy?.id as string;
  ptExamId = pt?.id as string;
});

afterAll(async () => {
  await sql.end();
});

describe("T-021 HY-2026 (AC1, AC2)", () => {
  it("exists, is published, and has one exam_paper per subject_assignment", async () => {
    const [exam] = await sql`select status, type from public.exams where id = ${hyExamId}`;
    expect(exam.status).toBe("published");
    expect(exam.type).toBe("half_yearly");

    const [papers] = await sql`select count(*)::int as n from public.exam_papers where exam_id = ${hyExamId}`;
    const [assignments] = await sql`
      select count(*)::int as n from public.subject_assignments where institution_id = ${institutionId}
    `;
    expect(papers.n).toBe(assignments.n);
  });

  it("produces exactly 3,024 current results, totals matching Σ current marks", async () => {
    const [results] = await sql`
      select count(*)::int as n from public.results where exam_id = ${hyExamId} and superseded_by is null
    `;
    expect(results.n).toBe(3024);

    const [row] = await sql`
      select
        (select coalesce(sum(total), 0) from public.results where exam_id = ${hyExamId} and superseded_by is null) as results_total,
        (
          select coalesce(sum(m.marks_obtained), 0)
          from public.marks m
          join public.exam_papers p on p.id = m.exam_paper_id
          where p.exam_id = ${hyExamId} and m.superseded_by is null
        ) as marks_total
    `;
    expect(Number(row.results_total)).toBe(Number(row.marks_total));
  });

  it("every grade A1..E2 is represented in the HY-2026 result distribution (AC3)", async () => {
    const rows = await sql`
      select distinct grade from public.results where exam_id = ${hyExamId} and superseded_by is null
    `;
    const grades = new Set(rows.map((r) => r.grade as string));
    for (const g of ["A1", "A2", "B1", "B2", "C1", "C2", "D", "E1", "E2"]) {
      expect(grades.has(g)).toBe(true);
    }
  });

  it("absent students have is_absent and zero snapshot marks", async () => {
    const [row] = await sql`
      select count(*)::int as n
      from public.marks
      where exam_paper_id in (select id from public.exam_papers where exam_id = ${hyExamId})
        and superseded_by is null and is_absent = true and marks_obtained is not null
    `;
    expect(row.n).toBe(0);
  });
});

describe("T-021 recheck requests (AC4)", () => {
  it("Ishaan Mehta's Science recheck is applied (61 -> 64), v1 intact", async () => {
    const [row] = await sql`
      select rr.status, rd.new_marks, m1.marks_obtained as v2_marks, m2.marks_obtained as v1_marks
      from public.recheck_requests rr
      join public.recheck_decisions rd on rd.request_id = rr.id and rd.decision = 'approve'
      join public.marks m1 on m1.id = rd.applied_marks_id
      join public.marks m2 on m2.superseded_by = rd.applied_marks_id
      join public.exam_papers p on p.id = rr.exam_paper_id
      join public.subjects s on s.id = p.subject_id and s.code = 'SCI'
      join public.class_sections cs on cs.id = p.class_section_id and cs.name = 'B'
      where rr.institution_id = ${institutionId}
      limit 1
    `;
    expect(row).toBeTruthy();
    expect(row.status).toBe("applied");
    expect(Number(row.new_marks)).toBe(64);
    expect(Number(row.v1_marks)).toBe(61);
  });

  it("one recheck request is under_review (the X-D English case)", async () => {
    const [row] = await sql`
      select count(*)::int as n from public.recheck_requests where institution_id = ${institutionId} and status = 'under_review'
    `;
    expect(row.n).toBe(1);
  });

  it("exactly two recheck_requests exist for the demo tenant", async () => {
    const [row] = await sql`select count(*)::int as n from public.recheck_requests where institution_id = ${institutionId}`;
    expect(row.n).toBe(2);
  });
});

describe("T-021 no pending notification jobs from the seed (packet instruction)", () => {
  it("zero queued notify.results_published / notify.recheck_decided jobs", async () => {
    const [row] = await sql`
      select count(*)::int as n from public.jobs
      where institution_id = ${institutionId}
        and type in ('notify.results_published', 'notify.recheck_decided')
        and status = 'queued'
    `;
    expect(row.n).toBe(0);
  });
});

describe("T-021 PT2-X (held back for the live demo)", () => {
  it("is grade X only, status marks_entry, with X-A Mathematics unmarked", async () => {
    const [exam] = await sql`select status, type from public.exams where id = ${ptExamId}`;
    expect(exam.status).toBe("marks_entry");
    expect(exam.type).toBe("unit_test");

    const [row] = await sql`
      select count(*)::int as n
      from public.marks m
      join public.exam_papers p on p.id = m.exam_paper_id
      join public.subjects s on s.id = p.subject_id and s.code = 'MATH'
      join public.class_sections cs on cs.id = p.class_section_id and cs.name = 'A'
      join public.grades g on g.id = cs.grade_id and g.code = 'X'
      where p.exam_id = ${ptExamId}
    `;
    expect(row.n).toBe(0);
  });

  it("every other grade-X paper has marks for all 42 students", async () => {
    const rows = await sql`
      select p.id, count(m.id)::int as n
      from public.exam_papers p
      join public.subjects s on s.id = p.subject_id
      join public.class_sections cs on cs.id = p.class_section_id
      join public.grades g on g.id = cs.grade_id and g.code = 'X'
      left join public.marks m on m.exam_paper_id = p.id
      where p.exam_id = ${ptExamId} and not (s.code = 'MATH' and cs.name = 'A')
      group by p.id
    `;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.n).toBe(42);
  });
});

describe("T-021 determinism", () => {
  it("HY-2026 exam id matches the deterministic uuidV5 formula", async () => {
    const { uuidV5 } = await import("../../scripts/seed/lib/ids.ts");
    expect(hyExamId).toBe(uuidV5("exams", "exam:HY-2026"));
  });
});
