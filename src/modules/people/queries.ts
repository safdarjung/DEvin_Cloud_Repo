import "server-only";
// T-028 — people module reads (06 §W4 step 5 profile, 07 §2.2 student.read,
// 05 §2.3 enrolments). Always the signed-in user's RLS client (CLAUDE.md);
// student.read is granted to teacher/student/guardian scoped ("s") by RLS,
// but /students itself is staff-only (page-level gate, see the students
// pages) — the same shape as attendance's per-section page guard.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";

const PAGE_SIZE = 50;

/** ILIKE treats `%`/`_` as wildcards — escape them so a search for "A_1" or "100%" doesn't become a pattern. */
function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Phase 2 review (MEDIUM): PostgREST's `.or()` filter string splits on `,`
 * and `(`/`)` — a value containing any of those (e.g. "Smith, John" or
 * "A(B)") broke the filter and 500'd. Per PostgREST's own quoting rule,
 * wrapping the value in double quotes makes everything inside literal;
 * `\` and `"` inside it must themselves be escaped first.
 */
function quoteOrValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export interface StudentListRow {
  id: string;
  admissionNo: string;
  firstName: string;
  lastName: string | null;
  status: string;
  gradeName: string | null;
  sectionName: string | null;
}

export interface StudentListPage {
  students: StudentListRow[];
  total: number;
  page: number;
  pageSize: number;
}

interface EnrolmentEmbed {
  status: string;
  class_sections: { name: string; grades: { display_name: string } | null } | null;
}

/** Paginated (packet rule: never unbounded), searches admission no or name. */
export async function listStudents(ctx: TenantContext, query: string | undefined, page: number): Promise<StudentListPage> {
  const supabase = await createClient();
  const safePage = Math.max(1, Math.floor(page) || 1);
  const from = (safePage - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let builder = supabase
    .from("students")
    .select(
      "id, admission_no, first_name, last_name, status, enrolments(status, class_sections(name, grades(display_name)))",
      { count: "exact" },
    )
    .eq("institution_id", ctx.institution.id)
    .order("admission_no", { ascending: true })
    .range(from, to);

  const trimmed = query?.trim();
  if (trimmed) {
    const term = quoteOrValue(`%${escapeIlike(trimmed)}%`);
    builder = builder.or(`admission_no.ilike.${term},first_name.ilike.${term},last_name.ilike.${term}`);
  }

  const { data, error, count } = await builder;
  if (error) throw error;

  const students = (data ?? []).map((row) => {
    const enrolments = (row.enrolments as EnrolmentEmbed[] | null) ?? [];
    const active = enrolments.find((e) => e.status === "active");
    return {
      id: row.id,
      admissionNo: row.admission_no,
      firstName: row.first_name,
      lastName: row.last_name,
      status: row.status,
      gradeName: active?.class_sections?.grades?.display_name ?? null,
      sectionName: active?.class_sections?.name ?? null,
    };
  });

  return { students, total: count ?? 0, page: safePage, pageSize: PAGE_SIZE };
}

export interface StudentEnrolment {
  id: string;
  classSectionId: string;
  sectionName: string;
  gradeName: string;
  rollNo: number | null;
  academicYearId: string;
  status: string;
}

export interface GuardianRow {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  relationship: string;
  isPrimary: boolean;
  hasPortalLogin: boolean;
}

export interface StudentProfile {
  id: string;
  admissionNo: string;
  firstName: string;
  lastName: string | null;
  dob: string;
  gender: string;
  status: string;
  enrolment: StudentEnrolment | null;
  guardians: GuardianRow[];
}

/** CLAUDE.md rule 1: caller passes studentId, we re-verify it names a row in ctx.institution — never trust it belongs there. */
export async function getStudentProfile(ctx: TenantContext, studentId: string): Promise<StudentProfile | null> {
  const supabase = await createClient();

  const { data: student, error } = await supabase
    .from("students")
    .select("id, admission_no, first_name, last_name, dob, gender, status")
    .eq("id", studentId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (error) throw error;
  if (!student) return null;

  const { data: enrolment, error: enrolError } = await supabase
    .from("enrolments")
    .select("id, class_section_id, roll_no, academic_year_id, status, class_sections(name, grades(display_name))")
    .eq("institution_id", ctx.institution.id)
    .eq("student_id", studentId)
    .eq("status", "active")
    .maybeSingle();
  if (enrolError) throw enrolError;

  const { data: guardianLinks, error: guardianError } = await supabase
    .from("guardian_students")
    .select("relationship, is_primary, guardians(id, full_name, phone, email, user_id)")
    .eq("institution_id", ctx.institution.id)
    .eq("student_id", studentId)
    .order("is_primary", { ascending: false });
  if (guardianError) throw guardianError;

  const section = (enrolment?.class_sections as { name: string; grades: { display_name: string } | null } | null) ?? null;

  return {
    id: student.id,
    admissionNo: student.admission_no,
    firstName: student.first_name,
    lastName: student.last_name,
    dob: student.dob,
    gender: student.gender,
    status: student.status,
    enrolment: enrolment
      ? {
          id: enrolment.id,
          classSectionId: enrolment.class_section_id,
          sectionName: section?.name ?? "",
          gradeName: section?.grades?.display_name ?? "",
          rollNo: enrolment.roll_no,
          academicYearId: enrolment.academic_year_id,
          status: enrolment.status,
        }
      : null,
    guardians: (guardianLinks ?? []).map((row) => {
      const g = row.guardians as
        | { id: string; full_name: string; phone: string; email: string | null; user_id: string | null }
        | null;
      return {
        id: g?.id ?? "",
        fullName: g?.full_name ?? "",
        phone: g?.phone ?? "",
        email: g?.email ?? null,
        relationship: row.relationship,
        isPrimary: row.is_primary,
        hasPortalLogin: g?.user_id != null,
      };
    }),
  };
}

/** The term to show attendance/invoices for: the one containing today, else the academic year's latest by sequence — same fallback as app.enrol_applicant's current-term pick (06 §W4). */
export async function getCurrentTermId(ctx: TenantContext, academicYearId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("terms")
    .select("id, starts_on, ends_on, sequence")
    .eq("institution_id", ctx.institution.id)
    .eq("academic_year_id", academicYearId)
    .order("sequence", { ascending: false });
  if (error) throw error;
  if (!data || data.length === 0) return null;

  const today = new Date().toISOString().slice(0, 10);
  const current = data.find((t) => t.starts_on <= today && today <= t.ends_on);
  return (current ?? data[0]).id;
}
