import "server-only";
// T-028 — people module reads (06 §W4 step 5 profile, 07 §2.2 student.read,
// 05 §2.3 enrolments). Always the signed-in user's RLS client (CLAUDE.md);
// student.read is granted to teacher/student/guardian scoped ("s") by RLS,
// but /students itself is staff-only (page-level gate, see the students
// pages) — the same shape as attendance's per-section page guard.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { InstitutionSettingsSchema } from "@/modules/core/schemas";
import { highestLevel, type QualLevel, type QualRules, type QualTeacher } from "./qualifications";
import { escapeIlike } from "@/lib/list-search";

const PAGE_SIZE = 50;


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

/** Optional list filters (validated by `StudentListFiltersSchema`); grade/section match the student's active enrolment. */
export interface StudentListFilters {
  gradeId?: string;
  sectionId?: string;
  status?: "active" | "alumni" | "withdrawn";
}

/** Paginated (packet rule: never unbounded), searches admission no or name, filters by grade/section/status. */
export async function listStudents(
  ctx: TenantContext,
  query: string | undefined,
  page: number,
  filters: StudentListFilters = {},
): Promise<StudentListPage> {
  const supabase = await createClient();
  const safePage = Math.max(1, Math.floor(page) || 1);
  const from = (safePage - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // Grade/section filters need an inner join on the active enrolment; without
  // them the plain embed keeps students who have no enrolment in the list.
  const byClass = Boolean(filters.gradeId || filters.sectionId);
  let builder = supabase
    .from("students")
    .select(
      byClass
        ? "id, admission_no, first_name, last_name, status, enrolments!inner(status, class_section_id, class_sections!inner(name, grade_id, grades(display_name)))"
        : "id, admission_no, first_name, last_name, status, enrolments(status, class_sections(name, grades(display_name)))",
      { count: "exact" },
    )
    .eq("institution_id", ctx.institution.id)
    // Current students first ("active" sorts before alumni/withdrawn), then by admission no.
    .order("status", { ascending: true })
    .order("admission_no", { ascending: true })
    .range(from, to);
  if (filters.status) builder = builder.eq("status", filters.status);
  if (byClass) builder = builder.eq("enrolments.status", "active");
  if (filters.sectionId) builder = builder.eq("enrolments.class_section_id", filters.sectionId);
  if (filters.gradeId) builder = builder.eq("enrolments.class_sections.grade_id", filters.gradeId);

  const trimmed = query?.trim();
  if (trimmed) {
    const term = quoteOrValue(`%${escapeIlike(trimmed)}%`);
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      // "Aarav Sharma": the single-term OR below only ever matches one of
      // first_name/last_name, never the pair together. and(...) nested
      // inside or(...) is valid PostgREST filter syntax (quoteOrValue
      // already guards each value against the `,`/`(`/`)` split).
      const first = quoteOrValue(`%${escapeIlike(words[0]!)}%`);
      const rest = quoteOrValue(`%${escapeIlike(words.slice(1).join(" "))}%`);
      builder = builder.or(
        `admission_no.ilike.${term},first_name.ilike.${term},last_name.ilike.${term},and(first_name.ilike.${first},last_name.ilike.${rest})`,
      );
    } else {
      builder = builder.or(`admission_no.ilike.${term},first_name.ilike.${term},last_name.ilike.${term}`);
    }
  }

  const { data, error, count } = await builder;
  // PGRST103: a page past the last one. An empty page, not an internal error.
  // shortcut: total is unknown here (0), upgrade with a head-only count if a UI pages past the end.
  if (error?.code === "PGRST103") return { students: [], total: 0, page: safePage, pageSize: PAGE_SIZE };
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

/**
 * Active students per class this academic year, and the school total ("how many students in 8A?").
 * Counts only. RLS limits the rows a teacher sees to their own sections.
 */
/** Roles that see every section's students (the enrolments RLS list); everyone else sees only their own sections. */
export const WHOLE_SCHOOL_ROLES: readonly string[] = ["owner", "principal", "admin", "admissions", "accountant", "exam_controller"];

/**
 * Active students per section this year as the caller can see them (RLS). For a teacher, sections they
 * cannot see are left out instead of reported as 0 ("no students in X-A" when X-A was not theirs).
 */
export async function visibleSectionCounts(ctx: TenantContext): Promise<Map<string, number>> {
  const supabase = await createClient();
  const { data: year, error: yearError } = await supabase.from("academic_years").select("id").eq("institution_id", ctx.institution.id).eq("is_current", true).maybeSingle();
  if (yearError) throw yearError;
  const counts = new Map<string, number>();
  if (!year) return counts;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("enrolments")
      .select("id, class_section_id")
      .eq("institution_id", ctx.institution.id)
      .eq("academic_year_id", year.id)
      .eq("status", "active")
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    for (const r of data ?? []) counts.set(r.class_section_id, (counts.get(r.class_section_id) ?? 0) + 1);
    if (!data || data.length < 1000) break;
  }
  return counts;
}

