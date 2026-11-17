"use server";

// T-027 — admissions module actions (06 §W4, 07 §2.2 admissions.*).
// decideApplication/convertEnquiryToApplication/addEnquiryNote are thin
// wrappers over the security-definer RPCs in
// 20261028000016_admissions_transitions.sql, which are themselves the
// authorization/transition/audit boundary (same shape as attendance's
// submitAttendance/correctAttendance). updateEnquiryStatus/assignEnquiry
// stay direct RLS writes (lead ruling item 5) — RLS (0007) already scopes
// them to owner/principal/admin/admissions.
import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/actions/define-action";
import { audit } from "@/lib/audit";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { hasPermission } from "@/lib/auth/require";
import type { TenantContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { listInvoicesForStudent } from "@/modules/finance/queries";
import { enquiryStagesFor } from "./queries";
import {
  AddEnquiryNoteSchema,
  AssignEnquirySchema,
  ConvertEnquirySchema,
  DecideApplicationSchema,
  EnrolApplicantSchema,
  StartApplicationReviewSchema,
  UpdateEnquiryStatusSchema,
  type AddEnquiryNoteInput,
  type AssignEnquiryInput,
  type ConvertEnquiryInput,
  type DecideApplicationInput,
  type EnrolApplicantInput,
  type StartApplicationReviewInput,
  type UpdateEnquiryStatusInput,
} from "./schemas";
import { canDecide, canStartReview, canTransitionEnquiry, type ApplicationStatus } from "./state";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

/** The RPCs below return `jsonb` — the generated `Json` type carries no field names; narrow once at the boundary instead of casting at every call site. */
function asJsonRecord(data: unknown): Record<string, unknown> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new AppError("internal", "Unexpected response shape.");
  }
  return data as Record<string, unknown>;
}

function asJsonArray(data: unknown): Record<string, unknown>[] {
  if (!Array.isArray(data)) throw new AppError("internal", "Unexpected response shape.");
  return data as Record<string, unknown>[];
}

export const updateEnquiryStatus = defineAction({
  name: "admissions.enquiry.status",
  schema: UpdateEnquiryStatusSchema,
  module: "admissions",
  permission: "admissions.enquiry.write",
  handler: async (input: UpdateEnquiryStatusInput, ctx: TenantContext) => {
    const supabase = await createClient();
    const { data: enquiry, error: readError } = await supabase
      .from("enquiries")
      .select("id, status")
      .eq("id", input.enquiryId)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (readError) throwMapped(readError);
    if (!enquiry) throw new AppError("not_found", "Enquiry not found.");

    const stages = enquiryStagesFor(ctx);
    if (!canTransitionEnquiry(enquiry.status, input.status, stages)) {
      throw new AppError("invalid_state", `Cannot move from "${enquiry.status}" to "${input.status}".`);
    }

    const { error: updateError } = await supabase
      .from("enquiries")
      .update({ status: input.status })
      .eq("id", input.enquiryId)
      .eq("institution_id", ctx.institution.id);
    if (updateError) throwMapped(updateError);

    await audit(ctx, {
      action: "admissions.enquiry.status",
      entityType: "enquiry",
      entityId: input.enquiryId,
      before: { status: enquiry.status },
      after: { status: input.status },
    });

    if (input.note) {
      const { error: noteError } = await supabase.rpc("add_enquiry_note", {
        p_institution_id: ctx.institution.id,
        p_enquiry_id: input.enquiryId,
        p_text: input.note,
      });
      if (noteError) throwMapped(noteError);
    }

    revalidatePath(`/${ctx.institution.slug}/admissions`);
    return { enquiryId: input.enquiryId, status: input.status };
  },
});

export const addEnquiryNote = defineAction({
  name: "admissions.enquiry.note",
  schema: AddEnquiryNoteSchema,
  module: "admissions",
  permission: "admissions.enquiry.write",
  handler: async (input: AddEnquiryNoteInput, ctx: TenantContext) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("add_enquiry_note", {
      p_institution_id: ctx.institution.id,
      p_enquiry_id: input.enquiryId,
      p_text: input.text,
    });
    if (error) throwMapped(error);

    revalidatePath(`/${ctx.institution.slug}/admissions/enquiries/${input.enquiryId}`);
    return { enquiryId: input.enquiryId, notes: asJsonArray(data) };
  },
});

