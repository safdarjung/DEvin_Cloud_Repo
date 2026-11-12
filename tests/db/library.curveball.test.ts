// Curveball sweep (library): concurrency on circulation — one copy issued twice in parallel, a late return
// fired twice in parallel (fine must be charged once), validation edges on issue/return.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { issueLoan, returnLoan } from "@/modules/library/circulation.actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createFeeAssignment,
  createFeeComponent,
  createFeeStructure,
  createGrade,
  createTerm,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
let inst: TestInstitution;
let studentId: string;
let invoiceId: string;
let bookId: string;

async function newStudent(): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${inst.institutionId}, ${`LCB-${crypto.randomUUID().slice(0, 8)}`}, 'Reader', '2014-01-01', 'other') returning id`;
  return row.id as string;
}
async function copy(): Promise<string> {
  const accessionNo = `LCB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  await sql`insert into public.library_copies (institution_id, book_id, accession_no) values (${inst.institutionId}, ${bookId}, ${accessionNo})`;
  return accessionNo;
}

beforeAll(async () => {
  inst = await createTestInstitution("lib-cb");
  await sql`
    update public.institutions set settings = settings || jsonb_build_object(
      'library', jsonb_build_object('fine_per_day', 2),
      'finance', jsonb_build_object('financial_year_start_month', 4, 'default_due_day', 10, 'payment_modes', array['cash']),
      'numbering', jsonb_build_object('invoice_no', 'INV/{FY}/{SEQ:6}', 'receipt_no', 'RCT/{FY}/{SEQ:6}'))
    where id = ${inst.institutionId}`;
  const [m] = await sql`select student_id from public.memberships where institution_id = ${inst.institutionId} and role = 'student'`;
  studentId = m.student_id as string;
  const yearId = await createAcademicYear(inst.institutionId, { startsOn: "2020-01-01", endsOn: "2030-03-31" });
  const termId = await createTerm(inst.institutionId, yearId, { sequence: 1, startsOn: "2020-01-01", endsOn: "2030-03-31" });
  const structureId = await createFeeStructure(inst.institutionId, yearId, await createGrade(inst.institutionId));
  await createFeeComponent(inst.institutionId, structureId, { head: "tuition", amount: 100, frequency: "term" });
  await createFeeAssignment(inst.institutionId, studentId, structureId, yearId);
  const [inv] = await sql`select app.generate_invoice(${studentId}::uuid, ${termId}::uuid) as id`;
  invoiceId = inv.id as string;
  const [b] = await sql`insert into public.library_books (institution_id, title, author) values (${inst.institutionId}, 'Swami and Friends', 'R. K. Narayan') returning id`;
  bookId = b.id as string;
}, 60_000);

afterAll(async () => {
  await inst?.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

describe("library curveballs", () => {
  it("one copy issued to two students in parallel: exactly one open loan", async () => {
    const accessionNo = await copy();
    const other = await newStudent();
    const rs = await Promise.all([
      callAs(inst, "admin", issueLoan, { accessionNo, studentId }),
      callAs(inst, "principal", issueLoan, { accessionNo, studentId: other }),
    ]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    const loser = rs.find((r) => !r.ok);
    expect(loser && !loser.ok ? loser.error.code : null).toBe("conflict");
    const [c] = await sql`
      select count(*)::int as n from public.library_loans l join public.library_copies c on c.id = l.copy_id
      where c.accession_no = ${accessionNo} and l.returned_on is null`;
    expect(c.n).toBe(1);
  });

  it("a late return fired twice in parallel charges the fine exactly once", async () => {
    const accessionNo = await copy();
    const issued = await callAs(inst, "admin", issueLoan, { accessionNo, studentId });
    if (!issued.ok) throw new Error(issued.error.code);
    await sql`
      update public.library_loans
      set issued_on = (now() at time zone 'Asia/Kolkata')::date - 17, due_on = (now() at time zone 'Asia/Kolkata')::date - 3
      where id = ${issued.data.loanId}`;
    const [before] = await sql`select total::text as t from public.invoices where id = ${invoiceId}`;
    const rs = await Promise.all([callAs(inst, "admin", returnLoan, { accessionNo }), callAs(inst, "admin", returnLoan, { accessionNo })]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    const [after] = await sql`select total::text as t from public.invoices where id = ${invoiceId}`;
    expect(Number(after.t) - Number(before.t)).toBe(6);
    const [lines] = await sql`select count(*)::int as n from public.invoice_lines where invoice_id = ${invoiceId} and head = 'library_fine'`;
    expect(lines.n).toBeGreaterThanOrEqual(1);
  });

  it("issue with both or neither borrower, or a blank accession → validation_failed", async () => {
    const accessionNo = await copy();
    const [s] = await sql`select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'`;
    const both = await callAs(inst, "admin", issueLoan, { accessionNo, studentId, staffId: s.staff_id });
    expect(both.ok ? null : both.error.code).toBe("validation_failed");
    const neither = await callAs(inst, "admin", issueLoan, { accessionNo });
    expect(neither.ok ? null : neither.error.code).toBe("validation_failed");
    const blank = await callAs(inst, "admin", returnLoan, { accessionNo: "   " });
    expect(blank.ok ? null : blank.error.code).toBe("validation_failed");
  });
});
