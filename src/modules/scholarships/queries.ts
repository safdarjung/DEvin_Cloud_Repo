import "server-only";
// Features-18 #9 — scholarships reads (migration 0118). Always the signed-in
// user's RLS client: both tables are visible only to concession.read holders
// (owner, principal, admin, accountant). The institution_id filters below are
// defense in depth. Student/grade names come through the students embed (RLS
// on students applies), the house pattern (visitors/queries.ts).
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { AWARDS_PAGE_SIZE, type AWARD_STATUSES, type ConcessionAwardListInput } from "./schemas";

type AwardStatus = (typeof AWARD_STATUSES)[number];

export interface ConcessionRuleRow {
  id: string;
  name: string;
  criteria: string | null;
  percent: number | null;
  amountPaise: number | null;
  isActive: boolean;
}

/** Rules by name; active only unless includeInactive. */
export async function concessionRules(ctx: TenantContext, { includeInactive = false }: { includeInactive?: boolean } = {}): Promise<ConcessionRuleRow[]> {
  const supabase = await createClient();
  let builder = supabase
    .from("concession_rules")
    .select("id, name, criteria, percent, amount_paise, is_active")
    .eq("institution_id", ctx.institution.id)
    .order("name");
  if (!includeInactive) builder = builder.eq("is_active", true);
  const { data, error } = await builder;
  if (error) throw error;
  return data.map((r) => ({
    id: r.id,
    name: r.name,
    criteria: r.criteria,
    percent: r.percent == null ? null : Number(r.percent),
    amountPaise: r.amount_paise == null ? null : Number(r.amount_paise),
    isActive: r.is_active,
  }));
}

interface EnrolmentEmbed {
  status: string;
  class_sections: { name: string; grades: { display_name: string; sort_key: number } | null } | null;
}

interface StudentEmbed {
  first_name: string;
  last_name: string | null;
  admission_no: string;
  enrolments: EnrolmentEmbed[] | null;
}

function activeGrade(student: { enrolments: EnrolmentEmbed[] | null } | null): { name: string; sortKey: number } | null {
  const grade = student?.enrolments?.find((e) => e.status === "active")?.class_sections?.grades;
  return grade ? { name: grade.display_name, sortKey: grade.sort_key } : null;
}

