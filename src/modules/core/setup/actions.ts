"use server";

// F18 §H — setup wizard writes. Gate permission is institution.settings.manage
// (owner/principal/admin); public.apply_school_template narrows step 1 to the
// active owner in SQL. Settings writes follow core.feature.set: only the
// touched sub-key is validated, then the whole settings object is written.
import { revalidatePath } from "next/cache";
import type { TenantContext } from "@/lib/auth/types";
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import type { Json } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";
import { InstitutionSettingsSchema } from "@/modules/core/schemas";
import { isLogoPathOf } from "./branding-utils";
import {
  ApplyTemplateSchema,
  SaveBrandingSchema,
  SetProgressSchema,
  type ApplyTemplateInput,
  type SaveBrandingInput,
  type SetProgressInput,
} from "./schemas";
import { buildSchoolTemplate, defaultYearStart } from "./templates";

type Supabase = Awaited<ReturnType<typeof createClient>>;

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

async function writeSettings(supabase: Supabase, ctx: TenantContext, patch: Record<string, unknown>): Promise<void> {
  const settings = { ...ctx.institution.settings, ...patch } as { [key: string]: Json };
  const { error } = await supabase.from("institutions").update({ settings }).eq("id", ctx.institution.id);
  if (error) throwMapped(error);
}

export const applyTemplate = defineAction({
  name: "core.setup.applyTemplate",
  module: "core",
  schema: ApplyTemplateSchema,
  permission: "institution.settings.manage",
  handler: async (input: ApplyTemplateInput, ctx) => {
    const supabase = await createClient();
    let template;
    try {
      // Built here from validated choices; the client never sends template jsonb.
      template = buildSchoolTemplate({ ...input, yearStart: input.yearStart ?? defaultYearStart() });
    } catch (err) {
      if (err instanceof RangeError) throw new AppError("validation_failed", err.message);
      throw err;
    }
    const { data, error } = await supabase.rpc("apply_school_template", {
      p_institution_id: ctx.institution.id,
      p_template: template as unknown as Json,
    });
    // SQL: `conflict` when the school already has grades, `forbidden` for a non-owner; it audits itself.
    if (error) throwMapped(error);
    revalidatePath(`/${ctx.institution.slug}`, "layout");
    return data as Record<string, number>;
  },
});

export const saveBranding = defineAction({
  name: "core.setup.saveBranding",
  module: "core",
  schema: SaveBrandingSchema,
  permission: "institution.settings.manage",
  handler: async ({ logoPath, primaryColor }: SaveBrandingInput, ctx) => {
    const supabase = await createClient();
    // Only a path in THIS school's folder of the logo bucket, never a URL (the layout builds the URL).
    if (logoPath !== undefined && !isLogoPathOf(ctx.institution.id, logoPath)) {
      throw new AppError("validation_failed", "The logo must be uploaded for this school.", { logoPath: ["not this school's logo path"] });
    }

    const parsed = InstitutionSettingsSchema.shape.branding.safeParse({
      ...asObject(ctx.institution.settings.branding),
      ...(logoPath !== undefined ? { logo_path: logoPath } : {}),
      ...(primaryColor !== undefined ? { primary_color: primaryColor } : {}),
    });
    if (!parsed.success || !parsed.data) {
      throw new AppError("validation_failed", "This school's branding could not be updated safely.");
    }
    await writeSettings(supabase, ctx, { branding: parsed.data });
    await audit(ctx, { action: "core.setup.branding_saved", entityType: "institution", entityId: ctx.institution.id });
    revalidatePath(`/${ctx.institution.slug}`, "layout");
    return parsed.data;
  },
});

export const setProgress = defineAction({
  name: "core.setup.setProgress",
  module: "core",
  schema: SetProgressSchema,
  permission: "institution.settings.manage",
  handler: async ({ step, state }: SetProgressInput, ctx) => {
    const supabase = await createClient();
    const rest = Object.fromEntries(Object.entries(asObject(ctx.institution.settings.setup)).filter(([key]) => key !== step));
    const parsed = InstitutionSettingsSchema.shape.setup.safeParse(state === "todo" ? rest : { ...rest, [step]: state });
    if (!parsed.success || !parsed.data) {
      throw new AppError("validation_failed", "This school's setup progress could not be updated safely.");
    }
    await writeSettings(supabase, ctx, { setup: parsed.data });
    revalidatePath(`/${ctx.institution.slug}/setup`);
    return parsed.data;
  },
});
