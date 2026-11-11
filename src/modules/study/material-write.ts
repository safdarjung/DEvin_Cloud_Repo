import "server-only";
// Shared study_materials insert for the study action files (not a "use server"
// file: nothing here is callable from a client). RLS (0138 + 0140) decides
// what each role may insert; this adds the per-user backstop cap.
import { AppError, mapSqlError } from "@/lib/actions/result";
import type { TenantContext } from "@/lib/auth/types";
import type { Json } from "@/lib/db/types";
import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;
type JsonValue = NonNullable<Json>;

export function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

// A backstop against unbounded growth, not a product limit (same reasoning as study_items).
const MAX_MATERIALS_PER_USER = 300;

async function assertUnderMaterialCap(supabase: Client, ctx: TenantContext): Promise<void> {
  const { count, error } = await supabase
    .from("study_materials")
    .select("id", { count: "exact", head: true })
    .eq("institution_id", ctx.institution.id)
    .eq("user_id", ctx.user.id);
  if (error) throwMapped(error);
  if ((count ?? 0) >= MAX_MATERIALS_PER_USER) throw new AppError("validation_failed", `You can keep up to ${MAX_MATERIALS_PER_USER} items. Delete some first.`);
}

export interface MaterialFields {
  format: string;
  title: string;
  subjectId?: string;
  unitId?: string;
  sourceKind: string;
  resourceId?: string;
  content: unknown;
  // 0140
  sourceMaterialId?: string;
  bundleId?: string;
  focusUnitIds?: readonly string[];
  language?: "en" | "hi";
  variantOf?: string;
}

export async function insertMaterial(supabase: Client, ctx: TenantContext, input: MaterialFields, ownerRole: "student" | "teacher"): Promise<string> {
  await assertUnderMaterialCap(supabase, ctx);
  const { data, error } = await supabase
    .from("study_materials")
    .insert({
      institution_id: ctx.institution.id,
      user_id: ctx.user.id,
      owner_role: ownerRole,
      format: input.format,
      title: input.title,
      subject_id: input.subjectId ?? null,
      curriculum_unit_id: input.unitId ?? null,
      source_kind: input.sourceKind,
      resource_id: input.resourceId ?? null,
      content: input.content as JsonValue,
      source_material_id: input.sourceMaterialId ?? null,
      bundle_id: input.bundleId ?? null,
      focus_unit_ids: [...(input.focusUnitIds ?? [])],
      language: input.language ?? "en",
      variant_of: input.variantOf ?? null,
    })
    .select("id")
    .single();
  if (error) throwMapped(error);
  return data.id;
}
