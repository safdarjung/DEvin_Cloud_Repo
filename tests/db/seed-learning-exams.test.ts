import { execFileSync } from "node:child_process";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Section learning-exams. Reads the already-seeded demo tenant (run a full seed first);
// the rerun test only re-executes this one section, which must add nothing.

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 2 });
const repoRoot = path.resolve(import.meta.dirname, "../..");
let inst: string;

beforeAll(async () => {
  const [row] = await sql`select id from public.institutions where slug = 'st-josephs-demo'`;
  if (!row) throw new Error("Demo institution not found; seed the demo tenant first.");
  inst = row.id as string;
});
afterAll(async () => {
  await sql.end();
});

const one = async (query: string): Promise<number> => (await sql.unsafe(query.replaceAll("$INST", inst)))[0]!.n as number;

async function fingerprint(): Promise<string> {
  const tables = ["curriculum_topics", "question_bank", "question_collection_items", "question_papers", "question_paper_items", "question_paper_versions", "online_tests", "test_attempts", "test_responses", "practice_sessions"];
  const counts = await Promise.all(tables.map((t) => sql.unsafe(`select count(*)::int as n from public.${t}`).then((r) => r[0]!.n)));
  return counts.join(",");
}

describe("seed section learning-exams", () => {
  it("has topics for every unit of X Mathematics and VI Science, and tagged questions", async () => {
    expect(await one(`select count(*)::int n from public.curriculum_topics where institution_id = '$INST'`)).toBe(24);
    expect(await one(`select count(*)::int n from public.question_bank where institution_id = '$INST' and curriculum_topic_id is not null`)).toBeGreaterThanOrEqual(30);
  });

  it("covers every new question type, 3 AI drafts in review, a case with 2 sub-questions and the collection", async () => {
    const types = await sql`select distinct type from public.question_bank where institution_id = ${inst} and status = 'approved'`;
    for (const t of ["multi_select", "fill_blank", "numerical", "match", "assertion_reason", "case_based"]) expect(types.map((r) => r.type)).toContain(t);
    expect(await one(`select count(*)::int n from public.question_bank where institution_id = '$INST' and origin = 'ai' and status = 'in_review'`)).toBe(3);
    expect(await one(`select count(*)::int n from public.question_bank sub join public.question_bank st on st.id = sub.stem_question_id where sub.institution_id = '$INST' and st.type = 'case_based'`)).toBe(2);
    expect(await one(`select count(*)::int n from public.question_collection_items i join public.question_collections c on c.id = i.collection_id where c.name = 'Board revision set' and c.institution_id = '$INST'`)).toBeGreaterThanOrEqual(10);
  });

  it("has the published Unit Test 2 paper (3 sections, versions), a VI Science draft and a template", async () => {
    expect(await one(`select count(*)::int n from public.question_papers where institution_id = '$INST' and title = 'X Mathematics — Unit Test 2' and status = 'published' and current_version = 2`)).toBe(1);
    expect(await one(`select count(*)::int n from public.question_paper_sections s join public.question_papers p on p.id = s.paper_id where p.title = 'X Mathematics — Unit Test 2' and p.institution_id = '$INST'`)).toBe(3);
    expect(await one(`select count(*)::int n from public.question_paper_versions v join public.question_papers p on p.id = v.paper_id where p.title = 'X Mathematics — Unit Test 2' and p.institution_id = '$INST'`)).toBe(2);
    expect(await one(`select count(*)::int n from public.question_papers where institution_id = '$INST' and status = 'draft' and title like 'VI Science%'`)).toBe(1);
    expect(await one(`select count(*)::int n from public.question_paper_templates where institution_id = '$INST'`)).toBeGreaterThanOrEqual(1);
  });

  it("has a published online test with 10 evaluated attempts; student.one has a result", async () => {
    expect(await one(`select count(*)::int n from public.online_tests where institution_id = '$INST' and status = 'published' and not practice and title like '%Unit Test 2 (online)'`)).toBe(1);
    expect(await one(`select count(*)::int n from public.test_attempts a join public.online_tests t on t.id = a.test_id where t.institution_id = '$INST' and t.status = 'published' and a.status = 'evaluated' and a.total_score is not null`)).toBe(10);
    expect(await one(`select count(*)::int n from public.test_attempts a join public.students s on s.id = a.student_id join public.memberships m on m.student_id = s.id join auth.users u on u.id = m.user_id where u.email = 'student.one@demo.coolskool.test' and a.status = 'evaluated' and m.institution_id = '$INST'`)).toBe(1);
  });

  it("has a live practice test for X-A and bank practice sessions for student.one", async () => {
    expect(await one(`select count(*)::int n from public.online_tests where institution_id = '$INST' and practice and status = 'scheduled' and opens_at <= now() and closes_at > now() + interval '20 days'`)).toBe(1);
    expect(await one(`select count(*)::int n from public.practice_sessions s join public.memberships m on m.student_id = s.student_id join auth.users u on u.id = m.user_id where u.email = 'student.one@demo.coolskool.test' and s.source = 'bank' and s.submitted_at is not null and m.institution_id = '$INST'`)).toBeGreaterThanOrEqual(4);
  });

  it("adds nothing when the section reruns", async () => {
    const before = await fingerprint();
    execFileSync("node", ["--env-file-if-exists=.env.local", "scripts/seed/index.ts", "--only", "learning-exams"], { cwd: repoRoot, stdio: "pipe" });
    expect(await fingerprint()).toBe(before);
  });
});
