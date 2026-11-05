// X03-T9 — library acceptance over HTTP (X03-tasks.md Task 9; HTTP helpers
// mirror tests/db/timetable-acceptance.test.ts, second-guardian fixture
// mirrors tests/db/operations-acceptance.test.ts's addGuardianWithChild).
// Admin creates a book + 2 copies, issues copy 1 to child A (the fixture's
// own guardian/student roles, linked below); the same copy to child B ->
// 409 conflict; teacher issue -> 403. Backdates A's loan 3 days overdue;
// checks library.overdue and myLoans scoping (G1 sees it, G2 with A's id
// sees []). Admin returns it -> fine charged to A's invoice
// (finance.getInvoice shows the library_fine line + invoice total up;
// finance.listLedgerEntries balanced); returning the same accession again
// -> 404. Owner disables the module -> issue and myLoans both 403
// MODULE_DISABLED_MESSAGE; re-enabling restores 200.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { POST as actionsPost } from "@/app/api/v1/actions/[name]/route";
import { GET as queryGet } from "@/app/api/v1/query/[name]/route";
import { MODULE_DISABLED_MESSAGE } from "@/lib/modules/catalog";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createFeeAssignment,
  createFeeComponent,
  createFeeStructure,
  createGrade,
  createTerm,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type FixtureRole, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const PASSWORD = "correct-horse-battery-staple";

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

function actionRequest(name: string, body: unknown, headers: Record<string, string>): Request {
  return new Request(`http://localhost/api/v1/actions/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function dispatchAction(name: string, body: unknown, headers: Record<string, string>): Promise<Response> {
  return actionsPost(actionRequest(name, body, headers), { params: Promise.resolve({ name }) });
}

function queryUrl(name: string, institution: string, input: unknown): URL {
  const url = new URL(`http://localhost/api/v1/query/${name}`);
  url.searchParams.set("institution", institution);
  url.searchParams.set("input", JSON.stringify(input));
  return url;
}

function dispatchQuery(name: string, institution: string, input: unknown, headers: Record<string, string>): Promise<Response> {
  return queryGet(new Request(queryUrl(name, institution, input), { headers }), { params: Promise.resolve({ name }) });
}

async function tokenForClient(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session) throw error ?? new Error("no session");
  return data.session.access_token;
}

async function tokenFor(inst: TestInstitution, role: FixtureRole): Promise<string> {
  return tokenForClient(inst.clientAs(role));
}

function adminClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
}

/** A second guardian + their own child in an already-created institution — mirrors operations-acceptance.test.ts's addGuardianWithChild. */
async function addGuardianWithChild(inst: TestInstitution, label: string): Promise<{ client: SupabaseClient; studentId: string }> {
  const admin = adminClient();
  const email = `second-${label.replace(/\s+/g, "-")}-${crypto.randomUUID()}@test.coolskool.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw error ?? new Error(`failed to create ${label}`);

  const [guardian] = await sql`
    insert into public.guardians (institution_id, full_name, phone)
    values (${inst.institutionId}, ${label}, '9876500001')
    returning id
  `;
  await sql`
    insert into public.memberships (institution_id, user_id, role, guardian_id)
    values (${inst.institutionId}, ${data.user.id}, 'guardian', ${guardian.id})
  `;
  const [student] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${inst.institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, ${label}, '2015-01-01', 'other')
    returning id
  `;
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${inst.institutionId}, ${guardian.id}, ${student.id}, 'father', true, true)
  `;

  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError) throw signInError;
  return { client, studentId: student.id as string };
}

/** Links the fixture's own guardian/student roles (G1/A) via guardian_students — mirrors library-rls.test.ts's own-child fixture. */
async function linkDefaultGuardianToStudent(inst: TestInstitution): Promise<string> {
  const [guardianRow] = await sql`
    select guardian_id from public.memberships where institution_id = ${inst.institutionId} and role = 'guardian'
  `;
  const [studentRow] = await sql`
    select student_id from public.memberships where institution_id = ${inst.institutionId} and role = 'student'
  `;
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${inst.institutionId}, ${guardianRow.guardian_id}, ${studentRow.student_id}, 'mother', true, true)
  `;
  return studentRow.student_id as string;
}

/** Fee structure + a fully-paid invoice for one student, term far in the past/future so it's always "current" — mirrors library-circulation-actions.test.ts's setupPaidInvoice. */
async function setupPaidInvoice(institutionId: string, studentId: string, amount = 100): Promise<string> {
  await sql`
    update public.institutions
    set settings = settings || jsonb_build_object(
      'finance', jsonb_build_object('financial_year_start_month', 4, 'default_due_day', 10, 'payment_modes', array['cash']),
      'numbering', jsonb_build_object('invoice_no', 'INV/{FY}/{SEQ:6}', 'receipt_no', 'RCT/{FY}/{SEQ:6}')
    )
    where id = ${institutionId}
  `;
  const yearId = await createAcademicYear(institutionId, { startsOn: "2020-01-01", endsOn: "2030-03-31" });
  const termId = await createTerm(institutionId, yearId, { sequence: 1, startsOn: "2020-01-01", endsOn: "2030-03-31" });
  const gradeId = await createGrade(institutionId);
  const structureId = await createFeeStructure(institutionId, yearId, gradeId);
  await createFeeComponent(institutionId, structureId, { head: "tuition", amount, frequency: "term" });
  await createFeeAssignment(institutionId, studentId, structureId, yearId);
  const [row] = await sql`select app.generate_invoice(${studentId}::uuid, ${termId}::uuid) as id`;
  const invoiceId = row.id as string;
  await sql`select app.record_payment(${invoiceId}::uuid, ${amount}, 'cash', null, now(), ${crypto.randomUUID()})`;
  return invoiceId;
}