export const assignEnquiry = defineAction({
  name: "admissions.enquiry.assign",
  schema: AssignEnquirySchema,
  module: "admissions",
  permission: "admissions.enquiry.write",
  handler: async (input: AssignEnquiryInput, ctx: TenantContext) => {
    const supabase = await createClient();

    const { data: enquiry, error: readError } = await supabase
      .from("enquiries")
      .select("id")
      .eq("id", input.enquiryId)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (readError) throwMapped(readError);
    if (!enquiry) throw new AppError("not_found", "Enquiry not found.");

    // Fix round 1 (security review, HIGH): no pre-check RPC any more — a
    // `public.staff_in_institution` wrapper was a cross-tenant oracle (any
    // authenticated caller could learn whether a staff id belongs to an
    // arbitrary institution). staff_select RLS (0004) also excludes the
    // admissions role entirely, so a plain `.from("staff").select()`
    // pre-check would 404 a perfectly valid staff id for the one role that
    // actually uses this action. Instead: just attempt the write and let
    // enquiries_update's own WITH CHECK (20261028000016) be the only
    // authority — a cross-tenant or unknown staff id raises `42501`
    // (RLS violation), mapped to `not_found` below.
    const { error: updateError } = await supabase
      .from("enquiries")
      .update({ assigned_to: input.staffId })
      .eq("id", input.enquiryId)
      .eq("institution_id", ctx.institution.id);
    if (updateError) {
      if (updateError.code === "42501") {
        throw new AppError("not_found", "Staff member not found for this institution.");
      }
      throwMapped(updateError);
    }

    revalidatePath(`/${ctx.institution.slug}/admissions/enquiries/${input.enquiryId}`);
    return { enquiryId: input.enquiryId, staffId: input.staffId };
  },
});

export const convertEnquiryToApplication = defineAction({
  name: "admissions.enquiry.convert",
  schema: ConvertEnquirySchema,
  module: "admissions",
  permission: "admissions.enquiry.write",
  handler: async (input: ConvertEnquiryInput, ctx: TenantContext) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("convert_enquiry", {
      p_institution_id: ctx.institution.id,
      p_enquiry_id: input.enquiryId,
      p_applicant: input.applicant,
      p_guardian: input.guardian,
      p_grade_id: input.gradeId,
      p_academic_year_id: input.academicYearId,
    });
    if (error) throwMapped(error);

    revalidatePath(`/${ctx.institution.slug}/admissions`);
    const result = asJsonRecord(data);
    return {
      applicationId: result.application_id as string,
      applicationNo: result.application_no as string,
      enquiryId: result.enquiry_id as string,
    };
  },
});

export const decideApplication = defineAction({
  name: "admissions.application.decide",
  schema: DecideApplicationSchema,
  module: "admissions",
  permission: "admissions.application.decide",
  handler: async (input: DecideApplicationInput, ctx: TenantContext) => {
    // Fast client-side check against state.ts (06 §W4) so a stale UI gets a
    // friendly invalid_state before a round trip; app.decide_application
    // re-checks the SAME rule against the live row regardless (authority).
    const supabase = await createClient();
    const { data: current, error: readError } = await supabase
      .from("applications")
      .select("status")
      .eq("id", input.applicationId)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (readError) throwMapped(readError);
    if (!current) throw new AppError("not_found", "Application not found.");
    if (!canDecide(current.status as ApplicationStatus, input.decision)) {
      throw new AppError("invalid_state", `Cannot ${input.decision} an application in status "${current.status}".`);
    }

    const { data, error } = await supabase.rpc("decide_application", {
      p_institution_id: ctx.institution.id,
      p_application_id: input.applicationId,
      p_decision: input.decision,
      p_note: (input.note ?? null) as string,
    });
    if (error) throwMapped(error);

    const result = asJsonRecord(data);
    revalidatePath(`/${ctx.institution.slug}/admissions/applications/${input.applicationId}`);
    return { applicationId: result.application_id as string, status: result.status as string, decisionId: result.decision_id as string };
  },
});

