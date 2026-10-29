import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
});

describe("app.demo_reset (T-012 AC3 / C-04)", () => {
  it("raises code:forbidden for a non-demo institution", async () => {
    const [inst] = await sql`
      insert into public.institutions (slug, name, is_demo)
      values (${"demo-reset-c04-" + crypto.randomUUID()}, 'Not Demo', false)
      returning id
    `;

    try {
      await expect(sql`select app.demo_reset(${inst.id}::uuid)`).rejects.toThrow(/forbidden/);
    } finally {
      await sql`delete from public.institutions where id = ${inst.id}`;
    }
  });

  it("leaves another institution's rows untouched", async () => {
    const [demo] = await sql`
      insert into public.institutions (slug, name, is_demo)
      values (${"demo-reset-c04-demo-" + crypto.randomUUID()}, 'Demo', true)
      returning id
    `;
    const [other] = await sql`
      insert into public.institutions (slug, name, is_demo)
      values (${"demo-reset-c04-other-" + crypto.randomUUID()}, 'Other', false)
      returning id
    `;

    try {
      await sql`
        insert into public.academic_years (institution_id, name, starts_on, ends_on) values
          (${demo.id}, 'Y', '2026-04-01', '2027-03-31'),
          (${other.id}, 'Y', '2026-04-01', '2027-03-31')
      `;

      await sql`select app.demo_reset(${demo.id}::uuid)`;

      const demoRows = await sql`select 1 from public.academic_years where institution_id = ${demo.id}`;
      const otherRows = await sql`select 1 from public.academic_years where institution_id = ${other.id}`;
      expect(demoRows).toHaveLength(0);
      expect(otherRows).toHaveLength(1);
    } finally {
      await sql`delete from public.academic_years where institution_id in (${demo.id}, ${other.id})`;
      await sql`delete from public.institutions where id in (${demo.id}, ${other.id})`;
    }
  });
});