export interface ConcessionAwardRow {
  id: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  gradeName: string | null;
  ruleName: string | null;
  percent: number | null;
  amountPaise: number | null;
  reason: string;
  status: AwardStatus;
  requestedBy: string;
  requestedByName: string | null;
  requestedAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface ConcessionAwardPage {
  awards: ConcessionAwardRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** Awards newest first, optionally by status, 25 per page. Carries student names. */
export async function concessionAwards(ctx: TenantContext, { status, page = 1 }: ConcessionAwardListInput = {}): Promise<ConcessionAwardPage> {
  const supabase = await createClient();
  const from = (page - 1) * AWARDS_PAGE_SIZE;
  let builder = supabase
    .from("concession_awards")
    .select(
      "id, student_id, percent, amount_paise, reason, status, requested_by, created_at, decided_at, decision_note, " +
        "rule:concession_rules!concession_awards_rule_fk(name), " +
        "requester:profiles!concession_awards_requested_by_fkey(full_name), decider:profiles!concession_awards_decided_by_fkey(full_name), " +
        "students(first_name, last_name, admission_no, enrolments(status, class_sections(name, grades(display_name, sort_key))))",
      { count: "exact" },
    )
    .eq("institution_id", ctx.institution.id)
    .order("created_at", { ascending: false })
    .range(from, from + AWARDS_PAGE_SIZE - 1);
  if (status) builder = builder.eq("status", status);
  const { data, error, count } = await builder;
  if (error) throw error;

  type Row = {
    id: string;
    student_id: string;
    percent: number | null;
    amount_paise: number | null;
    reason: string;
    status: AwardStatus;
    requested_by: string;
    created_at: string;
    decided_at: string | null;
    decision_note: string | null;
    rule: { name: string } | null;
    requester: { full_name: string | null } | null;
    decider: { full_name: string | null } | null;
    students: StudentEmbed | null;
  };
  const awards = (data as unknown as Row[]).map((r) => ({
    id: r.id,
    studentId: r.student_id,
    studentName: r.students ? [r.students.first_name, r.students.last_name].filter(Boolean).join(" ") : "Unknown student",
    admissionNo: r.students?.admission_no ?? "",
    gradeName: activeGrade(r.students)?.name ?? null,
    ruleName: r.rule?.name ?? null,
    percent: r.percent == null ? null : Number(r.percent),
    amountPaise: r.amount_paise == null ? null : Number(r.amount_paise),
    reason: r.reason,
    status: r.status,
    requestedBy: r.requested_by,
    requestedByName: r.requester?.full_name ?? null,
    requestedAt: r.created_at,
    decidedByName: r.decider?.full_name ?? null,
    decidedAt: r.decided_at,
    decisionNote: r.decision_note,
  }));
  return { awards, total: count ?? 0, page, pageSize: AWARDS_PAGE_SIZE };
}

export interface ConcessionValueRow {
  label: string;
  approvedCount: number;
  /** Sum of fixed-amount awards. Percent awards have no rupee value until applied to a fee. */
  amountPaise: number;
  percentCount: number;
  averagePercent: number | null;
}

export interface ConcessionSummary {
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  byRule: ConcessionValueRow[];
  byGrade: ConcessionValueRow[];
}

type Bucket = { label: string; sort: number | string; count: number; amount: number; percentCount: number; percentSum: number };

function addTo(buckets: Map<string, Bucket>, label: string, sort: number | string, percent: number | null, amountPaise: number | null): void {
  const b = buckets.get(label) ?? { label, sort, count: 0, amount: 0, percentCount: 0, percentSum: 0 };
  b.count += 1;
  if (percent != null) {
    b.percentCount += 1;
    b.percentSum += percent;
  } else {
    b.amount += amountPaise ?? 0;
  }
  buckets.set(label, b);
}

function toRows(buckets: Map<string, Bucket>): ConcessionValueRow[] {
  return [...buckets.values()]
    .sort((x, y) => (x.sort < y.sort ? -1 : x.sort > y.sort ? 1 : 0))
    .map((b) => ({
      label: b.label,
      approvedCount: b.count,
      amountPaise: b.amount,
      percentCount: b.percentCount,
      averagePercent: b.percentCount ? Math.round((b.percentSum / b.percentCount) * 100) / 100 : null,
    }));
}

/** Name-free aggregate: status counts, and approved awards by rule and by grade. */
export async function concessionSummary(ctx: TenantContext): Promise<ConcessionSummary> {
  const supabase = await createClient();
  const countOf = (status: AwardStatus) =>
    supabase.from("concession_awards").select("id", { count: "exact", head: true }).eq("institution_id", ctx.institution.id).eq("status", status);
  // shortcut: reads approved rows (PostgREST max_rows 1000); a school past 1000 approved awards in view needs a SQL sum function.
  const [pendingR, approvedR, rejectedR, rowsR] = await Promise.all([
    countOf("pending"),
    countOf("approved"),
    countOf("rejected"),
    supabase
      .from("concession_awards")
      .select(
        "percent, amount_paise, rule:concession_rules!concession_awards_rule_fk(name), students(enrolments(status, class_sections(name, grades(display_name, sort_key))))",
      )
      .eq("institution_id", ctx.institution.id)
      .eq("status", "approved"),
  ]);
  for (const r of [pendingR, approvedR, rejectedR, rowsR]) if (r.error) throw r.error;

  type Row = { percent: number | null; amount_paise: number | null; rule: { name: string } | null; students: { enrolments: EnrolmentEmbed[] | null } | null };
  const byRule = new Map<string, Bucket>();
  const byGrade = new Map<string, Bucket>();
  for (const r of (rowsR.data ?? []) as unknown as Row[]) {
    const percent = r.percent == null ? null : Number(r.percent);
    const amount = r.amount_paise == null ? null : Number(r.amount_paise);
    const ruleName = r.rule?.name ?? "No rule";
    addTo(byRule, ruleName, ruleName, percent, amount);
    const grade = activeGrade(r.students);
    addTo(byGrade, grade?.name ?? "No current class", grade?.sortKey ?? Number.MAX_SAFE_INTEGER, percent, amount);
  }

  return {
    pendingCount: pendingR.count ?? 0,
    approvedCount: approvedR.count ?? 0,
    rejectedCount: rejectedR.count ?? 0,
    byRule: toRows(byRule),
    byGrade: toRows(byGrade),
  };
}
