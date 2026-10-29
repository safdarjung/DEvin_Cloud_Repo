import "server-only";
// T-027 — admissions module reads (06 §W4). Always the signed-in user's RLS
// client (CLAUDE.md); RLS (0007) already scopes enquiries/applications to
// owner/principal/admin/admissions.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { DEFAULT_ENQUIRY_STAGES, type ApplicationStatus, type EnquiryStage } from "./state";

export interface EnquiryNote {
  author: string | null;
  at: string | null;
  text: string;
}

export interface EnquiryRow {
  id: string;
  childName: string;
  guardianName: string;
  phone: string;
  email: string | null;
  gradeAppliedId: string | null;
  status: EnquiryStage;
  assignedTo: string | null;
  source: string;
  notes: EnquiryNote[];
  createdAt: string;
}

/** `enquiries.notes` can be the pipeline's append-only array (app.add_enquiry_note) OR app.submit_public_enquiry's (0007) single `{"message": ...}` object — never trust the shape. */
function normalizeNotes(raw: unknown): EnquiryNote[] {
  if (raw == null) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .filter((n): n is Record<string, unknown> => typeof n === "object" && n !== null)
    .map((n) => ({
      author: typeof n.author === "string" ? n.author : null,
      at: typeof n.at === "string" ? n.at : null,
      text: typeof n.text === "string" ? n.text : typeof n.message === "string" ? n.message : "",
    }));
}

const ENQUIRY_COLUMNS = "id, child_name, guardian_name, phone, email, grade_applied_id, status, assigned_to, source, notes, created_at";

interface EnquiryQueryRow {
  id: string;
  child_name: string;
  guardian_name: string;
  phone: string;
  email: string | null;
  grade_applied_id: string | null;
  status: string;
  assigned_to: string | null;
  source: string;
  notes: unknown;
  created_at: string;
}

function toEnquiryRow(row: EnquiryQueryRow): EnquiryRow {
  return {
    id: row.id,
    childName: row.child_name,
    guardianName: row.guardian_name,
    phone: row.phone,
    email: row.email,
    gradeAppliedId: row.grade_applied_id,
    status: row.status,
    assignedTo: row.assigned_to,
    source: row.source,
    notes: normalizeNotes(row.notes),
    createdAt: row.created_at,
  };
}

/** Pipeline board (06 §W4 AC1), grouped by the institution's configured stages. */
export async function listEnquiriesByStage(ctx: TenantContext): Promise<Record<EnquiryStage, EnquiryRow[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("enquiries")
    .select(ENQUIRY_COLUMNS)
    .eq("institution_id", ctx.institution.id)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const stages = enquiryStagesFor(ctx);
  const byStage: Record<EnquiryStage, EnquiryRow[]> = {};
  for (const stage of stages) byStage[stage] = [];

  for (const row of (data ?? []) as EnquiryQueryRow[]) {
    const parsed = toEnquiryRow(row);
    (byStage[parsed.status] ??= []).push(parsed);
  }
  return byStage;
}

export async function getEnquiry(ctx: TenantContext, enquiryId: string): Promise<EnquiryRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("enquiries")
    .select(ENQUIRY_COLUMNS)
    .eq("id", enquiryId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (error) throw error;
  return data ? toEnquiryRow(data as EnquiryQueryRow) : null;
}

/** `settings.admissions.stages`, or the shipped default order if settings don't parse (same fallback style as attendance's getAttendanceSettings). */
export function enquiryStagesFor(ctx: TenantContext): string[] {
  const raw = (ctx.institution.settings as { admissions?: { stages?: unknown } } | null)?.admissions?.stages;
  if (Array.isArray(raw) && raw.every((s) => typeof s === "string") && raw.length > 0) {
    return raw as string[];
  }
  return [...DEFAULT_ENQUIRY_STAGES];
}

export interface ApplicationRow {
  id: string;
  applicationNo: string;
  enquiryId: string | null;
  applicant: Record<string, unknown>;
  guardian: Record<string, unknown>;
  gradeAppliedId: string;
  academicYearId: string;
  status: ApplicationStatus;
  createdAt: string;
}

const APPLICATION_COLUMNS = "id, application_no, enquiry_id, applicant, guardian, grade_applied_id, academic_year_id, status, created_at";

interface ApplicationQueryRow {
  id: string;
  application_no: string;
  enquiry_id: string | null;
  applicant: unknown;
  guardian: unknown;
  grade_applied_id: string;
  academic_year_id: string;
  status: string;
  created_at: string;
}

function toApplicationRow(row: ApplicationQueryRow): ApplicationRow {
  return {
    id: row.id,
    applicationNo: row.application_no,
    enquiryId: row.enquiry_id,
    applicant: (row.applicant as Record<string, unknown>) ?? {},
    guardian: (row.guardian as Record<string, unknown>) ?? {},
    gradeAppliedId: row.grade_applied_id,
    academicYearId: row.academic_year_id,
    status: row.status as ApplicationStatus,
    createdAt: row.created_at,
  };
}

