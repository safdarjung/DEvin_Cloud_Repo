import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// `app.next_sequence` / `app.grade_for` / `app.demo_reset` (migration 0001) read
// `public.institutions` / `public.institution_sequences`, created in migration
// 0002 (T-004). Tests below insert/delete their own rows in those real tables
// rather than creating shadow tables.

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
});

describe("app.block_mutation", () => {
  beforeAll(async () => {
    await sql`
      create table public.foundation_test_immutable (
        id uuid primary key default gen_random_uuid(),
        value text
      )
    `;
    await sql`
      create trigger block_mutation
      before update or delete on public.foundation_test_immutable
      for each row execute function app.block_mutation()
    `;
  });

  afterAll(async () => {
    await sql`drop table public.foundation_test_immutable`;
  });

  it("raises on UPDATE and DELETE", async () => {
    const [row] = await sql`
      insert into public.foundation_test_immutable (value) values ('a') returning id
    `;

    await expect(
      sql`update public.foundation_test_immutable set value = 'b' where id = ${row.id}`,
    ).rejects.toThrow(/invalid_state/);

    await expect(
      sql`delete from public.foundation_test_immutable where id = ${row.id}`,
    ).rejects.toThrow(/invalid_state/);
  });

  it("allows UPDATE and DELETE under app.allow_reset = 'on'", async () => {
    const [row] = await sql`
      insert into public.foundation_test_immutable (value) values ('a') returning id
    `;

    await sql.begin(async (tx) => {
      await tx`select set_config('app.allow_reset', 'on', true)`;
      await tx`update public.foundation_test_immutable set value = 'b' where id = ${row.id}`;
      await tx`delete from public.foundation_test_immutable where id = ${row.id}`;
    });
  });
});

describe("app.next_sequence and app.grade_for", () => {
  const institutionId = "00000000-0000-0000-0000-0000000000f1";

  beforeAll(async () => {
    await sql`
      insert into public.institutions (id, slug, name, settings) values (
        ${institutionId},
        'foundation-test-seq',
        'Foundation Test Seq',
        ${sql.json({
          finance: { financial_year_start_month: 4 },
          exams: {
            grading_scales: {
              default: [
                { min: 91, max: 100, grade: "A1", points: 10 },
                { min: 81, max: 90, grade: "A2", points: 9 },
                { min: 71, max: 80, grade: "B1", points: 8 },
                { min: 61, max: 70, grade: "B2", points: 7 },
                { min: 51, max: 60, grade: "C1", points: 6 },
                { min: 41, max: 50, grade: "C2", points: 5 },
                { min: 33, max: 40, grade: "D", points: 4 },
                { min: 21, max: 32, grade: "E1", points: 0, fail: true },
                { min: 0, max: 20, grade: "E2", points: 0, fail: true },
              ],
            },
          },
          numbering: { invoice_no: "INV/{FY}/{SEQ:6}" },
        })}
      )
    `;
  });

  afterAll(async () => {
    await sql`delete from public.institution_sequences where institution_id = ${institutionId}`;
    await sql`delete from public.institutions where id = ${institutionId}`;
  });

  it("renders INV/2026-27/000001 on 2026-10-28", async () => {
    const [{ next_sequence: value }] = await sql`
      select app.next_sequence(${institutionId}::uuid, 'invoice_no') as next_sequence
    `;
    expect(value).toBe("INV/2026-27/000001");
  });

  it("increments without gaps under 50 concurrent calls", async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        sql`select app.next_sequence(${institutionId}::uuid, 'invoice_no:concurrency') as v`,
      ),
    );
    const sequenceNumbers = results
      .map((rows) => rows[0].v as string)
      .map((v) => Number(v.split("/")[2]))
      .sort((a, b) => a - b);

    expect(sequenceNumbers).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it("returns A1 for 91, D for 33, E1 for 32.99 on the default scale", async () => {
    const [a1] = await sql`select app.grade_for(${institutionId}::uuid, 'default', 91) as grade`;
    const [d] = await sql`select app.grade_for(${institutionId}::uuid, 'default', 33) as grade`;
    const [e1] = await sql`select app.grade_for(${institutionId}::uuid, 'default', 32.99) as grade`;

    expect(a1.grade).toBe("A1");
    expect(d.grade).toBe("D");
    expect(e1.grade).toBe("E1");
  });
});

describe("app.demo_reset", () => {
  const demoInstitutionId = "00000000-0000-0000-0000-0000000000f2";
  const otherInstitutionId = "00000000-0000-0000-0000-0000000000f3";

  beforeAll(async () => {
    await sql`
      create table public.foundation_test_tenant_rows (
        id uuid primary key default gen_random_uuid(),
        institution_id uuid not null,
        value text
      )
    `;
    await sql`
      insert into public.institutions (id, slug, name, is_demo) values
        (${demoInstitutionId}, 'foundation-test-demo', 'Foundation Test Demo', true),
        (${otherInstitutionId}, 'foundation-test-other', 'Foundation Test Other', false)
    `;
  });

  afterAll(async () => {
    await sql`drop table public.foundation_test_tenant_rows`;
    await sql`delete from public.institutions where id in (${demoInstitutionId}, ${otherInstitutionId})`;
  });

  it("raises code:forbidden for a non-demo institution", async () => {
    await expect(sql`select app.demo_reset(${otherInstitutionId}::uuid)`).rejects.toThrow(
      /forbidden/,
    );
  });

  it("deletes only the demo institution's rows, leaving others intact", async () => {
    await sql`
      insert into public.foundation_test_tenant_rows (institution_id, value) values
        (${demoInstitutionId}, 'demo-row'),
        (${otherInstitutionId}, 'other-row')
    `;

    await sql`select * from app.demo_reset(${demoInstitutionId}::uuid)`;

    const remaining = await sql`select institution_id from public.foundation_test_tenant_rows`;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].institution_id).toBe(otherInstitutionId);
  });

  it("handles a self-referencing FK without error", async () => {
    await sql`
      create table public.foundation_test_self_ref (
        id uuid primary key default gen_random_uuid(),
        institution_id uuid not null,
        superseded_by uuid references public.foundation_test_self_ref(id)
      )
    `;

    try {
      const [first] = await sql`
        insert into public.foundation_test_self_ref (institution_id) values (${demoInstitutionId}) returning id
      `;
      await sql`
        insert into public.foundation_test_self_ref (institution_id, superseded_by) values (${demoInstitutionId}, ${first.id})
      `;

      await sql`select * from app.demo_reset(${demoInstitutionId}::uuid)`;

      const remaining = await sql`select 1 from public.foundation_test_self_ref`;
      expect(remaining).toHaveLength(0);
    } finally {
      await sql`drop table public.foundation_test_self_ref`;
    }
  });
});
