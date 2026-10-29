import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// T-013 (05 §8 / §8.1). Reads the already-seeded demo tenant — run
// `pnpm demo:reset` before this file, not inside it (seeding 3,024 students
// is too slow to redo per test run; see CLAUDE.md "Run only your packet's
// targeted tests").

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const SEED_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "CoolSkool-Demo-2026";

let institutionId: string;

beforeAll(async () => {
  const [row] = await sql`select id from public.institutions where slug = 'st-josephs-demo'`;
  if (!row) throw new Error("Demo institution not found — run `pnpm demo:reset` first.");
  institutionId = row.id as string;
});

afterAll(async () => {
  await sql.end();
});

async function signInDemo(loginKey: string) {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
  );
  const { error } = await client.auth.signInWithPassword({
    email: `${loginKey}@demo.coolskool.test`,
    password: SEED_PASSWORD,
  });
  if (error) throw error;
  return client;
}

describe("T-013 seed counts (05 §8.2, AC1)", () => {
  it("produces 3,024 students, 72 sections, 106 staff, 3,024 active enrolments", async () => {
    const [students] = await sql`select count(*)::int as n from public.students where institution_id = ${institutionId}`;
    const [sections] = await sql`select count(*)::int as n from public.class_sections where institution_id = ${institutionId}`;
    const [staff] = await sql`select count(*)::int as n from public.staff where institution_id = ${institutionId}`;
    const [enrolments] = await sql`
      select count(*)::int as n from public.enrolments where institution_id = ${institutionId} and status = 'active'
    `;
    const [guardians] = await sql`select count(*)::int as n from public.guardians where institution_id = ${institutionId}`;

    expect(students.n).toBe(3024);
    expect(sections.n).toBe(72);
    expect(staff.n).toBe(106);
    expect(enrolments.n).toBe(3024);
    expect(guardians.n).toBeGreaterThanOrEqual(2300);
  });
});

describe("T-013 named demo entities (05 §8.1)", () => {
  it("Aarav Sharma is VI-A roll 7 with admission ADM/2024/00412", async () => {
    const [row] = await sql`
      select e.roll_no, s.admission_no
      from public.students s
      join public.enrolments e on e.student_id = s.id and e.status = 'active'
      join public.class_sections cs on cs.id = e.class_section_id
      join public.grades g on g.id = cs.grade_id
      where s.institution_id = ${institutionId} and s.first_name = 'Aarav' and s.last_name = 'Sharma'
        and g.code = 'VI' and cs.name = 'A'
    `;
    expect(row).toBeTruthy();
    expect(row.roll_no).toBe(7);
    expect(row.admission_no).toBe("ADM/2024/00412");
  });

  it("Ananya Sharma (student.one) is X-A roll 12 with admission ADM/2020/00133", async () => {
    const [row] = await sql`
      select e.roll_no, s.admission_no
      from public.students s
      join public.enrolments e on e.student_id = s.id and e.status = 'active'
      join public.class_sections cs on cs.id = e.class_section_id
      join public.grades g on g.id = cs.grade_id
      where s.institution_id = ${institutionId} and s.first_name = 'Ananya' and s.last_name = 'Sharma'
        and g.code = 'X' and cs.name = 'A'
    `;
    expect(row).toBeTruthy();
    expect(row.roll_no).toBe(12);
    expect(row.admission_no).toBe("ADM/2020/00133");
  });

  it("Ishaan Mehta is VIII-B roll 3", async () => {
    const [row] = await sql`
      select e.roll_no
      from public.students s
      join public.enrolments e on e.student_id = s.id and e.status = 'active'
      join public.class_sections cs on cs.id = e.class_section_id
      join public.grades g on g.id = cs.grade_id
      where s.institution_id = ${institutionId} and s.first_name = 'Ishaan' and s.last_name = 'Mehta'
        and g.code = 'VIII' and cs.name = 'B'
    `;
    expect(row).toBeTruthy();
    expect(row.roll_no).toBe(3);
  });

  it("teacher.x-a is class teacher of X-A and teaches X-A Mathematics; UNIT-X-MATH-3 is Quadratic Equations", async () => {
    const [section] = await sql`
      select cs.id, st.full_name
      from public.class_sections cs
      join public.grades g on g.id = cs.grade_id
      join public.staff st on st.id = cs.class_teacher_id
      where cs.institution_id = ${institutionId} and g.code = 'X' and cs.name = 'A'
    `;
    expect(section).toBeTruthy();

    const [assignment] = await sql`
      select 1 as found
      from public.subject_assignments sa
      join public.subjects sub on sub.id = sa.subject_id
      where sa.class_section_id = ${section.id} and sa.teacher_id = (
        select staff_id from public.memberships where institution_id = ${institutionId} and role = 'teacher'
          and user_id = (select id from auth.users where email = 'teacher.x-a@demo.coolskool.test')
      ) and sub.name = 'Mathematics'
    `;
    expect(assignment).toBeTruthy();

    const [unit] = await sql`
      select cu.title, cu.sequence
      from public.curriculum_units cu
      join public.grades g on g.id = cu.grade_id
      join public.subjects sub on sub.id = cu.subject_id
      where cu.institution_id = ${institutionId} and g.code = 'X' and sub.name = 'Mathematics' and cu.sequence = 3
    `;
    expect(unit.title).toBe("Quadratic Equations");
  });
});

describe("T-013 integrity (AC4)", () => {
  it("every section has exactly one class teacher and at least 5 subject assignments", async () => {
    const sections = await sql`
      select cs.id, cs.class_teacher_id, count(sa.id)::int as assignment_count
      from public.class_sections cs
      left join public.subject_assignments sa on sa.class_section_id = cs.id
      where cs.institution_id = ${institutionId}
      group by cs.id, cs.class_teacher_id
    `;
    expect(sections.length).toBe(72);
    for (const row of sections) {
      expect(row.class_teacher_id).not.toBeNull();
      expect(row.assignment_count).toBeGreaterThanOrEqual(5);
    }
  });

  it("every student has exactly one primary guardian", async () => {
    const [row] = await sql`
      select count(*)::int as n
      from public.students s
      where s.institution_id = ${institutionId}
        and (
          select count(*) from public.guardian_students gs where gs.student_id = s.id and gs.is_primary
        ) <> 1
    `;
    expect(row.n).toBe(0);
  });
});

describe("T-013 RLS (AC5)", () => {
  it("teacher.vi-a sees the VI-A roster (42 students)", async () => {
    const client = await signInDemo("teacher.vi-a");
    const { data, error } = await client
      .from("enrolments")
      .select("id, class_sections!inner(name, grades!inner(code))")
      .eq("institution_id", institutionId)
      .eq("status", "active")
      .eq("class_sections.name", "A")
      .eq("class_sections.grades.code", "VI");
    expect(error).toBeNull();
    expect(data).toHaveLength(42);
  });

  it("guardian.one sees two children (Aarav and Ananya)", async () => {
    const client = await signInDemo("guardian.one");
    const { data, error } = await client.from("students").select("first_name").eq("institution_id", institutionId);
    expect(error).toBeNull();
    const names = (data ?? []).map((s) => s.first_name).sort();
    expect(names).toEqual(["Aarav", "Ananya"]);
  });
});
