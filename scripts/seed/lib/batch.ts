import type { SupabaseClient } from "@supabase/supabase-js";

/** Inserts `rows` into `table` in chunks of `batchSize` (05 §8.2: 1,000-row batches). */
export async function insertBatch<T extends Record<string, unknown>>(
  admin: SupabaseClient,
  table: string,
  rows: T[],
  batchSize = 1000,
): Promise<number> {
  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const chunk = rows.slice(offset, offset + batchSize);
    // A dynamic (non-literal) table name defeats postgrest-js's per-table
    // row-shape inference; this helper is intentionally table-agnostic.
    const { error } = await admin.from(table).insert(chunk as never);
    if (error) {
      throw new Error(`insertBatch(${table}) failed at offset ${offset}: ${error.message}`);
    }
    inserted += chunk.length;
  }
  return inserted;
}
