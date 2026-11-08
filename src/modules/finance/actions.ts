"use server";

// T-031 — finance module actions (06 §W9, 07 §2.2 finance.structure.manage /
// finance.invoice.generate). Structure/assignment writes are direct RLS
// upserts (same shape as attendance.actions.ts's markAttendance) — RLS
// already re-checks institution membership in `with check`, but every id
// is also verified here first (packet rule 2) so a cross-tenant or missing
// id surfaces as `not_found`/`validation_failed`, not an opaque RLS-policy-
// violation mapped to `internal`. Invoice generation is strictly through
// `public.generate_invoice` (packet rule 2 / CLAUDE.md rule 5) — no
// TypeScript here ever inserts into `invoices`/`invoice_lines`.
import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import type { TenantContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { paymentModesFor } from "./queries";
import {
  AssignFeeStructureSchema,
  BulkGenerateStudentInvoicesSchema,
  GenerateStudentInvoiceSchema,
  GenerateTermInvoicesSchema,
  RecordPaymentSchema,
  UpsertFeeStructureSchema,
  type AssignFeeStructureInput,
  type BulkGenerateStudentInvoicesInput,
  type GenerateStudentInvoiceInput,
  type GenerateTermInvoicesInput,
  type RecordPaymentInput,
  type UpsertFeeStructureInput,
} from "./schemas";

type FinanceClient = Awaited<ReturnType<typeof createClient>>;

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

async function requireAcademicYear(supabase: FinanceClient, institutionId: string, id: string): Promise<void> {
  const { data, error } = await supabase
    .from("academic_years")
    .select("id")
    .eq("id", id)
    .eq("institution_id", institutionId)
    .maybeSingle();
  if (error) throwMapped(error);
  if (!data) throw new AppError("not_found", "Academic year not found.");
}

async function requireGrade(supabase: FinanceClient, institutionId: string, id: string): Promise<void> {
  const { data, error } = await supabase
    .from("grades")
    .select("id")
    .eq("id", id)
    .eq("institution_id", institutionId)
    .maybeSingle();
  if (error) throwMapped(error);
  if (!data) throw new AppError("not_found", "Grade not found.");
}

async function requireStudent(supabase: FinanceClient, institutionId: string, id: string): Promise<void> {
  const { data, error } = await supabase
    .from("students")
    .select("id")
    .eq("id", id)
    .eq("institution_id", institutionId)
    .maybeSingle();
  if (error) throwMapped(error);
  if (!data) throw new AppError("not_found", "Student not found.");
}

interface TermRow {
  id: string;
  academic_year_id: string;
}

async function requireTerm(supabase: FinanceClient, institutionId: string, id: string): Promise<TermRow> {
  const { data, error } = await supabase
    .from("terms")
    .select("id, academic_year_id")
    .eq("id", id)
    .eq("institution_id", institutionId)
    .maybeSingle();
  if (error) throwMapped(error);
  if (!data) throw new AppError("not_found", "Term not found.");
  return data;
}

interface InvoiceRow {
  id: string;
  institution_id: string;
}

async function requireInvoice(supabase: FinanceClient, institutionId: string, id: string): Promise<InvoiceRow> {
  const { data, error } = await supabase
    .from("invoices")
    .select("id, institution_id")
    .eq("id", id)
    .eq("institution_id", institutionId)
    .maybeSingle();
  if (error) throwMapped(error);
  if (!data) throw new AppError("not_found", "Invoice not found.");
  return data;
}

interface FeeStructureRow {
  id: string;
  academic_year_id: string;
}

async function requireFeeStructure(supabase: FinanceClient, institutionId: string, id: string): Promise<FeeStructureRow> {
  const { data, error } = await supabase
    .from("fee_structures")
    .select("id, academic_year_id")
    .eq("id", id)
    .eq("institution_id", institutionId)
    .maybeSingle();
  if (error) throwMapped(error);
  if (!data) throw new AppError("not_found", "Fee structure not found.");
  return data;
}

export const upsertFeeStructure = defineAction({
  name: "finance.structure.upsert",
  module: "fees",
  schema: UpsertFeeStructureSchema,
  permission: "finance.structure.manage",
  handler: async (input: UpsertFeeStructureInput, ctx) => {
    const supabase = await createClient();
    await requireAcademicYear(supabase, ctx.institution.id, input.academicYearId);
    await requireGrade(supabase, ctx.institution.id, input.gradeId);

    let structureId: string;
    if (input.id) {
      await requireFeeStructure(supabase, ctx.institution.id, input.id);
      const { data, error } = await supabase
        .from("fee_structures")
        .update({
          academic_year_id: input.academicYearId,
          grade_id: input.gradeId,
          name: input.name,
          is_default: input.isDefault ?? false,
        })
        .eq("id", input.id)
        .eq("institution_id", ctx.institution.id)
        .select("id")
        .single();
      if (error) throwMapped(error);
      structureId = data.id;
    } else {
      // AC1: a second save with the same (year, grade, name) updates
      // instead of duplicating — the table's own unique constraint.
      const { data, error } = await supabase
        .from("fee_structures")
        .upsert(
          {
            institution_id: ctx.institution.id,
            academic_year_id: input.academicYearId,
            grade_id: input.gradeId,
            name: input.name,
            is_default: input.isDefault ?? false,
          },
          { onConflict: "academic_year_id,grade_id,name" },
        )
        .select("id")
        .single();
      if (error) throwMapped(error);
      structureId = data.id;
    }

    // shortcut: components upsert by head (onConflict fee_structure_id,head)
    // only — a head removed from the form stays on the structure until
    // replaced. Upgrade with an explicit delete-missing-heads pass if a
    // demo scenario needs component removal (none does today).
    const { error: componentsError } = await supabase.from("fee_components").upsert(
      input.components.map((c) => ({
        institution_id: ctx.institution.id,
        fee_structure_id: structureId,
        head: c.head,
        amount: c.amount,
        frequency: c.frequency,
        applies_to_new_only: c.appliesToNewOnly ?? false,
      })),
      { onConflict: "fee_structure_id,head" },
    );
    if (componentsError) throwMapped(componentsError);

    // Audit carries ids and amounts only (packet rule 7) — no free-text name.
    await audit(ctx, {
      action: "finance.structure.upserted",
      entityType: "fee_structure",
      entityId: structureId,
      after: {
        academicYearId: input.academicYearId,
        gradeId: input.gradeId,
        components: input.components.map((c) => ({ head: c.head, amount: c.amount, frequency: c.frequency })),
      },
    });

    revalidatePath(`/${ctx.institution.slug}/finance/structures`);
    revalidatePath(`/${ctx.institution.slug}/finance/structures/${structureId}`);
    return { id: structureId };
  },
});

export const assignFeeStructure = defineAction({
  name: "finance.structure.assign",
  module: "fees",
  schema: AssignFeeStructureSchema,
  permission: "finance.structure.manage",
  handler: async (input: AssignFeeStructureInput, ctx) => {
    const supabase = await createClient();
    await requireStudent(supabase, ctx.institution.id, input.studentId);
    await requireAcademicYear(supabase, ctx.institution.id, input.academicYearId);
    const structure = await requireFeeStructure(supabase, ctx.institution.id, input.feeStructureId);
    if (structure.academic_year_id !== input.academicYearId) {
      throw new AppError("validation_failed", "Fee structure does not belong to this academic year.", {
        feeStructureId: ["Fee structure does not belong to this academic year."],
      });
    }

    const { data: components, error: componentsError } = await supabase
      .from("fee_components")
      .select("head")
      .eq("fee_structure_id", input.feeStructureId)
      .eq("institution_id", ctx.institution.id);
    if (componentsError) throwMapped(componentsError);
    const validHeads = new Set((components ?? []).map((c) => c.head));
    const badConcession = input.concessions.find((c) => c.head && !validHeads.has(c.head));
    if (badConcession) {
      throw new AppError("validation_failed", `"${badConcession.head}" is not a component on this fee structure.`, {
        head: [`"${badConcession.head}" is not a component on this fee structure.`],
      });
    }

    const { data: assignment, error: assignmentError } = await supabase
      .from("fee_assignments")
      .upsert(
        {
          institution_id: ctx.institution.id,
          student_id: input.studentId,
          fee_structure_id: input.feeStructureId,
          academic_year_id: input.academicYearId,
          assigned_by: ctx.user.id,
        },
        { onConflict: "student_id,academic_year_id" },
      )
      .select("id")
      .single();
    if (assignmentError) throwMapped(assignmentError);

    // shortcut: re-assigning doesn't clear prior concessions on the same
    // assignment id — upgrade with a replace-concessions step if a demo
    // re-assign scenario needs it (none does today).
    if (input.concessions.length > 0) {
      const { error: concessionsError } = await supabase.from("concessions").insert(
        input.concessions.map((c) => ({
          institution_id: ctx.institution.id,
          fee_assignment_id: assignment.id,
          kind: c.kind,
          head: c.head ?? null,
          percent: c.percent ?? null,
          amount: c.amount ?? null,
          approved_by: ctx.user.id,
          reason: c.reason,
        })),
      );
      if (concessionsError) throwMapped(concessionsError);
    }

    await audit(ctx, {
      action: "finance.structure.assigned",
      entityType: "fee_assignment",
      entityId: assignment.id,
      after: {
        studentId: input.studentId,
        feeStructureId: input.feeStructureId,
        concessions: input.concessions.map((c) => ({ head: c.head ?? null, percent: c.percent ?? null, amount: c.amount ?? null })),
      },
    });

    revalidatePath(`/${ctx.institution.slug}/finance/structures/${input.feeStructureId}`);
    return { id: assignment.id };
  },
});

// Fix round 1 (code review, HIGH): mirrors the job handler's soft-budget
// guard (src/modules/jobs/handlers/finance.generate_term_invoices.ts) —
// stops cleanly before the platform request timeout instead of looping
// every student unbounded. `runGenerateTermInvoices` is exported (as an
// async function — "use server" files may only export async functions, so
// this constant stays module-private) so tests can inject a tiny budget
// directly, bypassing defineAction's permission/context wiring (same shape
// as the job handler being called directly in
// tests/db/invoice-generation.test.ts).
const DEFAULT_GENERATE_TERM_INVOICES_BUDGET_MS = 20_000;

export interface GenerateTermInvoicesResult {
  mode: "sync";
  studentCount: number;
  generated: number;
  alreadyExisted: number;
  failed: number;
  remaining: number;
}

// T-031 phase 2: the "all grades" path enqueues instead of running
// synchronously (see schemas.ts comment) — `public.enqueue_term_invoices`
// (20261028000017) does the role/tenant checks and returns the job id.
export interface EnqueueTermInvoicesResult {
  mode: "enqueued";
  jobId: string;
}

export async function runGenerateTermInvoices(
  supabase: FinanceClient,
  ctx: TenantContext,
  input: GenerateTermInvoicesInput & { gradeId: string },
  budgetMs: number = DEFAULT_GENERATE_TERM_INVOICES_BUDGET_MS,
): Promise<GenerateTermInvoicesResult> {
  const term = await requireTerm(supabase, ctx.institution.id, input.termId);
  await requireGrade(supabase, ctx.institution.id, input.gradeId);

  const { data: enrolments, error: enrolError } = await supabase
    .from("enrolments")
    .select("student_id, class_sections!inner(grade_id)")
    .eq("institution_id", ctx.institution.id)
    .eq("academic_year_id", term.academic_year_id)
    .eq("status", "active")
    .eq("class_sections.grade_id", input.gradeId);
  if (enrolError) throwMapped(enrolError);

  const studentIds = Array.from(new Set((enrolments ?? []).map((e) => e.student_id)));

  // Bug fix: a large grade's student_id list sent whole via `.in()` built a
  // GET request URL long enough to hit the server's URI-length limit ("URI
  // too long"), failing the whole run. Chunked so each request's query
  // string stays well under any such limit, regardless of grade size.
  const STUDENT_ID_CHUNK_SIZE = 150;
  const existingIds = new Set<string>();
  for (let i = 0; i < studentIds.length; i += STUDENT_ID_CHUNK_SIZE) {
    const chunk = studentIds.slice(i, i + STUDENT_ID_CHUNK_SIZE);
    const { data: existing, error: existingError } = await supabase
      .from("invoices")
      .select("student_id")
      .eq("institution_id", ctx.institution.id)
      .eq("term_id", input.termId)
      .neq("status", "cancelled")
      .in("student_id", chunk);
    if (existingError) throwMapped(existingError);
    for (const row of existing ?? []) existingIds.add(row.student_id);
  }

  const toProcess = studentIds.filter((id) => !existingIds.has(id));
  const alreadyExisted = studentIds.length - toProcess.length;

  // Packet rule 5: no TS-callable job enqueue exists (`app.enqueue_job`
  // lives in the `app` schema, which `supabase/config.toml` does not
  // expose over PostgREST) — synchronous per-student path through
  // `public.generate_invoice` (already idempotent per student/term), not
  // a generic enqueue helper (T-037 lesson). `key` documents the
  // idempotency key a future bulk-enqueue wrapper should use.
  const key = `invoices:${input.termId}:${input.gradeId}`;
  const deadline = Date.now() + budgetMs;
  let generated = 0;
  let failed = 0;
  let processed = 0;
  for (const studentId of toProcess) {
    if (Date.now() >= deadline) break;
    const { error } = await supabase.rpc("generate_invoice", { p_student_id: studentId, p_term_id: input.termId });
    processed += 1;
    if (error) {
      failed += 1;
      continue;
    }
    generated += 1;
  }
  const remaining = toProcess.length - processed;

  await audit(ctx, {
    action: "finance.invoice.generate_term",
    entityType: "term",
    entityId: input.termId,
    after: { gradeId: input.gradeId, studentCount: studentIds.length, generated, alreadyExisted, failed, remaining },
    metadata: { key },
  });

  return { mode: "sync", studentCount: studentIds.length, generated, alreadyExisted, failed, remaining };
}

export const generateTermInvoices = defineAction({
  name: "finance.invoice.generateTerm",
  module: "fees",
  schema: GenerateTermInvoicesSchema,
  permission: "finance.invoice.generate",
  handler: async (input: GenerateTermInvoicesInput, ctx): Promise<GenerateTermInvoicesResult | EnqueueTermInvoicesResult> => {
    const supabase = await createClient();

    // No gradeId = "all grades" — enqueue (T-031 phase 2) instead of a
    // synchronous whole-school loop. `public.enqueue_term_invoices` itself
    // re-proves term/grade belong to this institution and re-checks the
    // finance-write role (defense in depth, same shape as
    // generate_invoice/record_payment's public wrappers).
    if (!input.gradeId) {
      const { data, error } = await supabase.rpc("enqueue_term_invoices", {
        p_institution_id: ctx.institution.id,
        p_term_id: input.termId,
      });
      if (error) throwMapped(error);
      const jobId = (data as { jobId: string } | null)?.jobId;
      revalidatePath(`/${ctx.institution.slug}/finance/invoices`);
      return { mode: "enqueued", jobId: jobId ?? "" };
    }

    const result = await runGenerateTermInvoices(supabase, ctx, { ...input, gradeId: input.gradeId });
    revalidatePath(`/${ctx.institution.slug}/finance/invoices`);
    return result;
  },
});

export const generateStudentInvoice = defineAction({
  name: "finance.invoice.generateStudent",
  module: "fees",
  schema: GenerateStudentInvoiceSchema,
  permission: "finance.invoice.generate",
  handler: async (input: GenerateStudentInvoiceInput, ctx) => {
    const supabase = await createClient();
    await requireStudent(supabase, ctx.institution.id, input.studentId);
    await requireTerm(supabase, ctx.institution.id, input.termId);

    // `app.generate_invoice` writes its own `finance.invoice.generated`
    // audit row — no second audit call here (would double-audit).
    const { data, error } = await supabase.rpc("generate_invoice", {
      p_student_id: input.studentId,
      p_term_id: input.termId,
    });
    if (error) throwMapped(error);

    revalidatePath(`/${ctx.institution.slug}/finance/invoices`);
    return { invoiceId: data as string };
  },
});

export interface BulkGenerateStudentInvoicesResult {
  generated: { studentId: string; invoiceId: string }[];
  failed: { studentId: string; code: string; message: string }[];
}

/**
 * Bulk action on students: this term's invoice for each selected student.
 * One `generate_invoice` call per student (it audits itself, like
 * generateStudentInvoice); a per-student failure (e.g. no fee structure
 * assigned) is reported, not thrown, so one bad row never blocks the rest.
 */
export const bulkGenerateStudentInvoices = defineAction({
  name: "finance.invoice.generateBulk",
  module: "fees",
  schema: BulkGenerateStudentInvoicesSchema,
  permission: "finance.invoice.generate",
  handler: async (input: BulkGenerateStudentInvoicesInput, ctx): Promise<BulkGenerateStudentInvoicesResult> => {
    const supabase = await createClient();
    await requireTerm(supabase, ctx.institution.id, input.termId);
    const ids = [...new Set(input.studentIds)];
    const { data: found, error: foundError } = await supabase
      .from("students")
      .select("id")
      .eq("institution_id", ctx.institution.id)
      .in("id", ids);
    if (foundError) throwMapped(foundError);
    if ((found ?? []).length !== ids.length) throw new AppError("not_found", "One or more students not found.");

    const result: BulkGenerateStudentInvoicesResult = { generated: [], failed: [] };
    for (const studentId of ids) {
      const { data, error } = await supabase.rpc("generate_invoice", { p_student_id: studentId, p_term_id: input.termId });
      if (error) {
        const mapped = mapSqlError(error);
        result.failed.push(
          mapped.ok
            ? { studentId, code: "internal", message: "Unexpected error." }
            : { studentId, code: mapped.error.code, message: mapped.error.message },
        );
      } else {
        result.generated.push({ studentId, invoiceId: data as string });
      }
    }

    revalidatePath(`/${ctx.institution.slug}/finance/invoices`);
    return result;
  },
});

export interface RecordPaymentResult {
  paymentId: string;
  receiptId: string;
  receiptNo: string;
}

interface RecordPaymentRpcResult {
  payment_id: string;
  receipt_id: string;
  receipt_no: string;
}

// T-032 — 06 §W9. `finance.payment.record` excludes admin (07 §2.2; see
// `app.finance_write_roles()` in the finance migration), enforced by
// defineAction's permission check before this handler ever runs.
// `requireInvoice` proves the invoice belongs to `ctx.institution` first —
// `public.record_payment` only checks the caller's role against the
// invoice's own institution_id, not against the route's institution, so
// skipping this check would let a user with a finance role in institution A
// record a payment against an invoice id from institution B as long as the
// id ever resolved (packet rule: "Prove the invoice belongs to
// ctx.institution"). `app.record_payment` writes its own
// `finance.payment.recorded` audit row — no second audit call here.
export const recordPayment = defineAction({
  name: "finance.payment.record",
  module: "fees",
  schema: RecordPaymentSchema,
  permission: "finance.payment.record",
  handler: async (input: RecordPaymentInput, ctx): Promise<RecordPaymentResult> => {
    const supabase = await createClient();
    await requireInvoice(supabase, ctx.institution.id, input.invoiceId);

    const modes = paymentModesFor(ctx.institution.settings);
    if (!modes.includes(input.mode)) {
      throw new AppError("validation_failed", `"${input.mode}" is not an accepted payment mode for this school.`, {
        mode: [`"${input.mode}" is not an accepted payment mode for this school.`],
      });
    }

    const { data, error } = await supabase.rpc("record_payment", {
      p_invoice_id: input.invoiceId,
      p_amount: input.amount,
      p_mode: input.mode,
      p_reference: (input.reference ?? null) as string,
      p_received_at: input.receivedAt.toISOString(),
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throwMapped(error);
    const result = data as unknown as RecordPaymentRpcResult;

    revalidatePath(`/${ctx.institution.slug}/finance/invoices/${input.invoiceId}`);
    revalidatePath(`/${ctx.institution.slug}/finance/invoices`);
    revalidatePath(`/${ctx.institution.slug}/finance/ledger`);
    revalidatePath(`/${ctx.institution.slug}/finance/defaulters`);

    return { paymentId: result.payment_id, receiptId: result.receipt_id, receiptNo: result.receipt_no };
  },
});
