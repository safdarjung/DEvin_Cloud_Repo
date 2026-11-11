"use server";

// Per-user home dashboard layout. Any role with `dashboard.view` may save its
// own layout (own-row RLS is the data layer); the page still decides which
// widgets that user is allowed to see, so a saved id never grants anything.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { getDashboardLayout } from "@/modules/core/dashboard-layout.queries";
import { createClient } from "@/lib/supabase/server";
import { isMoreCardId } from "@/modules/core/dashboard-widgets";
import { DashboardLayoutSchema, type DashboardLayoutInput } from "@/modules/core/schemas";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

// The page customiser saves widget ids, the "more" grid saves `more:` ids, into one row.
// A save that carries none of one namespace keeps the stored entries of that namespace.
function mergeLayouts(incoming: DashboardLayoutInput, stored: DashboardLayoutInput | null): DashboardLayoutInput {
  if (!stored) return incoming;
  const has = (l: DashboardLayoutInput, more: boolean) => [...l.hidden, ...l.order].some((id) => isMoreCardId(id) === more);
  const keep = (list: DashboardLayoutInput["hidden"], more: boolean) => list.filter((id) => isMoreCardId(id) === more);
  const pick = (more: boolean) => (has(incoming, more) ? incoming : stored);
  const widgets = pick(false);
  const cards = pick(true);
  return { hidden: [...keep(widgets.hidden, false), ...keep(cards.hidden, true)], order: [...keep(widgets.order, false), ...keep(cards.order, true)] };
}

export const saveDashboardLayout = defineAction({
  name: "core.dashboard.layout.save",
  module: "core",
  schema: DashboardLayoutSchema,
  permission: "dashboard.view",
  handler: async (incoming, ctx) => {
    const supabase = await createClient();
    const stored = await getDashboardLayout(ctx);
    const layout = mergeLayouts(incoming, stored);
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
