import "server-only";
// Alumni reads. Profiles hold only alumni fields; names/admission no come from the
// people-owned `students` row via an FK embed (never copied). RLS (0123) scopes rows;
// the page/query gate (alumni.read) is narrower than the migration's read set.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { ALUMNI_PAGE_SIZE, type AlumniListInput } from "./schemas";

export interface AlumniRow {
  id: string;
  studentId: string;
  admissionNo: string;
  name: string;
  batchYear: number;
  contactEmail: string | null;
  contactPhone: string | null;
  occupation: string | null;
  city: string | null;
}

export interface AlumniPage {
  rows: AlumniRow[];
  total: number;
  page: number;
  pageSize: number;
}

function escapeIlike(v: string): string {
  return v.replace(/[\\%_]/g, (c) => `\\${c}`);
}
function quote(v: string): string {
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Paginated directory; search matches name or admission no; filters by batch year and city. */
export async function listAlumni(ctx: TenantContext, input: AlumniListInput = {}): Promise<AlumniPage> {
  const supabase = await createClient();
  const page = Math.max(1, input.page ?? 1);
  const from = (page - 1) * ALUMNI_PAGE_SIZE;
  let b = supabase
    .from("alumni_profiles")
    .select("id, student_id, batch_year, contact_email, contact_phone, occupation, city, students!inner(admission_no, first_name, last_name)", { count: "exact" })
    .eq("institution_id", ctx.institution.id)
    .order("batch_year", { ascending: false })
    .order("created_at", { ascending: true })
    .range(from, from + ALUMNI_PAGE_SIZE - 1);
  if (input.batchYear) b = b.eq("batch_year", input.batchYear);
  if (input.city) b = b.eq("city", input.city);
  if (input.q) {
    const t = quote(`%${escapeIlike(input.q)}%`);
    b = b.or(`admission_no.ilike.${t},first_name.ilike.${t},last_name.ilike.${t}`, { referencedTable: "students" });
  }
  const { data, error, count } = await b;
  if (error) throw error;
  const rows = (data ?? []).map((r) => {
    const s = r.students as unknown as { admission_no: string; first_name: string; last_name: string | null };
    return {
      id: r.id,
      studentId: r.student_id,
      admissionNo: s.admission_no,
      name: [s.first_name, s.last_name].filter(Boolean).join(" "),
      batchYear: r.batch_year,
      contactEmail: r.contact_email,
      contactPhone: r.contact_phone,
      occupation: r.occupation,
      city: r.city,
    };
  });
  return { rows, total: count ?? 0, page, pageSize: ALUMNI_PAGE_SIZE };
}

export interface AlumniFacets {
  batches: { batchYear: number; count: number }[];
  cities: string[];
}

/** Name-free aggregate: alumni count per batch year plus the distinct city list (filter options). */
export async function alumniFacets(ctx: TenantContext): Promise<AlumniFacets> {
  const supabase = await createClient();
  // shortcut: bounded read, grouped in JS; upgrade to a SQL group-by if a school passes 5000 alumni.
  const { data, error } = await supabase
    .from("alumni_profiles")
    .select("batch_year, city")
    .eq("institution_id", ctx.institution.id)
    .limit(5000);
  if (error) throw error;
  const counts = new Map<number, number>();
  const cities = new Set<string>();
  for (const r of data ?? []) {
    counts.set(r.batch_year, (counts.get(r.batch_year) ?? 0) + 1);
    if (r.city) cities.add(r.city);
  }
  return {
    batches: [...counts].map(([batchYear, count]) => ({ batchYear, count })).sort((a, b) => b.batchYear - a.batchYear),
    cities: [...cities].sort((a, b) => a.localeCompare(b)),
  };
}
