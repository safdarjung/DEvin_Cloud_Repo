import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidV5 } from "../../scripts/seed/lib/ids.ts";

// T-029 (05 §8 / §8.1). Reads the already-seeded demo tenant — run
// `pnpm demo:reset` before this file.

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

let institutionId: string;

beforeAll(async () => {
  const [row] = await sql`select id from public.institutions where slug = 'st-josephs-demo'`;
  if (!row) throw new Error("Demo institution not found — run `pnpm demo:reset` first.");
  institutionId = row.id as string;
});

afterAll(async () => {
  await sql.end();
});

describe("T-029 seed counts (AC1)", () => {
  it("produces 40 enquiries with the documented stage distribution", async () => {
    const rows = await sql`
      select status, count(*)::int as n from public.enquiries where institution_id = ${institutionId} group by status
    `;
    const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.n]));
    expect(byStatus).toEqual({
      new: 12,
      contacted: 10,
      visit_scheduled: 6,
      application_sent: 5,
      converted: 4,
      closed: 3,
    });
  });

  it("produces 8 applications with the documented state distribution", async () => {
    const rows = await sql`
      select status, count(*)::int as n from public.applications where institution_id = ${institutionId} group by status
    `;
    const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.n]));
    expect(byStatus).toEqual({
      submitted: 2,
      under_review: 2,
      interaction_scheduled: 1,
      offered: 1,
      accepted: 2,
    });
  });

  it("exactly 2 accepted applications, neither enrolled (no source_application_id student)", async () => {
    const rows = await sql`
      select a.id from public.applications a
      where a.institution_id = ${institutionId} and a.status = 'accepted'
    `;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const [student] = await sql`select id from public.students where source_application_id = ${row.id}`;
      expect(student).toBeUndefined();
    }
  });
});

describe("T-029 named demo entities (05 §8.1)", () => {
  it("APP-live-1 is Riya Verma, grade I, accepted, guardian Sunita Verma 9800000101 (new)", async () => {
    const [row] = await sql`
      select a.applicant, a.guardian, g.code as grade_code
      from public.applications a
      join public.grades g on g.id = a.grade_applied_id
      where a.institution_id = ${institutionId} and a.applicant ->> 'firstName' = 'Riya'
    `;
    expect(row).toBeTruthy();
    expect(row.grade_code).toBe("I");
    expect(row.guardian.phone).toBe("9800000101");
    const [existingGuardian] = await sql`select id from public.guardians where institution_id = ${institutionId} and phone = '9800000101'`;
    expect(existingGuardian).toBeUndefined();
  });

  it("APP-live-2 is Kabir Mehta, grade VI, accepted, guardian phone reuses guardian.two (9800000002)", async () => {
    const [row] = await sql`
      select a.guardian, g.code as grade_code
      from public.applications a
      join public.grades g on g.id = a.grade_applied_id
      where a.institution_id = ${institutionId} and a.applicant ->> 'firstName' = 'Kabir'
    `;
    expect(row).toBeTruthy();
    expect(row.grade_code).toBe("VI");
    expect(row.guardian.phone).toBe("9800000002");

    const [existingGuardian] = await sql`select id from public.guardians where institution_id = ${institutionId} and phone = '9800000002'`;
    expect(existingGuardian).toBeTruthy();
  });

  it("both accepted applications have an offer + accept decision row", async () => {
    const rows = await sql`
      select a.applicant ->> 'firstName' as first_name, count(*)::int as n
      from public.applications a
      join public.application_decisions d on d.application_id = a.id
      where a.institution_id = ${institutionId} and a.status = 'accepted'
      group by a.applicant ->> 'firstName'
    `;
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.n).toBe(2);
  });
});

describe("T-029 integrity (idempotency + determinism)", () => {
  it("enquiry phones are all in the reserved 98000002xx block, distinct", async () => {
    const rows = await sql`select phone from public.enquiries where institution_id = ${institutionId}`;
    expect(rows).toHaveLength(40);
    const phones = new Set(rows.map((r) => r.phone as string));
    expect(phones.size).toBe(40);
    for (const phone of phones) expect(phone).toMatch(/^98000002\d{2}$/);
  });

  it("enquiry ids match the deterministic uuidV5 formula", async () => {
    const [row] = await sql`
      select id from public.enquiries where institution_id = ${institutionId} and phone = '9800000200'
    `;
    expect(row.id).toBe(uuidV5("admissions", "enquiry:0"));
  });
});
