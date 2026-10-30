import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createAttendanceRecord,
  createAttendanceSession,
  createClassSection,
  createEnrolment,
  createGrade,
  createSubject,
  createTerm,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, ROLES, type TestInstitution } from "../helpers/roles";

// 07 §6 C-10..C-14 (BOLA), C-44, C-54 (T-042). Another institution's
// student/guardian/invoice/result/attendance ids — and, inside the same
// institution, another guardian's child's — return 0 rows for every role
// (RLS scopes, never errors); a recheck on another child's result is refused.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

interface ChildRows {
  student: string;
  guardian: string;
  invoice: string;
  receipt: string;
  result: string;
  attendance: string;
  paper: string;
}

interface Scaffold {
  year: string;
  term: string;
  section: string;
  exam: string;
  paper: string;
  session: string;
}

let a: TestInstitution;
let bInstitutionId: string;
let foreign: ChildRows;
let ownChild: ChildRows;
let otherChild: ChildRows;

async function configure(institutionId: string): Promise<void> {
  await sql`
    update public.institutions
    set settings = coalesce(settings, '{}'::jsonb)
      || ${sql.json({ attendance: { statuses: [{ code: "P" }] }, exams: { recheck_window_days: 7 } })}
    where id = ${institutionId}
  `;
}

async function scaffold(institutionId: string): Promise<Scaffold> {
  const year = await createAcademicYear(institutionId);
  const term = await createTerm(institutionId, year);
  const grade = await createGrade(institutionId);
  const subject = await createSubject(institutionId);
  const section = await createClassSection(institutionId, grade, year);
  const [exam] = await sql`
    insert into public.exams (institution_id, academic_year_id, term_id, name, type, status, published_at)
    values (${institutionId}, ${year}, ${term}, 'BOLA exam', 'unit_test', 'published', now()) returning id
  `;
  const [paper] = await sql`
    insert into public.exam_papers (institution_id, exam_id, class_section_id, subject_id, max_marks, pass_marks)
    values (${institutionId}, ${exam.id}, ${section}, ${subject}, 100, 33) returning id
  `;
  const session = await createAttendanceSession(institutionId, section);
  return { year, term, section, exam: exam.id, paper: paper.id, session };
}

async function seedChild(institutionId: string, s: Scaffold, guardianId: string | null, label: string): Promise<ChildRows> {
  const [student] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${`ADM-BOLA-${label}-${crypto.randomUUID().slice(0, 6)}`}, ${label}, '2015-01-01', 'other') returning id
  `;
  let guardian = guardianId;
  if (!guardian) {
    const [g] = await sql`insert into public.guardians (institution_id, full_name, phone) values (${institutionId}, ${`Guardian ${label}`}, '9822222222') returning id`;
    guardian = g.id as string;
  }
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, portal_access)
    values (${institutionId}, ${guardian}, ${student.id}, 'mother', true)
  `;
  await createEnrolment(institutionId, student.id, s.section, s.year);
  const [invoice] = await sql`
    insert into public.invoices (institution_id, student_id, academic_year_id, term_id, invoice_no, total)
    values (${institutionId}, ${student.id}, ${s.year}, ${s.term}, ${`INV-BOLA-${crypto.randomUUID().slice(0, 8)}`}, 1000) returning id
  `;
  const [payment] = await sql`
    insert into public.payments (institution_id, invoice_id, amount, mode, received_at, idempotency_key)
    values (${institutionId}, ${invoice.id}, 100, 'cash', now(), ${crypto.randomUUID()}) returning id
  `;
  const [receipt] = await sql`
    insert into public.receipts (institution_id, payment_id, receipt_no, financial_year, snapshot)
    values (${institutionId}, ${payment.id}, ${`RCT-BOLA-${crypto.randomUUID().slice(0, 8)}`}, '2026-27', ${sql.json({})}) returning id
  `;
  const [result] = await sql`
    insert into public.results (institution_id, exam_id, student_id, snapshot, total, max_total, percentage, grade, version_no, published_at)
    values (${institutionId}, ${s.exam}, ${student.id}, ${sql.json({ papers: [] })}, 50, 100, 50, 'C', 1, now()) returning id
  `;
  const attendance = await createAttendanceRecord(institutionId, s.session, student.id);
  return {
    student: student.id,
    guardian,
    invoice: invoice.id,
    receipt: receipt.id,
    result: result.id,
    attendance,
    paper: s.paper,
  };
}

