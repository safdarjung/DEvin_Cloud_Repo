import "server-only";
// M05-T4 — documents.listForEntity: active rows' metadata only (no path, no
// signed URL — reading bytes is always through document.getReadUrl, which
// audits). RLS (0067 documents_select) already narrows visibility; the
// explicit institution_id/status filters below are defense in depth, same
// shape as every other queries.ts in this codebase.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { humanize } from "@/lib/format";

export interface DocumentListItem {
  id: string;
  kind: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  createdAt: string;
}

export async function listDocumentsForEntity(
  ctx: TenantContext,
  entityType: string,
  entityId: string,
): Promise<DocumentListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .select("id, kind, file_name, mime, size_bytes, created_at")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("institution_id", ctx.institution.id)
    .eq("status", "active")
    .order("created_at", { ascending: false });
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    kind: row.kind,
    fileName: row.file_name,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  }));
}

export interface DocumentRow extends DocumentListItem {
  entityType: string;
  entityId: string;
  entityLabel: string;
}

export const DOCUMENTS_PAGE_SIZE = 25;

const escapeLike = (s: string) => s.replace(/[\\%_,()"]/g, " ").trim();

/** Institution-wide list of active documents the caller's RLS lets them read (metadata only). Page-bounded; `q` matches file name or kind. */
export async function listDocuments(
  ctx: TenantContext,
  opts: { entityType?: string; q?: string; page?: number },
): Promise<{ rows: DocumentRow[]; total: number; page: number }> {
  const supabase = await createClient();
  const page = Math.max(1, Math.floor(opts.page ?? 1) || 1);
  const from = (page - 1) * DOCUMENTS_PAGE_SIZE;
  let builder = supabase
    .from("documents")
    .select("id, kind, file_name, mime, size_bytes, created_at, entity_type, entity_id", { count: "exact" })
    .eq("institution_id", ctx.institution.id)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .range(from, from + DOCUMENTS_PAGE_SIZE - 1);
  if (opts.entityType) builder = builder.eq("entity_type", opts.entityType);
  const q = opts.q ? escapeLike(opts.q) : "";
  if (q) builder = builder.or(`file_name.ilike.%${q}%,kind.ilike.%${q}%`);
  const { data, error, count } = await builder;
  if (error) throw error;
  const docs = data ?? [];

  // Human labels for student/staff owners; other entity types show their short id.
  const ids = (t: string) => [...new Set(docs.filter((d) => d.entity_type === t).map((d) => d.entity_id))];
  const [students, staff] = await Promise.all([
    ids("student").length ? supabase.from("students").select("id, first_name, last_name, admission_no").in("id", ids("student")) : Promise.resolve({ data: [] }),
    ids("staff").length ? supabase.from("staff").select("id, full_name").in("id", ids("staff")) : Promise.resolve({ data: [] }),
  ]);
  const books = ids("subject_textbook").length ? await supabase.from("subject_textbooks").select("id, custom_title, ncert_textbooks(title)").in("id", ids("subject_textbook")) : { data: [] };
  const labels = new Map<string, string>();
  for (const b of books.data ?? []) {
    const title = b.custom_title ?? (b.ncert_textbooks as { title?: string } | null)?.title;
    if (title) labels.set(b.id, `Subject textbook: ${title}`);
  }
  for (const s of students.data ?? []) labels.set(s.id, `${s.first_name} ${s.last_name ?? ""} (${s.admission_no})`.replace("  ", " "));
  for (const s of staff.data ?? []) labels.set(s.id, s.full_name);

  return {
    page,
    total: count ?? 0,
    rows: docs.map((d) => ({
      id: d.id,
      kind: d.kind,
      fileName: d.file_name,
      mime: d.mime,
      sizeBytes: d.size_bytes,
      createdAt: d.created_at,
      entityType: d.entity_type,
      entityId: d.entity_id,
      entityLabel: labels.get(d.entity_id) ?? `${humanize(d.entity_type)} ${d.entity_id.slice(0, 8)}`,
    })),
  };
}

/** Owners a document can be uploaded for from this page: students (search) or staff. Capped at 20. */
export async function documentOwnerOptions(ctx: TenantContext, entityType: "student" | "staff", q: string): Promise<{ id: string; label: string }[]> {
  const supabase = await createClient();
  const term = escapeLike(q);
  if (entityType === "student") {
    let b = supabase.from("students").select("id, first_name, last_name, admission_no").eq("institution_id", ctx.institution.id).order("admission_no").limit(20);
    if (term) b = b.or(`admission_no.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%`);
    const { data, error } = await b;
    if (error) throw error;
    return (data ?? []).map((s) => ({ id: s.id, label: `${s.first_name} ${s.last_name ?? ""} (${s.admission_no})`.replace("  ", " ") }));
  }
  let b = supabase.from("staff").select("id, full_name").eq("institution_id", ctx.institution.id).order("full_name").limit(20);
  if (term) b = b.ilike("full_name", `%${term}%`);
  const { data, error } = await b;
  if (error) throw error;
  return (data ?? []).map((s) => ({ id: s.id, label: s.full_name }));
}
