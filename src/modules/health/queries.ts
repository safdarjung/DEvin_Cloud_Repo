import "server-only";
// health.* reads — always the signed-in user's RLS client. Guardians see only
// their own child's rows (RLS), staff health.read roles see the school.
// Row-level clinical data: none of these is a cloud-safe aggregate (SPEC §E).
import type { TenantContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";

const VISIT_LIMIT = 100;

export interface HealthStudentOption {
  id: string;
  label: string;
}
export interface HealthProfile {
  id: string;
  bloodGroup: string | null;
  allergies: string | null;
  conditions: string | null;
  emergencyNote: string | null;
}
export interface HealthVisit {
  id: string;
  studentId: string;
  studentName: string;
  visitedAt: string;
  complaint: string;
  treatment: string | null;
  outcome: string;
}
export interface HealthVaccination {
  id: string;
  vaccine: string;
  dose: string | null;
  administeredOn: string;
  notes: string | null;
}

export async function healthStudentOptions(ctx: TenantContext): Promise<HealthStudentOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("students")
    .select("id, first_name, last_name, admission_no")
    .eq("institution_id", ctx.institution.id)
    .eq("status", "active")
    .order("first_name");
  if (error) throw error;
  return (data ?? []).map((s) => ({ id: s.id, label: `${[s.first_name, s.last_name].filter(Boolean).join(" ")} (${s.admission_no})` }));
}

export async function healthProfile(ctx: TenantContext, studentId: string): Promise<HealthProfile | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("health_profiles")
    .select("id, blood_group, allergies, conditions, emergency_note")
    .eq("institution_id", ctx.institution.id)
    .eq("student_id", studentId)
    .maybeSingle();
  if (error) throw error;
  return data && { id: data.id, bloodGroup: data.blood_group, allergies: data.allergies, conditions: data.conditions, emergencyNote: data.emergency_note };
}

/** One student's visits (newest first), or the school's latest visits when `studentId` is omitted. */
export async function healthVisits(ctx: TenantContext, studentId?: string): Promise<HealthVisit[]> {
  const supabase = await createClient();
  let q = supabase
    .from("health_visits")
    .select("id, student_id, visited_at, complaint, treatment, outcome, students(first_name, last_name)")
    .eq("institution_id", ctx.institution.id)
    .order("visited_at", { ascending: false })
    .limit(VISIT_LIMIT);
  if (studentId) q = q.eq("student_id", studentId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((v) => ({
    id: v.id,
    studentId: v.student_id,
    studentName: [v.students?.first_name, v.students?.last_name].filter(Boolean).join(" "),
    visitedAt: v.visited_at,
    complaint: v.complaint,
    treatment: v.treatment,
    outcome: v.outcome,
  }));
}

export async function healthVaccinations(ctx: TenantContext, studentId: string): Promise<HealthVaccination[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vaccinations")
    .select("id, vaccine, dose, administered_on, notes")
    .eq("institution_id", ctx.institution.id)
    .eq("student_id", studentId)
    .order("administered_on", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((v) => ({ id: v.id, vaccine: v.vaccine, dose: v.dose, administeredOn: v.administered_on, notes: v.notes }));
}