export async function enrolmentCounts(ctx: TenantContext): Promise<{ scope: string; totalActive: number; sections: { section: string; grade: string; students: number }[] }> {
  const supabase = await createClient();
  const whole = WHOLE_SCHOOL_ROLES.includes(ctx.membership.role);
  const scope = whole ? "whole school" : "only your own classes. A class not listed here is not yours: its records are hidden from you, not zero or empty. Say that.";
  const { data: year, error: yearError } = await supabase.from("academic_years").select("id").eq("institution_id", ctx.institution.id).eq("is_current", true).maybeSingle();
  if (yearError) throw yearError;
  if (!year) return { scope, totalActive: 0, sections: [] };
  const counts = await visibleSectionCounts(ctx);
  const { data: sections, error } = await supabase
    .from("class_sections")
    .select("id, name, grades(code, display_name, sort_key)")
    .eq("institution_id", ctx.institution.id)
    .eq("academic_year_id", year.id);
  if (error) throw error;
  type G = { code: string; display_name: string; sort_key: number } | null;
  const rows = (sections ?? [])
    .filter((s) => whole || counts.has(s.id))
    .map((s) => ({ g: s.grades as G, name: s.name, students: counts.get(s.id) ?? 0 }))
    .sort((a, b) => (a.g?.sort_key ?? 0) - (b.g?.sort_key ?? 0) || a.name.localeCompare(b.name))
    .map((r) => ({ section: `${r.g?.code ?? "?"}-${r.name}`, grade: r.g?.display_name ?? "", students: r.students }));
  return { scope, totalActive: [...counts.values()].reduce((a, b) => a + b, 0), sections: rows };
}