export async function listApplications(ctx: TenantContext, status?: ApplicationStatus): Promise<ApplicationRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("applications")
    .select(APPLICATION_COLUMNS)
    .eq("institution_id", ctx.institution.id)
    .order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as ApplicationQueryRow[]).map(toApplicationRow);
}

export async function getApplication(ctx: TenantContext, applicationId: string): Promise<ApplicationRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("applications")
    .select(APPLICATION_COLUMNS)
    .eq("id", applicationId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (error) throw error;
  return data ? toApplicationRow(data as ApplicationQueryRow) : null;
}

export interface ApplicationDecisionRow {
  id: string;
  decision: string;
  decidedBy: string | null;
  note: string | null;
  createdAt: string;
}

/** Decision timeline for ApplicationDetail/DecisionTimeline (06 §W4 AC3). */
export async function listApplicationDecisions(ctx: TenantContext, applicationId: string): Promise<ApplicationDecisionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("application_decisions")
    .select("id, decision, decided_by, note, created_at")
    .eq("institution_id", ctx.institution.id)
    .eq("application_id", applicationId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    decision: r.decision as string,
    decidedBy: r.decided_by as string | null,
    note: r.note as string | null,
    createdAt: r.created_at as string,
  }));
}

export interface SectionCapacityOption {
  id: string;
  name: string;
  gradeId: string;
  capacity: number | null;
  active: number;
}

// T-028 — sections for the EnrolDialog's picker (06 §W4 preconditions: "a
// class section for the applied grade in the current year with free
// capacity"). Reads class_sections/enrolments directly (academics module
// has no shared query for this yet) — read-only, no academics/** files
// touched.
export async function listSectionsForGrade(
  ctx: TenantContext,
  gradeId: string,
  academicYearId: string,
): Promise<SectionCapacityOption[]> {
  const supabase = await createClient();
  const { data: sections, error } = await supabase
    .from("class_sections")
    .select("id, name, grade_id, capacity")
    .eq("institution_id", ctx.institution.id)
    .eq("grade_id", gradeId)
    .eq("academic_year_id", academicYearId)
    .order("name");
  if (error) throw error;
  if (!sections || sections.length === 0) return [];

  const { data: enrolments, error: enrolError } = await supabase
    .from("enrolments")
    .select("class_section_id")
    .eq("institution_id", ctx.institution.id)
    .eq("status", "active")
    .in(
      "class_section_id",
      sections.map((s) => s.id),
    );
  if (enrolError) throw enrolError;

  const activeCounts = new Map<string, number>();
  for (const row of enrolments ?? []) {
    activeCounts.set(row.class_section_id, (activeCounts.get(row.class_section_id) ?? 0) + 1);
  }

  return sections.map((s) => ({
    id: s.id,
    name: s.name,
    gradeId: s.grade_id,
    capacity: s.capacity,
    active: activeCounts.get(s.id) ?? 0,
  }));
}

export interface AdmissionsFunnelCounts {
  enquiryStages: Record<string, number>;
  applicationStatuses: Record<ApplicationStatus, number>;
}

const APPLICATION_STATUSES: readonly ApplicationStatus[] = [
  "submitted",
  "under_review",
  "interaction_scheduled",
  "offered",
  "accepted",
  "rejected",
  "withdrawn",
  "enrolled",
];

/** 06 §W4 AC4 — live counts per enquiry stage and application status. Exported for T-039 (dashboard). */
export async function getAdmissionsFunnelCounts(ctx: TenantContext, academicYearId?: string): Promise<AdmissionsFunnelCounts> {
  const supabase = await createClient();

  const { data: enquiries, error: enquiryError } = await supabase
    .from("enquiries")
    .select("status")
    .eq("institution_id", ctx.institution.id);
  if (enquiryError) throw enquiryError;

  let appQuery = supabase.from("applications").select("status").eq("institution_id", ctx.institution.id);
  if (academicYearId) appQuery = appQuery.eq("academic_year_id", academicYearId);
  const { data: applications, error: applicationError } = await appQuery;
  if (applicationError) throw applicationError;

  const enquiryStages: Record<string, number> = {};
  for (const stage of enquiryStagesFor(ctx)) enquiryStages[stage] = 0;
  for (const row of enquiries ?? []) {
    const stage = row.status as string;
    enquiryStages[stage] = (enquiryStages[stage] ?? 0) + 1;
  }

  const applicationStatuses = Object.fromEntries(APPLICATION_STATUSES.map((s) => [s, 0])) as Record<ApplicationStatus, number>;
  for (const row of applications ?? []) {
    const status = row.status as ApplicationStatus;
    if (status in applicationStatuses) applicationStatuses[status] += 1;
  }

  return { enquiryStages, applicationStatuses };
}