beforeAll(async () => {
  a = await createTestInstitution("bola-a");
  bInstitutionId = crypto.randomUUID();
  await sql`insert into public.institutions (id, slug, name, is_demo) values (${bInstitutionId}, ${`test-bola-b-${bInstitutionId}`}, 'BOLA B', true)`;
  await Promise.all([configure(a.institutionId), configure(bInstitutionId)]);

  const [aScaffold, bScaffold] = await Promise.all([scaffold(a.institutionId), scaffold(bInstitutionId)]);
  const [guardianA] = await sql`select guardian_id from public.memberships where institution_id = ${a.institutionId} and role = 'guardian'`;
  ownChild = await seedChild(a.institutionId, aScaffold, guardianA.guardian_id, "own");
  otherChild = await seedChild(a.institutionId, aScaffold, null, "other");
  foreign = await seedChild(bInstitutionId, bScaffold, null, "foreign");
}, 120_000);

afterAll(async () => {
  await a.cleanup();
  await sql`select app.demo_reset(${bInstitutionId}::uuid)`;
  await sql`delete from public.institutions where id = ${bInstitutionId}`;
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
}, 60_000);

const TARGETS = [
  ["C-10", "students", "student"],
  ["C-11", "guardians", "guardian"],
  ["C-12", "invoices", "invoice"],
  ["C-13", "results", "result"],
  ["C-14", "attendance_records", "attendance"],
] as const;

describe("C-10..C-14: another institution's ids return 0 rows for every role", () => {
  for (const [id, table, key] of TARGETS) {
    it.each(ROLES)(`${id} ${table}: %s`, async (role) => {
      const { data, error } = await a.clientAs(role).from(table).select("id").eq("id", foreign[key]);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  }
});

describe("C-10..C-14: another guardian's child in the same institution returns 0 rows", () => {
  for (const [id, table, key] of TARGETS) {
    it(`${id} ${table}: guardian sees own child's row, not the other child's`, async () => {
      const client = a.clientAs("guardian");
      const own = await client.from(table).select("id").eq("id", ownChild[key]);
      const other = await client.from(table).select("id").eq("id", otherChild[key]);
      expect(own.error).toBeNull();
      // guardians.user_id is never populated (DBT-23), so a guardian can't read
      // their own guardians row; the BOLA assertion below still holds.
      expect(own.data).toHaveLength(table === "guardians" ? 0 : 1);
      expect(other.error).toBeNull();
      expect(other.data).toEqual([]);
    });

    it(`${id} ${table}: student does not see another student's row`, async () => {
      const { data, error } = await a.clientAs("student").from(table).select("id").eq("id", otherChild[key]);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  }
});

describe("C-54: guardian reads only own children's invoices and receipts", () => {
  it("invoices and receipts listed by the guardian are exactly the own child's", async () => {
    const client = a.clientAs("guardian");
    const invoices = await client.from("invoices").select("id").eq("institution_id", a.institutionId);
    const receipts = await client.from("receipts").select("id").eq("institution_id", a.institutionId);
    expect(invoices.data?.map((r) => r.id)).toEqual([ownChild.invoice]);
    expect(receipts.data?.map((r) => r.id)).toEqual([ownChild.receipt]);
  });
});

describe("C-44: guardian cannot request a recheck for a result that is not their child's", () => {
  async function requestRecheck(resultId: string, paperId: string) {
    return a.clientAs("guardian").rpc("request_recheck", {
      p_institution_id: a.institutionId,
      p_result_id: resultId,
      p_exam_paper_id: paperId,
      p_reason: "The total looks wrong, please recheck it.",
    });
  }

  it("another child's result in the same institution is refused", async () => {
    const { error } = await requestRecheck(otherChild.result, otherChild.paper);
    expect(error?.message).toMatch(/forbidden|not_found/);
  });

  it("another institution's result is refused", async () => {
    const { error } = await requestRecheck(foreign.result, foreign.paper);
    expect(error?.message).toMatch(/forbidden|not_found/);
  });

  it("the own child's result is accepted (the refusals above are about ownership)", async () => {
    const { error } = await requestRecheck(ownChild.result, ownChild.paper);
    expect(error).toBeNull();
  });
});
