"use server";

// alumni.sync (public.sync_alumni definer) / alumni.profile.update (4 contact columns,
// by id — column grants make student_id/batch_year immutable). Alumni data is contact PII:
// not AI-draftable (§E).
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import { AlumniSyncSchema, AlumniUpdateSchema, type AlumniUpdateInput } from "./schemas";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

export const syncAlumni = defineAction({
  name: "alumni.sync",
  module: "alumni",
  schema: AlumniSyncSchema,
  permission: "alumni.manage",
  handler: async (_input, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("sync_alumni", { p_institution_id: ctx.institution.id });
    if (error) throwMapped(error);
    return { added: (data as number | null) ?? 0 };
  },
});

export const updateAlumniProfile = defineAction({
  name: "alumni.profile.update",
  module: "alumni",
  schema: AlumniUpdateSchema,
  permission: "alumni.manage",
  handler: async ({ id, contactEmail, contactPhone, occupation, city }: AlumniUpdateInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("alumni_profiles")
      .update({ contact_email: contactEmail, contact_phone: contactPhone, occupation, city })
      .eq("id", id)
      .eq("institution_id", ctx.institution.id)
      .select("id");
    if (error) throwMapped(error);
    if (!data || data.length === 0) throw new AppError("not_found", "Alumni profile not found.");
    // No PII in audit: record which fields were set, not their values.
    await audit(ctx, {
      action: "alumni.profile.update",
      entityType: "alumni_profiles",
      entityId: id,
      after: { email: contactEmail !== null, phone: contactPhone !== null, occupation: occupation !== null, city: city !== null },
    });
    return { id };
  },
});
