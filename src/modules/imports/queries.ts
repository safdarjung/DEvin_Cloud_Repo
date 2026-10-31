import "server-only";
// M04-T6 — imports.getBatch: batch counts/status + invalid rows (row_no,
// errors only — never `data`, which may hold guardian phone/email). RLS
// (0066 import_batches_select/import_rows_select) already narrows both
// tables to owner/principal/admin of the same institution; the explicit
// institution_id filter below is defense in depth, same shape as every
// other queries.ts in this codebase.
import { AppError } from "@/lib/actions/result";
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";

export interface ImportBatchInvalidRow {
  rowNo: number;
  errors: Record<string, string[]> | null;
}

export interface ImportBatchSummary {
  id: string;
  entityType: string;
  status: string;
  fileName: string;
  rowCount: number;
  validCount: number;
  errorCount: number;
  committedCount: number;
  skippedCount: number;
  invalidRows: ImportBatchInvalidRow[];
}

export async function getImportBatch(ctx: TenantContext, batchId: string): Promise<ImportBatchSummary> {
  const supabase = await createClient();

  const { data: batch, error } = await supabase
    .from("import_batches")
    .select("id, entity_type, status, file_name, row_count, valid_count, error_count, committed_count, skipped_count")
    .eq("id", batchId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (error) throw error;
  if (!batch) throw new AppError("not_found", "Import batch not found.");

  const { data: rows, error: rowsError } = await supabase
    .from("import_rows")
    .select("row_no, errors")
    .eq("batch_id", batchId)
    .eq("institution_id", ctx.institution.id)
    .eq("status", "invalid")
    .order("row_no");
  if (rowsError) throw rowsError;

  return {
    id: batch.id,
    entityType: batch.entity_type,
    status: batch.status,
    fileName: batch.file_name,
    rowCount: batch.row_count,
    validCount: batch.valid_count,
    errorCount: batch.error_count,
    committedCount: batch.committed_count,
    skippedCount: batch.skipped_count,
    invalidRows: (rows ?? []).map((row) => ({
      rowNo: row.row_no,
      errors: row.errors as Record<string, string[]> | null,
    })),
  };
}
