import "server-only";
// M05-T4 — documents.listForEntity: active rows' metadata only (no path, no
// signed URL — reading bytes is always through document.getReadUrl, which
// audits). RLS (0067 documents_select) already narrows visibility; the
// explicit institution_id/status filters below are defense in depth, same
// shape as every other queries.ts in this codebase.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";

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
