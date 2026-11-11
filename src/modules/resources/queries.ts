import "server-only";
// Resources reads. RLS (0131): managers all; teacher published + own; student/guardian published for
// their own sections. institution_id filters are defense in depth.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { listSectionOptions, type SectionOption } from "@/modules/exams/queries";
import type { ResourceBrowseInput } from "./schemas";

const LIST_CAP = 300;
const SUMMARY_CAP = 5000;
const COLUMNS =
  "id, title, kind, url, document_id, subject_id, description, published, created_by, subjects(name), curriculum_units(title), resource_sections(class_section_id), documents(file_name)";

export interface ResourceRow {
  id: string;
  title: string;
  kind: "link" | "file" | "video" | "note";
  url: string | null;
  documentId: string | null;
  fileName: string | null;
  subjectId: string;
  subjectName: string;
  unitTitle: string | null;
  description: string | null;
  published: boolean;
  mine: boolean;
  sectionIds: string[];
}

type Raw = {
  id: string;
  title: string;
  kind: string;
  url: string | null;
  document_id: string | null;
  subject_id: string;
  description: string | null;
  published: boolean;
  created_by: string;
  subjects: unknown;
  curriculum_units: unknown;
  resource_sections: unknown;
  documents: unknown;
};

function toRow(r: Raw, ctx: TenantContext): ResourceRow {
  return {
    id: r.id,
    title: r.title,
    kind: r.kind as ResourceRow["kind"],
    url: r.url,
    documentId: r.document_id,
    fileName: (r.documents as { file_name: string } | null)?.file_name ?? null,
    subjectId: r.subject_id,
    subjectName: (r.subjects as { name: string } | null)?.name ?? "Subject",
    unitTitle: (r.curriculum_units as { title: string } | null)?.title ?? null,
    description: r.description,
    published: r.published,
    mine: r.created_by === ctx.user.id,
    sectionIds: ((r.resource_sections as { class_section_id: string }[] | null) ?? []).map((s) => s.class_section_id),
  };
}

/** Resources the caller created, every state, newest first. */
export async function listMyResources(ctx: TenantContext): Promise<ResourceRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("resources")
    .select(COLUMNS)
    .eq("institution_id", ctx.institution.id)
    .eq("created_by", ctx.user.id)
    .order("created_at", { ascending: false })
    .limit(LIST_CAP);
  if (error) throw error;
  return (data ?? []).map((r) => toRow(r as Raw, ctx));
}

/** Everything the caller may read (managers: drafts too; others: published + own), optionally one subject. */
export async function browseResources(ctx: TenantContext, input: ResourceBrowseInput = {}): Promise<ResourceRow[]> {
  const supabase = await createClient();
  let q = supabase.from("resources").select(COLUMNS).eq("institution_id", ctx.institution.id).order("created_at", { ascending: false }).limit(LIST_CAP);
  if (input.subjectId) q = q.eq("subject_id", input.subjectId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => toRow(r as Raw, ctx));
}

/** Published resources addressed to one child's active section(s). RLS already limits guardians to their own children's sections. */
export async function portalResources(ctx: TenantContext, studentId: string): Promise<ResourceRow[]> {
  const supabase = await createClient();
  const { data: enrol, error: eError } = await supabase
    .from("enrolments")
    .select("class_section_id")
    .eq("institution_id", ctx.institution.id)
    .eq("student_id", studentId)
    .eq("status", "active");
  if (eError) throw eError;
  const sectionIds = (enrol ?? []).map((e) => e.class_section_id);
  if (sectionIds.length === 0) return [];
  const { data, error } = await supabase
    .from("resources")
    .select(`${COLUMNS}, audience:resource_sections!inner(class_section_id)`)
    .eq("institution_id", ctx.institution.id)
    .eq("published", true)
    .in("audience.class_section_id", sectionIds)
    .order("created_at", { ascending: false })
    .limit(LIST_CAP);
  if (error) throw error;
  return (data ?? []).map((r) => toRow(r as unknown as Raw, ctx));
}

export interface ResourceSummary {
  bySubject: { subject: string; count: number }[];
  total: number;
}

/** Name-free aggregate: published resource counts by subject. Capped scan. */
export async function resourceSummary(ctx: TenantContext): Promise<ResourceSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("resources")
    .select("subjects(name)")
    .eq("institution_id", ctx.institution.id)
    .eq("published", true)
    .limit(SUMMARY_CAP);
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const r of data ?? []) {
    const name = (r.subjects as { name: string } | null)?.name ?? "Subject";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return { bySubject: [...counts].map(([subject, count]) => ({ subject, count })).sort((a, b) => b.count - a.count), total: data?.length ?? 0 };
}

/** Sections the caller may address: managers every section; a teacher the sections they teach (class teacher or subject assignment). */
export async function listAudienceSections(ctx: TenantContext): Promise<SectionOption[]> {
  const all = await listSectionOptions(ctx);
  if (ctx.membership.role !== "teacher") return all;
  if (!ctx.membership.staffId) return [];
  const supabase = await createClient();
  const [{ data: cls, error: cError }, { data: sub, error: sError }] = await Promise.all([
    supabase.from("class_sections").select("id").eq("institution_id", ctx.institution.id).eq("class_teacher_id", ctx.membership.staffId),
    supabase.from("subject_assignments").select("class_section_id").eq("institution_id", ctx.institution.id).eq("teacher_id", ctx.membership.staffId),
  ]);
  if (cError) throw cError;
  if (sError) throw sError;
  const taught = new Set([...(cls ?? []).map((c) => c.id), ...(sub ?? []).map((s) => s.class_section_id)]);
  return all.filter((s) => taught.has(s.id));
}

export interface UnitOption {
  id: string;
  subjectId: string;
  label: string;
}

/** Curriculum units for the optional unit picker (the page filters by chosen subject). */
export async function listUnitOptions(ctx: TenantContext): Promise<UnitOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("curriculum_units")
    .select("id, subject_id, title, grades(code)")
    .eq("institution_id", ctx.institution.id)
    .order("sequence")
    .limit(LIST_CAP);
  if (error) throw error;
  return (data ?? []).map((u) => ({ id: u.id, subjectId: u.subject_id, label: `${(u.grades as { code: string } | null)?.code ?? "?"}: ${u.title}` }));
}