/** The term the person named, or the current one: today's term in the current academic year, else its latest. Null when no term is set up. */
export async function termIdOrCurrent(ctx: TenantContext, termId?: string): Promise<string | null> {
  if (termId) return termId;
  const supabase = await createClient();
  // Terms are readable by every member (0051); academic_years is staff-only, so a guardian or student finds today's term by date.
  const today = new Date().toISOString().slice(0, 10);
  const { data: term, error: termError } = await supabase
    .from("terms")
    .select("id")
    .eq("institution_id", ctx.institution.id)
    .lte("starts_on", today)
    .gte("ends_on", today)
    .order("starts_on", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (termError) throw termError;
  if (term) return term.id;
  const { data: year, error } = await supabase.from("academic_years").select("id").eq("institution_id", ctx.institution.id).eq("is_current", true).maybeSingle();
  if (error) throw error;
  return year ? getCurrentTermId(ctx, year.id) : null;
}

export interface ChildSummary {
  id: string;
  firstName: string;
  lastName: string | null;
  admissionNo: string;
  gradeName: string | null;
  sectionName: string | null;
}

interface ChildEnrolmentEmbed {
  status: string;
  class_sections: { name: string; grades: { display_name: string } | null } | null;
}

function toChildSummary(student: {
  id: string;
  admission_no: string;
  first_name: string;
  last_name: string | null;
  enrolments: ChildEnrolmentEmbed[] | null;
}): ChildSummary {
  const active = (student.enrolments ?? []).find((e) => e.status === "active");
  return {
    id: student.id,
    firstName: student.first_name,
    lastName: student.last_name,
    admissionNo: student.admission_no,
    gradeName: active?.class_sections?.grades?.display_name ?? null,
    sectionName: active?.class_sections?.name ?? null,
  };
}

/**
 * T-034 — guardian portal child list (05 §2.2 `guardian_students`). Lead
 * ruling DBT-24: `portal_access` gates *portal visibility only* — a
 * guardian with `portal_access = false` for a child still gets that
 * child's notifications and RLS still lets other scoped reads through; it
 * is only this list (and therefore the portal's child switcher) that
 * excludes them. Ordered by admission_no for a deterministic "first child".
 */
export async function listMyChildren(ctx: TenantContext): Promise<ChildSummary[]> {
  if (!ctx.membership.guardianId) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("guardian_students")
    .select(
      "students(id, admission_no, first_name, last_name, enrolments(status, class_sections(name, grades(display_name))))",
    )
    .eq("institution_id", ctx.institution.id)
    .eq("guardian_id", ctx.membership.guardianId)
    .eq("portal_access", true);
  if (error) throw error;

  return (data ?? [])
    .map((row) => row.students as Parameters<typeof toChildSummary>[0] | null)
    .filter((student): student is Parameters<typeof toChildSummary>[0] => student != null)
    .map(toChildSummary)
    .sort((a, b) => a.admissionNo.localeCompare(b.admissionNo));
}

/** T-034 — the student role's own record for the shared guardian/student portal UI (DBT-05). */
export async function getMyStudent(ctx: TenantContext): Promise<ChildSummary | null> {
  if (!ctx.membership.studentId) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("students")
    .select("id, admission_no, first_name, last_name, enrolments(status, class_sections(name, grades(display_name)))")
    .eq("id", ctx.membership.studentId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return toChildSummary(data as Parameters<typeof toChildSummary>[0]);
}

export interface StaffOption {
  id: string;
  fullName: string;
  designation: string;
}

/** Orb task bridge picker (people.searchStaff): active staff by name, at most 20, under the caller's RLS; `id` narrows to one row. */
export async function searchStaff(ctx: TenantContext, filter: { query?: string; id?: string }): Promise<StaffOption[]> {
  const supabase = await createClient();
  let builder = supabase
    .from("staff")
    .select("id, full_name, designation")
    .eq("institution_id", ctx.institution.id)
    .eq("status", "active")
    .order("full_name")
    .limit(20);
  if (filter.id) builder = builder.eq("id", filter.id);
  const trimmed = filter.query?.trim();
  if (trimmed) builder = builder.ilike("full_name", `%${escapeIlike(trimmed)}%`);
  const { data, error } = await builder;
  if (error) throw error;
  return (data ?? []).map((row) => ({ id: row.id, fullName: row.full_name, designation: row.designation }));
}

// ---- 0155: teaching profiles and qualifications --------------------------------------------------

export interface Qualification {
  level: QualLevel;
  degree: string;
  subject?: string;
  year?: number;
}

export interface MyTeacherProfile {
  staffId: string;
  fullName: string;
  qualifications: Qualification[];
  subjectIds: string[];
  gradeIds: string[];
  experienceYears: number | null;
  onboardedAt: string | null;
}

/** The signed-in staff member's own profile (through their membership), or null for a non-staff login. */
export async function getMyTeacherProfile(ctx: TenantContext): Promise<MyTeacherProfile | null> {
  if (!ctx.membership.staffId) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_teacher_profile", { p_institution_id: ctx.institution.id });
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  return {
    staffId: row.staff_id,
    fullName: row.full_name,
    qualifications: (row.qualifications as unknown as Qualification[]) ?? [],
    subjectIds: row.can_teach_subject_ids ?? [],
    gradeIds: row.can_teach_grade_ids ?? [],
    experienceYears: row.experience_years,
    onboardedAt: row.onboarded_at,
  };
}

export interface ClassOption {
  id: string;
  code: string;
  displayName: string;
  sortKey: number;
}

/** The school's classes (grades, in order) and subjects, for the profile form and the qualification page. */
export async function listClassesAndSubjects(ctx: TenantContext): Promise<{ grades: ClassOption[]; subjects: { id: string; name: string }[] }> {
  const supabase = await createClient();
  const [grades, subjects] = await Promise.all([
    supabase.from("grades").select("id, code, display_name, sort_key").eq("institution_id", ctx.institution.id).order("sort_key"),
    supabase.from("subjects").select("id, name").eq("institution_id", ctx.institution.id).order("name"),
  ]);
  if (grades.error) throw grades.error;
  if (subjects.error) throw subjects.error;
  return {
    grades: (grades.data ?? []).map((g) => ({ id: g.id, code: g.code, displayName: g.display_name, sortKey: g.sort_key })),
    subjects: subjects.data ?? [],
  };
}

/** The school's qualification rule (settings.staff.max_grade_by_level); missing levels use the defaults. */
export function qualificationRules(ctx: TenantContext): QualRules {
  const parsed = InstitutionSettingsSchema.shape.staff.safeParse(ctx.institution.settings.staff);
  return (parsed.success ? parsed.data?.max_grade_by_level : undefined) ?? {};
}

export interface TeacherQualificationRow extends QualTeacher {
  designation: string;
  degrees: string;
  subjectNames: string[];
  onboarded: boolean;
}

/** Every active teaching staff member with what they entered on their profile (office roles; staff_select RLS). */
export async function listTeacherQualifications(ctx: TenantContext, subjects: readonly { id: string; name: string }[]): Promise<TeacherQualificationRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staff")
    .select("id, full_name, designation, qualifications, can_teach_subject_ids, can_teach_grade_ids, experience_years, onboarded_at")
    .eq("institution_id", ctx.institution.id)
    .eq("is_teaching", true)
    .eq("status", "active")
    .order("full_name");
  if (error) throw error;
  const subjectName = new Map(subjects.map((s) => [s.id, s.name]));
  return (data ?? []).map((s) => {
    const quals = (s.qualifications as unknown as Qualification[]) ?? [];
    return {
      staffId: s.id,
      name: s.full_name,
      designation: s.designation,
      level: highestLevel(quals),
      degrees: quals.map((q) => (q.subject ? `${q.degree} (${q.subject})` : q.degree)).join(", "),
      gradeIds: s.can_teach_grade_ids ?? [],
      subjectNames: (s.can_teach_subject_ids ?? []).flatMap((id) => subjectName.get(id) ?? []),
      experienceYears: s.experience_years,
      onboarded: s.onboarded_at !== null,
    };
  });
}
