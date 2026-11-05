"use server";

// X03-T6 — library.loan.issue / library.loan.renew / library.loan.return
// (X03-tasks.md rulings "RPCs"; migration 0086 parts 1–2). Each action
// resolves the caller-given accession number to a row in ctx.institution
// (else not_found — never leaks another institution's row), then calls the
// matching definer RPC, which re-checks the caller's role on that row's own
// institution and does the actual write + audit (`library.loan.issued` /
// `.renewed` / `.returned`). No TS-side audit here (rulings: "no TS audit —
// the RPCs audit").
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { createClient } from "@/lib/supabase/server";
import {
  LoanIssueSchema,
  LoanRenewSchema,
  LoanReturnSchema,
  type LoanIssueInput,
  type LoanRenewInput,
  type LoanReturnInput,
} from "@/modules/library/schemas";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

/** Both RPCs return jsonb — the generated `Json` type carries no field names; narrow once at the boundary (admissions/actions.ts's asJsonRecord precedent). */
function asJsonRecord(data: unknown): Record<string, unknown> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new AppError("internal", "Unexpected response shape.");
  }
  return data as Record<string, unknown>;
}

export const issueLoan = defineAction({
  name: "library.loan.issue",
  module: "library",
  schema: LoanIssueSchema,
  permission: "library.manage",
  handler: async (input: LoanIssueInput, ctx) => {
    const supabase = await createClient();
    const { data: copy, error: copyError } = await supabase
      .from("library_copies")
      .select("id")
      .eq("institution_id", ctx.institution.id)
      .eq("accession_no", input.accessionNo)
      .maybeSingle();
    if (copyError) throwMapped(copyError);
    if (!copy) throw new AppError("not_found", "No copy with this accession number.");

    const { data, error } = await supabase.rpc("issue_library_loan", {
      p_copy_id: copy.id,
      p_student_id: input.studentId,
      p_staff_id: input.staffId,
    });
    if (error) throwMapped(error);

    const result = asJsonRecord(data);
    return { loanId: result.loan_id as string, dueOn: result.due_on as string };
  },
});

export const renewLoan = defineAction({
  name: "library.loan.renew",
  module: "library",
  schema: LoanRenewSchema,
  permission: "library.manage",
  handler: async (input: LoanRenewInput, ctx) => {
    const supabase = await createClient();
    const { data: loan, error: loanError } = await supabase
      .from("library_loans")
      .select("id, library_copies!inner(accession_no)")
      .eq("institution_id", ctx.institution.id)
      .eq("library_copies.accession_no", input.accessionNo)
      .is("returned_on", null)
      .maybeSingle();
    if (loanError) throwMapped(loanError);
    if (!loan) throw new AppError("not_found", "No open loan for this book.");

    const { data, error } = await supabase.rpc("renew_library_loan", { p_loan_id: loan.id });
    if (error) throwMapped(error);

    const result = asJsonRecord(data);
    return { loanId: result.loan_id as string, dueOn: result.due_on as string };
  },
});

export const returnLoan = defineAction({
  name: "library.loan.return",
  module: "library",
  schema: LoanReturnSchema,
  permission: "library.manage",
  handler: async (input: LoanReturnInput, ctx) => {
    const supabase = await createClient();
    const { data: loan, error: loanError } = await supabase
      .from("library_loans")
      .select("id, library_copies!inner(accession_no)")
      .eq("institution_id", ctx.institution.id)
      .eq("library_copies.accession_no", input.accessionNo)
      .is("returned_on", null)
      .maybeSingle();
    if (loanError) throwMapped(loanError);
    if (!loan) throw new AppError("not_found", "No open loan for this book.");

    const { data, error } = await supabase.rpc("return_library_loan", {
      p_loan_id: loan.id,
      p_waive_fine: input.waiveFine,
    });
    if (error) throwMapped(error);

    const result = asJsonRecord(data);
    return {
      loanId: result.loan_id as string,
      returnedOn: result.returned_on as string,
      daysLate: result.days_late as number,
      fineAmount: result.fine_amount as number,
      fineCharged: result.invoice_line_id !== null,
    };
  },
});
