"use server";

// Per-user home dashboard layout. Any role with `dashboard.view` may save its
// own layout (own-row RLS is the data layer); the page still decides which
// widgets that user is allowed to see, so a saved id never grants anything.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { createClient } from "@/lib/supabase/server";
import { DashboardLayoutSchema } from "@/modules/core/schemas";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

export const saveDashboardLayout = defineAction({
  name: "core.dashboard.layout.save",
  module: "core",
  schema: DashboardLayoutSchema,
  permission: "dashboard.view",
  handler: async (layout, ctx) => {
    const supabase = await createClient();
    const { error } = await supabase
      .from("dashboard_preferences")
      .upsert({ institution_id: ctx.institution.id, user_id: ctx.user.id, layout }, { onConflict: "institution_id,user_id" });
    if (error) throwMapped(error);
    revalidatePath(`/${ctx.institution.slug}/dashboard`);
    return layout;
  },
});

export const resetDashboardLayout = defineAction({
  name: "core.dashboard.layout.reset",
  module: "core",
  schema: z.object({}).strict(),
  permission: "dashboard.view",
  handler: async (_input, ctx) => {
    const supabase = await createClient();
    const { error } = await supabase.from("dashboard_preferences").delete().eq("institution_id", ctx.institution.id).eq("user_id", ctx.user.id);
    if (error) throwMapped(error);
    revalidatePath(`/${ctx.institution.slug}/dashboard`);
    return {};
  },
});