export const startApplicationReview = defineAction({
  name: "admissions.application.start_review",
  schema: StartApplicationReviewSchema,
  module: "admissions",
  permission: "admissions.application.decide",
  handler: async (input: StartApplicationReviewInput, ctx: TenantContext) => {
    const supabase = await createClient();
    const { data: current, error: readError } = await supabase
      .from("applications")
      .select("status")
      .eq("id", input.applicationId)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (readError) throwMapped(readError);
    if (!current) throw new AppError("not_found", "Application not found.");
    if (!canStartReview(current.status as ApplicationStatus)) {
      throw new AppError("invalid_state", `Cannot start review of an application in status "${current.status}".`);
    }

    // The status filter makes a concurrent double-click a no-op instead of a rewrite.
    const { data, error } = await supabase
      .from("applications")
      .update({ status: "under_review" })
      .eq("id", input.applicationId)
      .eq("institution_id", ctx.institution.id)
      .eq("status", "submitted")
      .select("id");
    if (error) throwMapped(error);
    if ((data ?? []).length === 0) throw new AppError("invalid_state", "Application is no longer submitted.");

    await audit(ctx, {
      action: "admissions.application.start_review",
      entityType: "application",
      entityId: input.applicationId,
      before: { status: "submitted" },
      after: { status: "under_review" },
    });

    revalidatePath(`/${ctx.institution.slug}/admissions/applications/${input.applicationId}`);
    return { applicationId: input.applicationId, status: "under_review" };
  },
});

export const enrolApplicant = defineAction({
  name: "admissions.enrol",
  schema: EnrolApplicantSchema,
  module: "admissions",
  permission: "admissions.enrol",
  handler: async (input: EnrolApplicantInput, ctx: TenantContext) => {
    const supabase = await createClient();

    // CLAUDE.md rule 1: re-verify applicationId/classSectionId name a row in
    // ctx.institution before calling the RPC. feeStructureId is deliberately
    // NOT pre-checked the same way: fee_structures_select RLS
    // (20261028000008) is app.finance_roles() = owner/principal/admin/
    // accountant, which excludes "admissions" — the very role 07 §2.2 grants
    // admissions.enrol to. A pre-check with the caller's RLS-scoped client
    // would 404 every admissions-role enrolment, breaking J-05. The RPC's
    // own `exists(select ... fee_structures ...)` check is SECURITY DEFINER
    // (bypasses RLS) and already returns a safe `validation_failed` for a
    // foreign/mismatched id — reported in the completion report as an RLS
    // finding for the lead, not fixed here (migrations are out of scope).
    const [applicationCheck, sectionCheck] = await Promise.all([
      supabase.from("applications").select("id").eq("id", input.applicationId).eq("institution_id", ctx.institution.id).maybeSingle(),
      supabase.from("class_sections").select("id").eq("id", input.classSectionId).eq("institution_id", ctx.institution.id).maybeSingle(),
    ]);
    if (applicationCheck.error) throwMapped(applicationCheck.error);
    if (sectionCheck.error) throwMapped(sectionCheck.error);
    if (!applicationCheck.data) throw new AppError("not_found", "Application not found.");
    if (!sectionCheck.data) throw new AppError("not_found", "Class section not found.");

    const { data, error } = await supabase.rpc("enrol_applicant", {
      p_application_id: input.applicationId,
      p_class_section_id: input.classSectionId,
      p_fee_structure_id: input.feeStructureId,
      p_roll_no: (input.rollNo ?? null) as number,
    });
    if (error) {
      // Known gap (T-030, packet item 1): a roll_no collision inside
      // app.enrol_applicant hits enrolments_one_roll_no_per_section_idx
      // directly and raises a raw 23505, not a code:conflict — mapSqlError
      // would otherwise turn this into an opaque "internal" error. Reported
      // in the completion report as a SQL-side fix candidate; handled here
      // instead per the packet (no migration edits).
      if (error.code === "23505" && error.message.includes("roll_no")) {
        throw new AppError("conflict", "That roll number is already assigned in this section.");
      }
      throwMapped(error);
    }

    const result = asJsonRecord(data);
    const alreadyEnrolled = result.already_enrolled === true;
    const studentId = result.student_id as string;
    let invoiceId = (result.invoice_id as string | undefined) ?? null;
    if (alreadyEnrolled && !invoiceId && hasPermission(ctx, "finance.read")) {
      // The idempotent early-return branch of app.enrol_applicant doesn't
      // carry the invoice id (it never re-reads fee_assignments/invoices) —
      // best-effort fill from the student's first invoice for the links in
      // the dialog's success state. Gated on finance.read: invoices_select
      // RLS (20261028000008) excludes "admissions" (admissions.enrol's own
      // role), so the fetch would just come back empty for that caller —
      // skip it rather than spend a round trip on a read we know RLS denies.
      const invoices = await listInvoicesForStudent(ctx, studentId);
      invoiceId = invoices[0]?.id ?? null;
    }

    revalidatePath(`/${ctx.institution.slug}/admissions/applications/${input.applicationId}`);
    revalidatePath(`/${ctx.institution.slug}/students`);

    return {
      studentId,
      admissionNo: result.admission_no as string,
      invoiceId,
      alreadyEnrolled,
    };
  },
});