/** Backdates a loan to `daysLate` days overdue (issued_on shifts too, to keep due_on >= issued_on) — same shift as library-circulation-actions.test.ts's backdateDueOn. */
async function backdateLoan(loanId: string, daysLate: number): Promise<void> {
  await sql`
    update public.library_loans
    set issued_on = current_date - ${daysLate + 14}::int, due_on = current_date - ${daysLate}::int
    where id = ${loanId}::uuid
  `;
}

describe("X03-T9 library acceptance: admin runs the loan lifecycle over HTTP", () => {
  it(
    "issue/conflict/forbidden, overdue + myLoans scoping, return charges the fine to the invoice, double-return 404, module disabled -> forbidden",
    async () => {
      const inst = await createTestInstitution("library-acceptance");
      try {
        const studentAId = await linkDefaultGuardianToStudent(inst);
        const { client: g2Client, studentId: studentBId } = await addGuardianWithChild(inst, "Second Guardian");
        const invoiceId = await setupPaidInvoice(inst.institutionId, studentAId, 100);

        const adminAuth = { authorization: `Bearer ${await tokenFor(inst, "admin")}` };
        const teacherAuth = { authorization: `Bearer ${await tokenFor(inst, "teacher")}` };
        const guardian1Auth = { authorization: `Bearer ${await tokenFor(inst, "guardian")}` };
        const guardian2Auth = { authorization: `Bearer ${await tokenForClient(g2Client)}` };
        const ownerAuth = { authorization: `Bearer ${await tokenFor(inst, "owner")}` };

        // --- Admin creates a book + 2 copies ---------------------------------
        const bookRes = await dispatchAction(
          "library.book.upsert",
          { institution: inst.slug, input: { title: "Malgudi Days", author: "R. K. Narayan" } },
          adminAuth,
        );
        expect(bookRes.status).toBe(200);
        const bookBody = await bookRes.json();
        expect(bookBody.ok).toBe(true);
        const bookId = bookBody.data.id as string;

        const accession1 = "LIB-T9-0001";
        const accession2 = "LIB-T9-0002";
        const copiesRes = await dispatchAction(
          "library.copies.add",
          { institution: inst.slug, input: { bookId, accessionNos: [accession1, accession2] } },
          adminAuth,
        );
        expect(copiesRes.status).toBe(200);
        const copiesBody = await copiesRes.json();
        expect(copiesBody.ok).toBe(true);
        expect(copiesBody.data.ids).toHaveLength(2);

        // --- Issue copy 1 to child A (guardian G1's child) -> 200 with dueOn --
        const issueRes = await dispatchAction(
          "library.loan.issue",
          { institution: inst.slug, input: { accessionNo: accession1, studentId: studentAId } },
          adminAuth,
        );
        expect(issueRes.status).toBe(200);
        const issueBody = await issueRes.json();
        expect(issueBody.ok).toBe(true);
        expect(typeof issueBody.data.dueOn).toBe("string");
        const loanId = issueBody.data.loanId as string;

        // --- Same copy to child B -> 409 conflict ------------------------------
        const conflictRes = await dispatchAction(
          "library.loan.issue",
          { institution: inst.slug, input: { accessionNo: accession1, studentId: studentBId } },
          adminAuth,
        );
        expect(conflictRes.status).toBe(409);
        const conflictBody = await conflictRes.json();
        expect(conflictBody.ok).toBe(false);
        expect(conflictBody.error.code).toBe("conflict");

        // --- Teacher issue -> 403 forbidden ------------------------------------
        const teacherIssueRes = await dispatchAction(
          "library.loan.issue",
          { institution: inst.slug, input: { accessionNo: accession2, studentId: studentAId } },
          teacherAuth,
        );
        expect(teacherIssueRes.status).toBe(403);
        const teacherIssueBody = await teacherIssueRes.json();
        expect(teacherIssueBody.ok).toBe(false);
        expect(teacherIssueBody.error.code).toBe("forbidden");

        // --- Backdate A's due_on 3 days -----------------------------------------
        await backdateLoan(loanId, 3);

        // --- library.overdue -> A's loan, daysOverdue 3, fineSoFar 3 x default rate (paise) ---
        const overdueRes = await dispatchQuery("library.overdue", inst.slug, {}, adminAuth);
        expect(overdueRes.status).toBe(200);
        const overdueBody = await overdueRes.json();
        expect(overdueBody.ok).toBe(true);
        const overdueRow = (overdueBody.data as Array<Record<string, unknown>>).find((r) => r.loanId === loanId);
        expect(overdueRow).toBeDefined();
        expect(overdueRow?.daysOverdue).toBe(3);
        expect(overdueRow?.fineSoFar).toBe(300);

        // --- G1 myLoans -> A's loan, overdue ------------------------------------
        const g1LoansRes = await dispatchQuery("library.myLoans", inst.slug, {}, guardian1Auth);
        expect(g1LoansRes.status).toBe(200);
        const g1LoansBody = await g1LoansRes.json();
        expect(g1LoansBody.ok).toBe(true);
        const g1Loan = (g1LoansBody.data as Array<Record<string, unknown>>).find((r) => r.loanId === loanId);
        expect(g1Loan).toBeDefined();
        expect(g1Loan?.daysOverdue as number).toBeGreaterThan(0);

        // --- G2 myLoans with A's id -> [] ---------------------------------------
        const g2LoansRes = await dispatchQuery("library.myLoans", inst.slug, { studentId: studentAId }, guardian2Auth);
        expect(g2LoansRes.status).toBe(200);
        const g2LoansBody = await g2LoansRes.json();
        expect(g2LoansBody.ok).toBe(true);
        expect(g2LoansBody.data).toEqual([]);

        // --- Admin returns the loan -> fine charged -----------------------------
        const returnRes = await dispatchAction(
          "library.loan.return",
          { institution: inst.slug, input: { accessionNo: accession1 } },
          adminAuth,
        );
        expect(returnRes.status).toBe(200);
        const returnBody = await returnRes.json();
        expect(returnBody.ok).toBe(true);
        expect(returnBody.data.fineCharged).toBe(true);
        expect(returnBody.data.fineAmount).toBe(3);

        // --- finance.getInvoice shows the library_fine line + outstanding up ----
        const invoiceRes = await dispatchQuery("finance.getInvoice", inst.slug, { id: invoiceId }, adminAuth);
        expect(invoiceRes.status).toBe(200);
        const invoiceBody = await invoiceRes.json();
        expect(invoiceBody.ok).toBe(true);
        const fineLine = (invoiceBody.data.lines as Array<Record<string, unknown>>).find((l) => l.head === "library_fine");
        expect(fineLine).toBeDefined();
        expect(fineLine?.amount).toBe(3);
        const outstanding = (invoiceBody.data.total as number) - (invoiceBody.data.paidTotal as number);
        expect(outstanding).toBe(3);

        // --- finance.listLedgerEntries -> balanced ------------------------------
        const ledgerRes = await dispatchQuery(
          "finance.listLedgerEntries",
          inst.slug,
          { from: "2020-01-01", to: "2030-12-31" },
          adminAuth,
        );
        expect(ledgerRes.status).toBe(200);
        const ledgerBody = await ledgerRes.json();
        expect(ledgerBody.ok).toBe(true);
        expect(ledgerBody.data.balanced).toBe(true);

        // --- Return the same accession again -> 404 not_found -------------------
        const doubleReturnRes = await dispatchAction(
          "library.loan.return",
          { institution: inst.slug, input: { accessionNo: accession1 } },
          adminAuth,
        );
        expect(doubleReturnRes.status).toBe(404);
        const doubleReturnBody = await doubleReturnRes.json();
        expect(doubleReturnBody.ok).toBe(false);
        expect(doubleReturnBody.error.code).toBe("not_found");

        // --- Owner disables the module -> issue & myLoans both forbidden --------
        const disableRes = await dispatchAction(
          "core.module.set",
          { institution: inst.slug, input: { key: "library", enabled: false } },
          ownerAuth,
        );
        expect(disableRes.status).toBe(200);

        const issueDisabledRes = await dispatchAction(
          "library.loan.issue",
          { institution: inst.slug, input: { accessionNo: accession2, studentId: studentAId } },
          adminAuth,
        );
        expect(issueDisabledRes.status).toBe(403);
        const issueDisabledBody = await issueDisabledRes.json();
        expect(issueDisabledBody.ok).toBe(false);
        expect(issueDisabledBody.error.code).toBe("forbidden");
        expect(issueDisabledBody.error.message).toBe(MODULE_DISABLED_MESSAGE);

        const myLoansDisabledRes = await dispatchQuery("library.myLoans", inst.slug, {}, guardian1Auth);
        expect(myLoansDisabledRes.status).toBe(403);
        const myLoansDisabledBody = await myLoansDisabledRes.json();
        expect(myLoansDisabledBody.ok).toBe(false);
        expect(myLoansDisabledBody.error.code).toBe("forbidden");
        expect(myLoansDisabledBody.error.message).toBe(MODULE_DISABLED_MESSAGE);

        // --- Re-enable -> 200 -----------------------------------------------------
        const enableRes = await dispatchAction(
          "core.module.set",
          { institution: inst.slug, input: { key: "library", enabled: true } },
          ownerAuth,
        );
        expect(enableRes.status).toBe(200);
      } finally {
        await inst.cleanup();
      }
    },
    40000,
  );
});
